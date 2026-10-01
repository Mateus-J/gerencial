// Funções puras da aba Taxa de Administração (leitura da planilha, merge,
// recálculo dos totais). Ficam separadas da tela pra poderem rodar tanto no
// estado local (atualização otimista) quanto dentro da transação do Firestore.
import * as XLSX from 'xlsx'

export const STATUS = ['PAGO', 'PENDENTE']
// Campos que a planilha/edição pode preencher em cada lançamento
export const FIELDS = ['fundo', 'gestor', 'classif', 'cnpj', 'conta', 'mesRef', 'status', 'val', 'vencimento', 'dataPagamento', 'obs']
// Campos que só sobrescrevem o valor existente se vierem preenchidos na planilha
// (pra uma reimportação não apagar observação/data digitada à mão no site).
const SOFT_FIELDS = ['gestor', 'classif', 'cnpj', 'conta', 'vencimento', 'dataPagamento', 'obs']

export const onlyDigits = (s) => (s || '').toString().replace(/\D/g, '')
export const norm = (s) => (s || '').toString().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
export const sortKey = (m) => { const p = (m || '').split('.'); return (parseInt(p[1]) || 0) * 100 + (parseInt(p[0]) || 0) }
export const newId = () => 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)

export const fmtShort = (v) => { v = Number(v) || 0; return 'R$ ' + (v >= 1e6 ? (v / 1e6).toFixed(2).replace('.', ',') + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1).replace('.', ',') + 'K' : v.toFixed(0)) }
export const fmtFull = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const brDate = (iso) => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}` }
export const todayISO = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }

// "1.234,56" / "1234.56" / 1234.56 → 1234.56
export function parseNum(v) {
  if (typeof v === 'number') return isNaN(v) ? 0 : v
  let s = String(v ?? '').replace(/[R$\s]/g, '')
  if (!s) return 0
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
  const n = parseFloat(s)
  return isNaN(n) ? 0 : n
}

export function toISODate(v) {
  if (v === '' || v === null || v === undefined) return ''
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10)
  if (typeof v === 'number') {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000))
    return isNaN(d) ? '' : d.toISOString().slice(0, 10)
  }
  const s = String(v).trim()
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return s.slice(0, 10)
  return ''
}

// Aceita "07.2026", "07/2026", "2026-07-01", data do Excel (número) → "07.2026"
export function toMesRef(v) {
  if (v === '' || v === null || v === undefined) return null
  if (typeof v === 'string') {
    const s = v.trim().replace(/'/g, '')
    const m = s.match(/^(\d{1,2})[./-](\d{4})$/)
    if (m) return m[1].padStart(2, '0') + '.' + m[2]
  }
  const iso = toISODate(v)
  if (!iso) return null
  const [y, mo] = iso.split('-')
  return mo + '.' + y
}

export function normStatus(v, dataPagamento) {
  const s = norm(v)
  if (/^(PAGO|PAGA|LIQUIDAD|RECEBID|QUITAD)/.test(s)) return 'PAGO'
  if (/^(PENDENTE|ABERTO|EM ABERTO|A RECEBER|ATRASAD|VENCID)/.test(s)) return 'PENDENTE'
  if (!s) return dataPagamento ? 'PAGO' : 'PENDENTE'
  return s
}

// Gera ids estáveis para registros antigos que ainda não têm — determinístico
// pela posição, então todo mundo que abre a tela calcula o mesmo id até a
// primeira gravação persistir.
export function ensureIds(rows) {
  return (rows || []).map((r, i) => (r.id ? r : { ...r, id: 'L' + i + '_' + onlyDigits(r.mesRef) + '_' + norm(r.fundo).replace(/[^A-Z0-9]/g, '').slice(0, 12) }))
}

// Remove `undefined` (o Firestore rejeita a gravação inteira se aparecer um)
export function cleanRow(r) {
  const out = {}
  Object.entries(r).forEach(([k, v]) => { if (v !== undefined && !k.startsWith('_')) out[k] = v })
  out.val = Number(out.val) || 0
  return out
}

export function recalc(parsed) {
  const months = [...new Set(parsed.map((r) => r.mesRef).filter(Boolean))].sort((a, b) => sortKey(a) - sortKey(b))
  const lastMes = months.length ? months[months.length - 1] : null
  const monthly = months.map((mes) => {
    const mr = parsed.filter((r) => r.mesRef === mes)
    const pago = mr.filter((r) => r.status === 'PAGO').reduce((a, r) => a + r.val, 0)
    const pend = mr.filter((r) => r.status !== 'PAGO').reduce((a, r) => a + r.val, 0)
    return { mes, total: pago + pend, pago, pend, count: mr.length }
  })
  const allTotal = parsed.reduce((a, r) => a + r.val, 0)
  const allPago = parsed.filter((r) => r.status === 'PAGO').reduce((a, r) => a + r.val, 0)
  return {
    parsed, months, lastMes, monthly, allTotal, allPago, allPend: allTotal - allPago,
    allPct: allTotal > 0 ? parseFloat(((allPago / allTotal) * 100).toFixed(2)) : 0,
  }
}

// Lê a planilha de cobranças. Procura as colunas pelo nome do cabeçalho; se
// não achar, cai nas posições do layout original da planilha.
export function parseWorkbook(buffer) {
  const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
  let hdrIdx = raw.findIndex((r) => String(r[0] || '').toLowerCase().includes('data da receita'))
  if (hdrIdx < 0) hdrIdx = raw.findIndex((r) => r.some((c) => /valor/i.test(String(c))) && r.some((c) => /fundo|refere/i.test(String(c))))
  if (hdrIdx < 0) hdrIdx = 0
  const headerRow = (raw[hdrIdx] || []).map((h) => norm(h).toLowerCase())
  // Testa as palavras-chave em ordem de prioridade (a mais específica primeiro)
  const findCol = (kws, exclude = []) => {
    for (const k of kws) for (let i = 0; i < headerRow.length; i++) {
      if (headerRow[i].includes(k) && !exclude.some((x) => headerRow[i].includes(x))) return i
    }
    return -1
  }
  const col = (fallback, kws, exclude) => { const i = findCol(kws, exclude); return i >= 0 ? i : fallback }
  const idx = {
    fundo: col(7, ['a que se refere', 'despesa paga', 'nome do fundo', 'fundo'], ['conta', 'cnpj']),
    gestor: col(9, ['gestor']),
    classif: col(10, ['classifica']),
    cnpj: col(11, ['cnpj']),
    conta: col(8, ['conta do fundo', 'conta']),
    val: col(12, ['valor total', 'valor']),
    status: col(17, ['status', 'situacao']),
    mesRef: col(18, ['mes referencia', 'mes ref', 'competencia', 'referencia']),
    vencimento: findCol(['vencimento']),
    dataPagamento: findCol(['data do pagamento', 'data pagamento', 'data de pagamento', 'pago em', 'dt pagamento']),
    obs: findCol(['observ', 'obs']),
  }
  const get = (r, k) => (idx[k] >= 0 ? r[idx[k]] : '')

  const rows = []
  let skipped = 0
  raw.slice(hdrIdx + 1).forEach((r) => {
    const fundo = String(get(r, 'fundo') || '').trim()
    if (!fundo) return
    const mesRef = toMesRef(get(r, 'mesRef'))
    const val = parseNum(get(r, 'val'))
    if (!mesRef || val <= 0) { skipped++; return }
    const dataPagamento = toISODate(get(r, 'dataPagamento'))
    rows.push({
      fundo,
      gestor: String(get(r, 'gestor') || '').trim(),
      classif: String(get(r, 'classif') || '').trim(),
      cnpj: String(get(r, 'cnpj') || '').trim(),
      conta: String(get(r, 'conta') || '').trim(),
      mesRef,
      status: normStatus(get(r, 'status'), dataPagamento),
      val: Math.round(val * 100) / 100,
      vencimento: toISODate(get(r, 'vencimento')),
      dataPagamento,
      obs: String(get(r, 'obs') || '').trim(),
    })
  })
  return { rows, skipped, sheet: wb.SheetNames[0] }
}

export const TEMPLATE_HEADERS = ['Fundo', 'Gestor', 'Classificação', 'CNPJ', 'Conta do Fundo', 'Mês Referência', 'Valor Total', 'Status', 'Vencimento', 'Data Pagamento', 'Observação']

export function rowsToSheetData(rows) {
  return rows.map((r) => ({
    Fundo: r.fundo, Gestor: r.gestor || '', 'Classificação': r.classif || '', CNPJ: r.cnpj || '', 'Conta do Fundo': r.conta || '',
    'Mês Referência': r.mesRef, 'Valor Total': Number(r.val) || 0, Status: r.status,
    Vencimento: brDate(r.vencimento), 'Data Pagamento': brDate(r.dataPagamento), 'Observação': r.obs || '',
  }))
}

const keyByFundo = (r) => norm(r.fundo) + '|' + (r.mesRef || '')
const keyByCnpj = (r) => (onlyDigits(r.cnpj) ? onlyDigits(r.cnpj) + '|' + (r.mesRef || '') : null)

// Aplica as linhas da planilha sobre a base atual: atualiza quem já existe
// (mesmo CNPJ+mês, ou mesmo nome+mês) e inclui o resto. Devolve também o
// resumo das mudanças para a pré-visualização.
export function mergeImport(existing, incoming, { replace = false, who = '' } = {}) {
  const byCnpj = new Map()
  const byFundo = new Map()
  existing.forEach((r, i) => {
    const kc = keyByCnpj(r); if (kc && !byCnpj.has(kc)) byCnpj.set(kc, i)
    const kf = keyByFundo(r); if (!byFundo.has(kf)) byFundo.set(kf, i)
  })
  const merged = [...existing]
  const touched = new Set()
  const added = []
  const updated = []
  let unchanged = 0
  const now = Date.now()

  incoming.forEach((nr) => {
    const kc = keyByCnpj(nr)
    let i = kc && byCnpj.has(kc) ? byCnpj.get(kc) : undefined
    if (i === undefined && byFundo.has(keyByFundo(nr))) i = byFundo.get(keyByFundo(nr))
    if (i === undefined || touched.has(i)) {
      const row = { id: newId(), ...nr, updatedAt: now, updatedBy: who }
      merged.push(row); added.push(row)
      return
    }
    touched.add(i)
    const old = merged[i]
    const next = { ...old }
    const changes = []
    FIELDS.forEach((f) => {
      const v = nr[f]
      if (SOFT_FIELDS.includes(f) && (v === '' || v === undefined)) return
      if (f === 'val' ? Math.abs((Number(old.val) || 0) - v) > 0.004 : (old[f] ?? '') !== v) {
        changes.push({ field: f, from: old[f] ?? '', to: v })
        next[f] = v
      }
    })
    if (changes.length) {
      next.updatedAt = now; next.updatedBy = who
      merged[i] = next
      updated.push({ row: next, changes })
    } else unchanged++
  })

  let removed = []
  let result = merged
  if (replace) {
    const existingCount = existing.length
    removed = existing.filter((_, i) => !touched.has(i))
    result = merged.filter((r, i) => i >= existingCount || touched.has(i))
  }
  return { rows: result, added, updated, unchanged, removed }
}
