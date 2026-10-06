// Base comum (sem dependências) da Taxa de Administração: taxas, formatação e
// normalização. Usada pela tela e pela função de envio de e-mail do Cloudflare.
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
export const SEM_ID = 'SEM IDENTIFICAÇÃO NA PLANILHA'
// Campos que a planilha/edição pode preencher em cada lançamento
export const FIELDS = ['fundo', 'gestor', 'classif', 'cnpj', 'conta', 'mesRef', 'ajuste', 'status', 'val', ...TAXA_KEYS, 'dataReceita', 'vencimento', 'dataPagamento', 'saldo', 'obs']
const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100
export const sumTaxas = (r) => round2(TAXA_KEYS.reduce((a, k) => a + (Number(r[k]) || 0), 0))

export const onlyDigits = (s) => (s || '').toString().replace(/\D/g, '')
export const norm = (s) => (s || '').toString().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
export const sortKey = (m) => { const p = (m || '').split('.'); return (parseInt(p[1]) || 0) * 100 + (parseInt(p[0]) || 0) }
export const newId = () => 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)

export const fmtShort = (v) => { v = Number(v) || 0; return 'R$ ' + (v >= 1e6 ? (v / 1e6).toFixed(2).replace('.', ',') + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1).replace('.', ',') + 'K' : v.toFixed(0)) }
export const fmtMoney = (v) => {
  const n = Math.round((Number(v) || 0) * 100)
  const abs = String(Math.abs(n)).padStart(3, '0')
  const int = abs.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return (n < 0 ? '-' : '') + int + ',' + abs.slice(-2)
}
export const fmtFull = (v) => 'R$ ' + fmtMoney(v)
export const brDate = (iso) => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}` }
export const todayISO = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }
export const isOverdue = (r) => r.status !== 'PAGO' && !!r.vencimento && r.vencimento < todayISO()
