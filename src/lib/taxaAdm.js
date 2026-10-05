// Funções puras da aba Taxa de Administração (leitura da planilha, merge,
// recálculo dos totais). Ficam separadas da tela pra poderem rodar tanto no
// estado local (atualização otimista) quanto dentro da transação do Firestore.
import * as XLSX from 'xlsx'

export const STATUS = ['PAGO', 'PENDENTE']
// As 5 taxas que compõem a receita — guardadas separadas em cada lançamento
export const TAXAS = [
  { key: 'adm', label: 'ADM', color: '#6a9f3c' },
  { key: 'custodia', label: 'Custódia', color: '#3987e5' },
  { key: 'controladoria', label: 'Controladoria', color: '#d95926' },
  { key: 'escrituracao', label: 'Escrituração', color: '#9085e9' },
  { key: 'distribuicao', label: 'Distribuição', color: '#d55181' },
]
export const TAXA_KEYS = TAXAS.map((t) => t.key)
const NUM_FIELDS = ['val', 'saldo', ...TAXA_KEYS]
// Campos que a planilha/edição pode preencher em cada lançamento
export const FIELDS = ['fundo', 'gestor', 'classif', 'cnpj', 'conta', 'mesRef', 'ajuste', 'status', 'val', ...TAXA_KEYS, 'dataReceita', 'vencimento', 'dataPagamento', 'saldo', 'obs']
// Campos que só sobrescrevem o valor existente se vierem preenchidos na planilha
// (pra uma reimportação não apagar observação/data digitada à mão no site).
const SOFT_FIELDS = ['gestor', 'classif', 'cnpj', 'conta', 'dataReceita', 'vencimento', 'dataPagamento', 'obs']
const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100
export const sumTaxas = (r) => round2(TAXA_KEYS.reduce((a, k) => a + (Number(r[k]) || 0), 0))

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
// e deixa de fora campos vazios/zerados pra manter os documentos pequenos.
export function cleanRow(r) {
  const out = {}
  Object.entries(r).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '' || k.startsWith('_')) return
    if (NUM_FIELDS.includes(k)) { v = round2(v); if (!v && k !== 'val') return }
    out[k] = v
  })
  out.val = round2(out.val)
  return out
}

// ---- armazenamento por mês ----
// A base inteira não cabe num documento só do Firestore (limite de 1 MB), então
// cada mês de referência vira um documento `controle/taxa_adm__AAAA_MM`, e o
// `controle/taxa_adm` guarda só a lista de meses e quem alterou por último.
export const SHARD_PREFIX = 'taxa_adm__'
export const shardOf = (mesRef) => (/^\d{2}\.\d{4}$/.test(mesRef || '') ? mesRef.slice(3) + '_' + mesRef.slice(0, 2) : 'sem_mes')
export function partition(rows) {
  const out = {}
  rows.forEach((r) => { (out[shardOf(r.mesRef)] ||= []).push(r) })
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
    dataReceita: col(0, ['data da receita']),
    vencimento: col(1, ['data prevista', 'vencimento']),
    adm: col(2, ['receita: adm', 'adm'], ['data']),
    custodia: col(3, ['custodia']),
    controladoria: col(4, ['controladoria']),
    distribuicao: col(5, ['distribui']),
    escrituracao: col(6, ['escritura']),
    fundo: col(7, ['a que se refere', 'despesa paga', 'nome do fundo', 'fundo'], ['conta', 'cnpj']),
    conta: col(8, ['conta do fundo', 'conta']),
    gestor: col(9, ['gestor']),
    classif: col(10, ['classifica']),
    cnpj: col(11, ['cnpj']),
    val: col(12, ['valor total', 'valor']),
    saldo: findCol(['saldo']),
    obs: findCol(['observ', 'obs']),
    dataPagamento: col(16, ['data de pgto', 'pgto', 'data do pagamento', 'data pagamento', 'data de pagamento', 'pago em']),
    status: col(17, ['status', 'situacao']),
    mesRef: col(18, ['mes referencia', 'mes ref', 'competencia', 'referencia']),
    ajuste: findCol(['ajuste']),
  }
  const get = (r, k) => (idx[k] >= 0 ? r[idx[k]] : '')
  const txt = (r, k) => String(get(r, k) ?? '').trim()

  // Algumas linhas vêm sem o nome do fundo, só com CNPJ — usa o nome que
  // aparece em outra linha com o mesmo CNPJ.
  const nameByCnpj = {}
  raw.slice(hdrIdx + 1).forEach((r) => { const c = onlyDigits(get(r, 'cnpj')); const f = txt(r, 'fundo'); if (c && f && !nameByCnpj[c]) nameByCnpj[c] = f })

  const rows = []
  let skipped = 0
  raw.slice(hdrIdx + 1).forEach((r) => {
    const cnpj = txt(r, 'cnpj')
    const fundo = txt(r, 'fundo') || nameByCnpj[onlyDigits(cnpj)] || ''
    if (!fundo && !onlyDigits(cnpj)) return
    // Mês de referência: quando a coluna traz um texto (ex.: "CORREÇÃO
    // REGULAMENTO"), o lançamento é um ajuste — o texto vira o "ajuste" e o
    // mês sai da data da receita / prevista / pagamento.
    const mesCell = get(r, 'mesRef')
    let mesRef = toMesRef(mesCell)
    let ajuste = txt(r, 'ajuste')
    if (!mesRef) {
      if (!ajuste && String(mesCell).trim()) ajuste = String(mesCell).trim()
      mesRef = toMesRef(get(r, 'dataReceita')) || toMesRef(get(r, 'vencimento')) || toMesRef(get(r, 'dataPagamento'))
    }
    const taxas = {}
    TAXA_KEYS.forEach((k) => { taxas[k] = round2(parseNum(get(r, k))) })
    const soma = sumTaxas(taxas)
    let val = round2(parseNum(get(r, 'val')))
    if (val <= 0 && soma > 0) val = soma
    if (!mesRef || (val <= 0 && soma <= 0)) { skipped++; return }
    const dataPagamento = toISODate(get(r, 'dataPagamento'))
    const saldoCell = get(r, 'saldo')
    rows.push({
      fundo: fundo || 'CNPJ ' + cnpj,
      gestor: txt(r, 'gestor').replace(/^0$/, ''),
      classif: txt(r, 'classif').replace(/^0$/, ''),
      cnpj,
      conta: txt(r, 'conta').replace(/^0$/, ''),
      mesRef,
      ajuste,
      status: normStatus(get(r, 'status'), dataPagamento),
      val,
      ...taxas,
      dataReceita: toISODate(get(r, 'dataReceita')),
      vencimento: toISODate(get(r, 'vencimento')),
      dataPagamento,
      saldo: typeof saldoCell === 'number' ? round2(saldoCell) : 0,
      obs: txt(r, 'obs').replace(/^0$/, ''),
    })
  })
  return { rows, skipped, sheet: wb.SheetNames[0] }
}

export const TEMPLATE_HEADERS = ['Data da receita', 'Data prevista do recebimento', 'ADM', 'Custódia', 'Controladoria', 'Distribuição', 'Escrituração', 'Fundo', 'Conta do Fundo', 'Gestor', 'Classificação', 'CNPJ do Fundo', 'Valor Total', 'Saldos', 'Observação', 'Data de pgto', 'Status', 'Mês Referência', 'Ajuste']

export function rowsToSheetData(rows) {
  return rows.map((r) => ({
    'Data da receita': brDate(r.dataReceita), 'Data prevista do recebimento': brDate(r.vencimento),
    ADM: Number(r.adm) || 0, 'Custódia': Number(r.custodia) || 0, Controladoria: Number(r.controladoria) || 0,
    'Distribuição': Number(r.distribuicao) || 0, 'Escrituração': Number(r.escrituracao) || 0,
    Fundo: r.fundo, 'Conta do Fundo': r.conta || '', Gestor: r.gestor || '', 'Classificação': r.classif || '', 'CNPJ do Fundo': r.cnpj || '',
    'Valor Total': Number(r.val) || 0, Saldos: Number(r.saldo) || 0, 'Observação': r.obs || '',
    'Data de pgto': brDate(r.dataPagamento), Status: r.status, 'Mês Referência': r.mesRef, Ajuste: r.ajuste || '',
  }))
}

// Identidade de um lançamento: fundo + CNPJ + mês (+ o tipo de ajuste, quando
// for uma correção lançada no mesmo mês).
const tag = (r) => (r.mesRef || '') + '|' + norm(r.ajuste)
const keyFull = (r) => onlyDigits(r.cnpj) + '|' + norm(r.fundo) + '|' + tag(r)
const keyCnpj = (r) => (onlyDigits(r.cnpj) ? onlyDigits(r.cnpj) + '|' + tag(r) : null)
const keyNome = (r) => norm(r.fundo) + '|' + tag(r)

const same = (f, a, b) => (NUM_FIELDS.includes(f) ? Math.abs(round2(a) - round2(b)) < 0.005 : String(a ?? '') === String(b ?? ''))

// Aplica as linhas da planilha sobre a base atual sem nunca duplicar:
//  - o que já existe e está igual fica como está;
//  - o que existe e mudou é atualizado (só os campos diferentes);
//  - o que não existe é incluído.
// A busca é em 3 passadas: fundo+CNPJ+mês, depois só CNPJ+mês (fundo que mudou
// de nome) e por último só nome+mês (linha sem CNPJ). Se a mesma chave aparece
// N vezes na planilha, casa com as N primeiras da base — reimportar o mesmo
// arquivo nunca cria nada novo.
export function mergeImport(existing, incoming, { replace = false, who = '' } = {}) {
  const used = new Set()
  const match = new Array(incoming.length).fill(-1)
  const passes = [keyFull, keyCnpj, keyNome]
  passes.forEach((keyFn) => {
    const pool = new Map()
    existing.forEach((r, i) => {
      if (used.has(i)) return
      const k = keyFn(r); if (!k) return
      if (!pool.has(k)) pool.set(k, [])
      pool.get(k).push(i)
    })
    incoming.forEach((nr, j) => {
      if (match[j] >= 0) return
      const k = keyFn(nr); if (!k) return
      const list = pool.get(k)
      while (list && list.length) {
        const i = list.shift()
        if (!used.has(i)) { used.add(i); match[j] = i; break }
      }
    })
  })

  const merged = [...existing]
  const added = []
  const updated = []
  let unchanged = 0
  const now = Date.now()

  incoming.forEach((nr, j) => {
    const i = match[j]
    if (i < 0) {
      const row = { id: newId(), ...nr, updatedAt: now, updatedBy: who }
      merged.push(row); added.push(row)
      return
    }
    const old = merged[i]
    const next = { ...old }
    const changes = []
    FIELDS.forEach((f) => {
      const v = nr[f]
      if (SOFT_FIELDS.includes(f) && (v === '' || v === undefined)) return
      if (!same(f, old[f], v)) {
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
    removed = existing.filter((_, i) => !used.has(i))
    result = merged.filter((_, i) => i >= existing.length || used.has(i))
  }
  return { rows: result, added, updated, unchanged, removed }
}
