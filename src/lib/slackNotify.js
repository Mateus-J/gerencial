// Padrão de notificação das taxas segregadas para os canais do Slack.
// Cada canal do Slack tem um endereço de e-mail próprio (Integrações → "Enviar
// e-mails para este canal"); o e-mail que chega lá vira uma mensagem no canal.
import { TAXAS, onlyDigits, norm, brDate, fmtFull } from './taxaAdm'

export const DEFAULT_TEMPLATE = {
  subject: 'Taxas {competencia} · {fundo}',
  body: [
    'Olá! Seguem as taxas do fundo {fundo} referentes à competência {competenciaExtenso}.',
    '',
    'CNPJ: {cnpj}',
    'Gestor: {gestor}',
    '',
    'Taxas segregadas:',
    '{taxas}',
    '',
    'Total: {total}',
    'Data da receita: {dataReceita}',
    'Previsão de recebimento: {vencimento}',
    'Status: {status}',
    '{ajustes}',
    '',
    'Qualquer dúvida, estamos à disposição.',
    'Equipe de Liquidação · ID',
  ].join('\n'),
}

export const PLACEHOLDERS = [
  ['{fundo}', 'Nome do fundo'], ['{cnpj}', 'CNPJ'], ['{gestor}', 'Gestor'], ['{conta}', 'Conta do fundo'],
  ['{competencia}', 'Ex.: 09/2026'], ['{competenciaExtenso}', 'Ex.: setembro de 2026'],
  ['{taxas}', 'Lista das taxas com valor (sem as zeradas)'],
  ...TAXAS.map((t) => [`{${t.key}}`, t.label]),
  ['{total}', 'Valor total'], ['{dataReceita}', 'Data da receita'], ['{vencimento}', 'Previsão de recebimento'],
  ['{status}', 'Pendente / Pago em …'], ['{ajustes}', 'Linha com ajustes/correções do mês (some se não houver)'],
]

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const TAX_NAMES = { adm: 'Administração', custodia: 'Custódia', controladoria: 'Controladoria', escrituracao: 'Escrituração', distribuicao: 'Distribuição' }

// Chave do canal: o nome do fundo. (O CNPJ não serve sozinho — na planilha
// vários fundos diferentes aparecem com o mesmo CNPJ.)
export const channelKey = (r) => 'F:' + norm(r.fundo)

// Junta os lançamentos do mês por fundo (o lançamento normal + ajustes)
export function groupByFund(rows, mesRef) {
  const g = new Map()
  rows.filter((r) => r.mesRef === mesRef && !r._fromFip).forEach((r) => {
    const k = channelKey(r)
    if (!g.has(k)) g.set(k, { key: k, mesRef, fundo: r.fundo, cnpj: r.cnpj || '', gestor: r.gestor || '', conta: r.conta || '', rows: [] })
    const e = g.get(k)
    e.rows.push(r)
    if (!r.ajuste) { e.fundo = r.fundo; e.gestor = r.gestor || e.gestor; e.conta = r.conta || e.conta }
  })
  return [...g.values()].map((e) => {
    const sum = (k) => Math.round(e.rows.reduce((a, r) => a + (Number(r[k]) || 0), 0) * 100) / 100
    const main = e.rows.find((r) => !r.ajuste) || e.rows[0]
    const pago = e.rows.every((r) => r.status === 'PAGO')
    const pagoEm = pago ? e.rows.map((r) => r.dataPagamento).filter(Boolean).sort().pop() : ''
    return {
      ...e,
      ...Object.fromEntries(TAXAS.map((t) => [t.key, sum(t.key)])),
      val: sum('val'),
      dataReceita: main.dataReceita || '',
      vencimento: main.vencimento || '',
      status: pago ? 'PAGO' : 'PENDENTE',
      dataPagamento: pagoEm || '',
      ajustes: e.rows.filter((r) => r.ajuste).map((r) => `${r.ajuste} (${fmtFull(r.val)})`),
    }
  }).sort((a, b) => b.val - a.val)
}

export function renderMessage(tpl, f) {
  const [mm, yyyy] = (f.mesRef || '').split('.')
  const taxas = TAXAS.filter((t) => f[t.key] > 0).map((t) => `• ${TAX_NAMES[t.key]}: ${fmtFull(f[t.key])}`).join('\n') || '• (sem taxas segregadas neste mês)'
  const vars = {
    fundo: f.fundo, cnpj: f.cnpj || '—', gestor: f.gestor || '—', conta: f.conta || '—',
    competencia: mm && yyyy ? `${mm}/${yyyy}` : f.mesRef, competenciaExtenso: mm && yyyy ? `${MESES[Number(mm) - 1]} de ${yyyy}` : f.mesRef,
    taxas, total: fmtFull(f.val), dataReceita: brDate(f.dataReceita) || '—', vencimento: brDate(f.vencimento) || '—',
    status: f.status === 'PAGO' ? `Pago${f.dataPagamento ? ' em ' + brDate(f.dataPagamento) : ''}` : 'Pendente',
    ajustes: f.ajustes?.length ? `Inclui ajustes: ${f.ajustes.join('; ')}` : '',
    ...Object.fromEntries(TAXAS.map((t) => [t.key, fmtFull(f[t.key])])),
  }
  const fill = (s) => (s || '').replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m))
  // Linha que ficou vazia só por causa de um campo vazio (ex.: {ajustes}) some
  const body = fill(tpl.body).split('\n').filter((line, i, arr) => !(line === '' && arr[i - 1] === '')).join('\n').replace(/\n{3,}/g, '\n\n').trim()
  return { subject: fill(tpl.subject), body }
}

export const mailtoHref = (to, msg) => `mailto:${encodeURIComponent(to || '')}?subject=${encodeURIComponent(msg.subject)}&body=${encodeURIComponent(msg.body.replace(/\n/g, '\r\n'))}`

// "CNPJ ou nome do fundo ; e-mail" — uma linha por fundo (aceita ; , tab).
// `funds` = [{ key, fundo, cnpj }]; um CNPJ vale para todos os fundos com ele.
export function parseChannelList(text, funds = []) {
  const out = {}
  let invalid = 0
  let unmatched = 0
  text.split(/\r?\n/).forEach((line) => {
    const parts = line.split(/[;\t,]/).map((s) => s.trim()).filter(Boolean)
    if (parts.length < 2) { if (line.trim()) invalid++; return }
    const email = parts.find((p) => /@/.test(p))
    const id = parts.find((p) => p !== email)
    if (!email || !id) { invalid++; return }
    const digits = onlyDigits(id)
    const keys = digits.length >= 11
      ? funds.filter((f) => onlyDigits(f.cnpj) === digits).map((f) => f.key)
      : ['F:' + norm(id)]
    if (!keys.length) { unmatched++; return }
    keys.forEach((k) => { out[k] = email.toLowerCase() })
  })
  return { map: out, invalid, unmatched }
}
