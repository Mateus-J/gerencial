// Transfer / Closed: fundos que saem da casa (transferência para outro
// administrador) ou encerram. Cada processo tem etapa, saldo do fundo na conta
// "ID - Transfer e Encerramento", o saldo retido (taxas, lastro, auditoria, CVM,
// ANBIMA…) item a item, checklist e histórico.
import { doc, getDoc } from 'firebase/firestore'
import * as XLSX from 'xlsx'
import { db } from './firebase'
import { norm, onlyDigits, todayISO } from './taxaCore'

export const CONTA_NOME = 'ID - TRANSFER E ENCERRAMENTO'

export const ETAPAS = [
  { id: 'solicitado', label: 'Solicitado', desc: 'Pedido recebido' },
  { id: 'apuracao', label: 'Em apuração', desc: 'Levantando saldo e pendências' },
  { id: 'retido', label: 'Saldo retido', desc: 'Valores provisionados na conta' },
  { id: 'pagamentos', label: 'Pagando despesas', desc: 'Quitando o que foi retido' },
  { id: 'liberacao', label: 'Liberação do saldo', desc: 'Transferência / devolução do restante' },
  { id: 'concluido', label: 'Concluído', desc: 'Processo finalizado' },
]
export const CANCELADO = { id: 'cancelado', label: 'Cancelado', desc: 'Processo interrompido' }
export const ETAPA = Object.fromEntries([...ETAPAS, CANCELADO].map((e, i) => [e.id, { ...e, ordem: i }]))
export const ETAPA_TONE = {
  solicitado: 'bg-sky-500/15 text-sky-600 dark:text-sky-300 border-sky-500/30',
  apuracao: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 border-indigo-500/30',
  retido: 'bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-500/30',
  pagamentos: 'bg-orange-500/15 text-orange-600 dark:text-orange-300 border-orange-500/30',
  liberacao: 'bg-purple-500/15 text-purple-600 dark:text-purple-300 border-purple-500/30',
  concluido: 'bg-id-mid/15 text-id-dark dark:text-id-light border-id-mid/30',
  cancelado: 'bg-[var(--sur2)] text-[var(--tx3)] border-[var(--bdr)]',
}
export const proximaEtapa = (id) => {
  const i = ETAPAS.findIndex((e) => e.id === id)
  return i >= 0 && i < ETAPAS.length - 1 ? ETAPAS[i + 1] : null
}

export const TIPOS = { TRANSFER: 'Transferência', ENCERRAMENTO: 'Encerramento' }
export const CATEGORIAS = ['FIDC', 'FII', 'FIP', 'FIM', 'FIAGRO', 'FIRF', 'FIC', 'Outro']
export const ITENS_RETENCAO = ['Taxa de Administração', 'Taxa de Gestão', 'Custódia', 'Lastro', 'Auditoria', 'CVM', 'ANBIMA', 'Cartório / Jurídico', 'Outros']

const CHECK_COMUM = [
  ['comunicado', 'Comunicado / ata da assembleia recebido'],
  ['saldo', 'Saldo da conta conferido'],
  ['taxas', 'Taxas (administração, gestão, custódia) apuradas'],
  ['anbima', 'ANBIMA quitada'],
  ['cvm', 'Taxa de fiscalização CVM quitada'],
  ['auditoria', 'Auditoria provisionada / paga'],
  ['lastro', 'Lastro e ativos conferidos'],
]
const CHECK_TIPO = {
  TRANSFER: [
    ['destino', 'Dados do novo administrador recebidos'],
    ['transferencia', 'Saldo transferido ao novo administrador'],
    ['termo', 'Termo de transferência assinado'],
  ],
  ENCERRAMENTO: [
    ['cotistas', 'Saldo devolvido aos cotistas'],
    ['baixa', 'Baixa na CVM / ANBIMA'],
    ['contas', 'Contas do fundo encerradas'],
  ],
}
export const checklistDe = (tipo) => [...CHECK_COMUM, ...(CHECK_TIPO[tipo] || CHECK_TIPO.ENCERRAMENTO)]

export const parseValor = (v) => {
  if (typeof v === 'number') return v
  const s = String(v ?? '').replace(/[R$\s]/g, '')
  if (!s) return 0
  const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s)
  return Number.isFinite(n) ? n : 0
}
export const novoId = () => 'tc' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)

// Números de um processo
export function resumo(p) {
  const itens = p.retencoes || []
  const retido = itens.reduce((a, r) => a + parseValor(r.valor), 0)
  const pago = itens.filter((r) => r.status === 'PAGO').reduce((a, r) => a + parseValor(r.valor), 0)
  const pendente = retido - pago
  const saldo = parseValor(p.saldoConta)
  const check = checklistDe(p.tipo)
  const feitos = check.filter(([k]) => p.checklist?.[k]?.feito).length
  const ativo = p.status !== 'concluido' && p.status !== 'cancelado'
  return {
    saldo, retido, pago, pendente,
    // o que sobra para transferir/devolver depois de pagar o que ainda está retido
    liberavel: saldo - pendente,
    feitos, totalCheck: check.length, progresso: check.length ? feitos / check.length : 0,
    ativo,
    atrasado: ativo && !!p.dataPrevista && p.dataPrevista < todayISO(),
    insuficiente: ativo && pendente > saldo + 0.005,
  }
}

// ---- bases do sistema (Taxa ADM e Anbima), lidas uma vez por sessão ----
let basesPromise = null
export function carregarBases() {
  if (!basesPromise) {
    basesPromise = (async () => {
      const ler = async (indice, prefixo) => {
        const idx = await getDoc(doc(db, 'controle', indice))
        const shards = idx.exists() ? idx.data().shards || [] : []
        const docs = await Promise.all(shards.map((s) => getDoc(doc(db, 'controle', prefixo + s))))
        return docs.flatMap((d) => (d.exists() ? d.data().rows || [] : []))
      }
      const [adm, anbima] = await Promise.all([ler('taxa_adm', 'taxa_adm__'), ler('taxa_anbima', 'taxa_anbima__')])
      return { adm, anbima }
    })().catch((e) => { basesPromise = null; throw e })
  }
  return basesPromise
}

// Nome/categoria do fundo pelo CNPJ, a partir da Taxa ADM
export function fundoPorCnpj(bases, cnpj) {
  const d = onlyDigits(cnpj)
  if (d.length < 14) return null
  const rows = bases.adm.filter((r) => onlyDigits(r.cnpj) === d)
  if (!rows.length) return null
  const ult = [...rows].sort((a, b) => String(b.mesRef || '').split('.').reverse().join('').localeCompare(String(a.mesRef || '').split('.').reverse().join('')))[0]
  return { fundo: ult.fundo, categoria: ult.classif || '' }
}

const mesKey = (m) => String(m || '').split('.').reverse().join('')
// Pendências do fundo nas outras telas → itens de retenção sugeridos
export function pendenciasDoSistema(bases, cnpj) {
  const d = onlyDigits(cnpj)
  if (!d) return []
  const adm = bases.adm.filter((r) => onlyDigits(r.cnpj) === d && r.status !== 'PAGO' && (Number(r.val) || 0) > 0)
  const anb = bases.anbima.filter((r) => onlyDigits(r.cnpj) === d && r.status !== 'PAGO' && (Number(r.val) || 0) > 0)
  const out = []
  if (adm.length) {
    const meses = [...new Set(adm.map((r) => r.mesRef))].sort((a, b) => mesKey(a).localeCompare(mesKey(b)))
    out.push({ item: 'Taxa de Administração', valor: round2(adm.reduce((a, r) => a + Number(r.val), 0)), origem: 'taxa_adm', obs: `Pendente na Taxa ADM: ${meses.join(', ')}` })
  }
  if (anb.length) {
    out.push({ item: 'ANBIMA', valor: round2(anb.reduce((a, r) => a + Number(r.val), 0)), origem: 'taxa_anbima', obs: `${anb.length} título(s) pendente(s): ${anb.map((r) => r.titulo).join(', ')}` })
  }
  return out
}
const round2 = (v) => Math.round(v * 100) / 100

// ---- planilha ----
// Lê uma planilha com colunas Fundo, CNPJ, Categoria, Situação, Atividade, Data
// (e, se tiver, Saldo / Responsável / Destino). Linhas sem fundo nem CNPJ são ignoradas.
export function parsePlanilha(buffer) {
  const wb = XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: false })
  const out = []
  for (const name of wb.SheetNames) {
    const grid = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: true })
    const hi = grid.slice(0, 15).findIndex((r) => r.some((c) => /^FUNDO/.test(norm(c))) && r.some((c) => /CNPJ/.test(norm(c))))
    if (hi < 0) continue
    const head = grid[hi].map((c) => norm(c))
    const col = (re) => head.findIndex((h) => re.test(h))
    const C = { fundo: col(/^FUNDO|RAZAO/), cnpj: col(/CNPJ/), cat: col(/CATEG|CLASSIF/), sit: col(/SITUA|STATUS/), ativ: col(/ATIVIDADE|TIPO|MOTIVO/), data: col(/^DATA/), saldo: col(/SALDO|VALOR/), resp: col(/RESPONS/), destino: col(/DESTINO|NOVO ADM/) }
    for (const r of grid.slice(hi + 1)) {
      const fundo = String(r[C.fundo] ?? '').replace(/\s+/g, ' ').trim()
      const cnpj = String(r[C.cnpj] ?? '').trim()
      if (!fundo && !cnpj) continue
      if (/^TOTAL/i.test(fundo)) continue
      const ativ = norm(r[C.ativ])
      out.push({
        fundo, cnpj,
        categoria: C.cat >= 0 ? String(r[C.cat] ?? '').trim() : '',
        tipo: /TRANSF/.test(ativ) ? 'TRANSFER' : 'ENCERRAMENTO',
        status: etapaDaSituacao(C.sit >= 0 ? r[C.sit] : ''),
        dataPedido: C.data >= 0 ? toISO(r[C.data]) : '',
        saldoConta: C.saldo >= 0 ? parseValor(r[C.saldo]) : undefined,
        responsavel: C.resp >= 0 ? String(r[C.resp] ?? '').trim() : '',
        destino: C.destino >= 0 ? String(r[C.destino] ?? '').trim() : '',
      })
    }
  }
  return out
}
function etapaDaSituacao(v) {
  const s = norm(v)
  if (/CONCLU|FINALIZ|ENCERRADO/.test(s)) return 'concluido'
  if (/CANCEL/.test(s)) return 'cancelado'
  if (/LIBERA|TRANSFERID/.test(s)) return 'liberacao'
  if (/PAGAMENT/.test(s)) return 'pagamentos'
  if (/RETID/.test(s)) return 'retido'
  if (/ANDAMENTO|APURA|ANALISE/.test(s)) return 'apuracao'
  return 'solicitado'
}
function toISO(v) {
  if (typeof v === 'number' && v > 20000) return new Date(Math.round((v - 25569) * 864e5)).toISOString().slice(0, 10)
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(String(v || '').trim())
  if (m) return `${m[3]}-${m[2]}-${m[1]}`
  return /^\d{4}-\d{2}-\d{2}/.test(String(v || '')) ? String(v).slice(0, 10) : ''
}

// Junta a planilha com os processos pelo CNPJ (ou nome): novos entram, os que
// já existem têm só os dados de cadastro atualizados (retenções, checklist e
// histórico ficam como estão).
export function mergePlanilha(processos, linhas, who) {
  const key = (x) => onlyDigits(x.cnpj) || norm(x.fundo)
  const atual = new Map(processos.map((p) => [key(p), p]))
  let novos = 0, atualizados = 0
  const now = Date.now()
  const out = [...processos]
  for (const l of linhas) {
    const p = atual.get(key(l))
    if (!p) {
      out.push(novoProcesso({ ...l, saldoConta: l.saldoConta || 0 }, who, 'Incluído pela planilha'))
      novos++
      continue
    }
    const patch = {}
    ;['fundo', 'cnpj', 'categoria', 'tipo', 'dataPedido', 'responsavel', 'destino'].forEach((f) => { if (l[f] && l[f] !== p[f]) patch[f] = l[f] })
    if (l.saldoConta !== undefined && l.saldoConta !== p.saldoConta) patch.saldoConta = l.saldoConta
    if (ETAPA[l.status].ordem > ETAPA[p.status].ordem) patch.status = l.status
    if (!Object.keys(patch).length) continue
    const i = out.indexOf(p)
    out[i] = { ...p, ...patch, updatedAt: now, updatedBy: who, historico: [...(p.historico || []), { ts: now, quem: who, texto: 'Atualizado pela planilha' + (patch.status ? ` — etapa: ${ETAPA[patch.status].label}` : '') }] }
    atualizados++
  }
  return { processos: out, novos, atualizados }
}

export function novoProcesso(dados, who, texto = 'Processo criado') {
  const now = Date.now()
  return {
    id: novoId(), fundo: '', cnpj: '', categoria: '', tipo: 'ENCERRAMENTO', status: 'solicitado',
    dataPedido: todayISO(), dataPrevista: '', dataConclusao: '', responsavel: who || '', destino: '',
    saldoConta: 0, retencoes: [], checklist: {}, obs: '',
    ...dados,
    historico: [{ ts: now, quem: who, texto }],
    createdAt: now, updatedAt: now, updatedBy: who,
  }
}

export const EXPORT_HEADERS = ['Fundo', 'CNPJ', 'Categoria', 'Atividade', 'Etapa', 'Data do pedido', 'Data prevista', 'Data de conclusão', 'Responsável', 'Destino', 'Saldo na conta', 'Total retido', 'Retido pago', 'Retido pendente', 'Saldo liberável', 'Checklist']
const br = (iso) => (iso ? iso.split('-').reverse().join('/') : '')
export function toSheetRow(p) {
  const r = resumo(p)
  return [p.fundo, p.cnpj, p.categoria, TIPOS[p.tipo], ETAPA[p.status]?.label, br(p.dataPedido), br(p.dataPrevista), br(p.dataConclusao), p.responsavel, p.destino, r.saldo, r.retido, r.pago, r.pendente, r.liberavel, `${r.feitos}/${r.totalCheck}`]
}
