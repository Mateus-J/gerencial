// Taxa Anbima: títulos (boletos) da ANBIMA por fundo. Cada título tem número
// único, valor, vencimento, bimestre de referência e status (Pago/Pendente).
// A planilha base tem as abas "Pagos" e "Não Pagos" (a aba "Por Fundo" é só
// resumo e é ignorada); a última linha de cada aba é o total e também é ignorada.
import * as XLSX from 'xlsx'
import { norm, todayISO } from './taxaCore'
import { toISODate, parseNum } from './taxaAdm'

export const SHARD_PREFIX = 'taxa_anbima__'
export const FIELDS = ['fundo', 'cnpj', 'titulo', 'val', 'vencimento', 'ref', 'refRaw', 'status', 'situacao', 'dataPagamento', 'obs']
const NUM_FIELDS = ['val']
// Só a planilha manda nesses; data de pagamento e observação digitadas no site ficam
const SHEET_FIELDS = ['fundo', 'cnpj', 'val', 'vencimento', 'ref', 'refRaw', 'status', 'situacao']

const MESES = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ']
const MES_CURTO = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

export const isOverdue = (r) => r.status !== 'PAGO' && !!r.vencimento && r.vencimento < todayISO()

// Bimestre de referência → chave "AAAA-MM" (mês inicial). Lê "ABRIL/2026 A
// MAIO/2026" (tolerando acento quebrado, ex. "MARA‡O"); se o texto vier
// cortado (ex. "DEZEMB"), usa o mês do vencimento.
export function parseRef(raw, vencimento) {
  const t = norm(raw).replace(/[^A-Z0-9/ ]/g, '')
  const m = /([A-Z]{3})[A-Z]*\/(\d{4})/.exec(t)
  if (m && MESES.includes(m[1])) return `${m[2]}-${String(MESES.indexOf(m[1]) + 1).padStart(2, '0')}`
  return vencimento ? vencimento.slice(0, 7) : ''
}
// "2026-04" → "Abr–Mai/26"; "2025-12" → "Dez/25–Jan/26"
export function refLabel(key) {
  const m = /^(\d{4})-(\d{2})$/.exec(key || '')
  if (!m) return key || ''
  const y = Number(m[1]), mo = Number(m[2]) - 1
  const y2 = mo === 11 ? y + 1 : y, mo2 = (mo + 1) % 12
  const yy = (v) => String(v).slice(2)
  return y === y2 ? `${MES_CURTO[mo]}–${MES_CURTO[mo2]}/${yy(y)}` : `${MES_CURTO[mo]}/${yy(y)}–${MES_CURTO[mo2]}/${yy(y2)}`
}

// Lê todas as abas que têm a coluna "Nº Título". Status: aba "Não Pagos" →
// PENDENTE, "Pagos" → PAGO; em outra aba, pelo texto do sistema
// ("Aguardando…" = pendente).
export function parseWorkbook(buffer) {
  const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' }) // datas como número do Excel (sem erro de fuso)
  const rows = []
  const sheets = []
  let skipped = 0
  for (const name of wb.SheetNames) {
    const grid = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null, raw: true })
    const hi = grid.slice(0, 15).findIndex((r) => r.some((c) => /n.?\s*t[ií]tulo/i.test(String(c || ''))) && r.some((c) => /valor/i.test(String(c || ''))))
    if (hi < 0) continue
    const head = grid[hi].map((c) => norm(c))
    const col = (re) => head.findIndex((h) => re.test(h))
    const C = { fundo: col(/RAZAO|FUNDO/), cnpj: col(/CNPJ/), titulo: col(/T.TULO/), val: col(/VALOR/), venc: col(/VENCIMENTO/), ref: col(/REFER/), sit: col(/STATUS|SITUA/) }
    const sheetStatus = /N.O\s*PAG/.test(norm(name)) ? 'PENDENTE' : /PAG/.test(norm(name)) ? 'PAGO' : null
    let n = 0
    for (const r of grid.slice(hi + 1)) {
      const titulo = r[C.titulo] == null ? '' : String(r[C.titulo]).trim().replace(/\.0+$/, '')
      if (!titulo) { if (r.some((c) => c != null && c !== '')) skipped++; continue } // linha de total / vazia
      const situacao = C.sit >= 0 ? String(r[C.sit] || '').trim() : ''
      const vencimento = toISODate(r[C.venc])
      const refRaw = C.ref >= 0 ? String(r[C.ref] || '').trim() : ''
      rows.push({
        id: 'anb-' + titulo,
        titulo,
        fundo: String(r[C.fundo] || '').replace(/\s+/g, ' ').trim(),
        cnpj: String(r[C.cnpj] || '').trim(),
        val: parseNum(r[C.val]),
        vencimento,
        ref: parseRef(refRaw, vencimento),
        refRaw,
        situacao,
        status: sheetStatus || (/AGUARD|PENDEN|ABERTO/.test(norm(situacao)) ? 'PENDENTE' : 'PAGO'),
      })
      n++
    }
    sheets.push({ name, rows: n })
  }
  // Mesmo título em duas abas: fica a última leitura (a planilha não deveria ter isso)
  const byId = new Map(rows.map((r) => [r.id, r]))
  return { rows: [...byId.values()], skipped, sheets, duplicated: rows.length - byId.size }
}

const same = (f, a, b) => (NUM_FIELDS.includes(f) ? Math.abs((Number(a) || 0) - (Number(b) || 0)) < 1e-6 : String(a ?? '') === String(b ?? ''))

// Junta a planilha com a base pelo nº do título: novos entram, os que mudaram
// são atualizados, os iguais ficam como estão. `replace` remove da base os
// títulos que não estão mais na planilha.
export function mergeImport(existing, incoming, { replace = false, who = '' } = {}) {
  const now = Date.now()
  const cur = new Map(existing.map((r) => [r.titulo, r]))
  const seen = new Set()
  const added = [], updated = [], out = []
  let unchanged = 0
  for (const inc of incoming) {
    seen.add(inc.titulo)
    const old = cur.get(inc.titulo)
    if (!old) { const r = { ...inc, updatedAt: now, updatedBy: who }; added.push(r); out.push(r); continue }
    const changes = SHEET_FIELDS.filter((f) => !same(f, old[f], inc[f])).map((f) => ({ field: f, from: old[f] ?? '', to: inc[f] ?? '' }))
    if (!changes.length) { unchanged++; out.push(old); continue }
    const r = { ...old, ...Object.fromEntries(SHEET_FIELDS.map((f) => [f, inc[f]])), updatedAt: now, updatedBy: who }
    if (r.status === 'PENDENTE') delete r.dataPagamento
    updated.push({ row: r, changes }); out.push(r)
  }
  const removed = []
  for (const r of existing) {
    if (seen.has(r.titulo)) continue
    if (replace) removed.push(r); else out.push(r)
  }
  return { rows: out, added, updated, unchanged, removed }
}

// Grava sem campos vazios (documento menor)
export function cleanRow(r) {
  const o = { id: r.id, titulo: r.titulo }
  for (const f of FIELDS) {
    const v = r[f]
    if (v === undefined || v === null || v === '') continue
    o[f] = v
  }
  if (r.updatedAt) o.updatedAt = r.updatedAt
  if (r.updatedBy) o.updatedBy = r.updatedBy
  return o
}

// Um documento por ano do bimestre (taxa_anbima__2026), para não estourar o limite do Firestore
export const shardOf = (r) => (/^\d{4}/.test(r.ref || '') ? r.ref.slice(0, 4) : 'sem_ref')
export function partition(rows) {
  const parts = {}
  rows.forEach((r) => { (parts[shardOf(r)] ||= []).push(r) })
  return parts
}

export const EXPORT_HEADERS = ['Razão Social', 'CNPJ', 'Nº Título', 'Valor do Título', 'Vencimento', 'Referência', 'Status', 'Status no sistema', 'Data de pagamento', 'Observação']
const br = (iso) => (iso ? iso.split('-').reverse().join('/') : '')
export const toSheetRow = (r) => [r.fundo, r.cnpj, r.titulo, Number(r.val) || 0, br(r.vencimento), r.refRaw || refLabel(r.ref), r.status === 'PAGO' ? 'Pago' : 'Pendente', r.situacao || '', br(r.dataPagamento), r.obs || '']
