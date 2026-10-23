// Transfer / Closed: fundos que saem da casa (transferência de administração),
// encerram ou são incorporados. Cada fundo tem os valores de cada despesa/item
// (todos somam), cada um Pendente, Liquidado ou Excluído; os campos de controle
// que não somam (situação, status das despesas, transferido/encerrado,
// evidência do looping); arquivos (PDF/Excel) e histórico.
import { doc, getDoc, setDoc, deleteDoc, writeBatch } from 'firebase/firestore'
import * as XLSX from 'xlsx'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { db } from './firebase'
import { norm, onlyDigits, todayISO } from './taxaCore'
import logoUrl from '../assets/logo-id.png'

export const CONTA_NOME = 'ID - TRANSFER E ENCERRAMENTO'
export const EMPRESA = 'ID Corretora de Títulos e Valores Mobiliários S.A.'

export const ATIVIDADES = { TRANSF_ADM: 'TRANSF. ADM', ENCERRAMENTO: 'ENCERRAMENTO', INCORPORADO: 'INCORPORADO' }
export const CATEGORIAS = ['FIDC', 'FII', 'FIP', 'FIM', 'FIAGRO', 'FIRF', 'FIC', 'Outro']

// Itens com valor: todos somam no total do fundo
export const ITENS = [
  ['tarifa', 'Tarifa'], ['adm', 'ADM'], ['custodia', 'Custódia'], ['gestao', 'Gestão'], ['anbima', 'ANBIMA'],
  ['cvm', 'CVM'], ['banco', 'Banco'], ['auditoria', 'Auditoria'], ['lastro', 'Lastro'], ['notas', 'Notas fiscais'],
  ['zitec', 'Zitec'], ['iof', 'IOF'], ['ir', 'IR'], ['aportes', 'Aportes'], ['reembolso', 'Reembolso'],
  ['escrow', 'Escrow'], ['ativos', 'Ativos'],
]
export const ITEM_LABEL = Object.fromEntries(ITENS)
// Status de cada item
export const PEND = 'PENDENTE', LIQ = 'LIQUIDADO', EXC = 'EXCLUIDO'
// Campos de controle (não somam): Concluído / Pendente
export const CONTROLES = [
  ['situacao', 'Situação'],
  ['statusDespesas', 'Status despesas'],
  ['transferido', 'Transferido / encerrado'],
]
export const CONC = 'CONCLUIDO'

export const parseValor = (v) => {
  if (typeof v === 'number') return v
  const s = String(v ?? '').replace(/[R$\s]/g, '')
  if (!s) return 0
  const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s)
  return Number.isFinite(n) ? n : 0
}
export const novoId = () => 'tc' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
const fmtBR = (v) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const br = (iso) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10).split('-').reverse().join('/') : iso || '')

// Lista de itens do fundo (fixos + extras), já com o valor numérico
export function itensDe(p) {
  const fixos = ITENS.map(([k, label]) => ({ key: k, label, ...(p.itens?.[k] || {}) }))
  const extras = (p.extras || []).map((x) => ({ ...x, key: x.id, extra: true }))
  return [...fixos, ...extras].map((x) => ({ ...x, v: parseValor(x.valor), status: x.status || PEND }))
}
// Itens que entram na conta: têm valor e não foram excluídos
// Itens que contam: têm valor ou já foram marcados como liquidados (a planilha às vezes só marca o ✓)
export const itensValidos = (p) => itensDe(p).filter((x) => x.status !== EXC && (x.v !== 0 || x.status === LIQ))

export function resumo(p) {
  const it = itensValidos(p)
  const total = it.reduce((a, x) => a + x.v, 0)
  const liquidado = it.filter((x) => x.status === LIQ).reduce((a, x) => a + x.v, 0)
  const concluido = p.situacao === CONC
  return {
    total, liquidado, pendente: total - liquidado, qtd: it.length, qtdPend: it.filter((x) => x.status !== LIQ).length,
    saldo: parseValor(p.saldoConta), caixaRetido: parseValor(p.caixaRetido), concluido,
    atrasado: !concluido && !!p.dataPrevista && p.dataPrevista < todayISO(),
  }
}

export function novoProcesso(dados, who, texto = 'Fundo incluído') {
  const now = Date.now()
  return {
    id: novoId(), fundo: '', cnpj: '', categoria: '', atividade: 'ENCERRAMENTO', incorporadoPara: '',
    situacao: PEND, statusDespesas: PEND, transferido: PEND, evidencia: '',
    data: todayISO(), dataPrevista: '', responsavel: who || '', saldoConta: '', caixaRetido: '', caixaRetidoObs: '', itens: {}, extras: [], arquivos: [], obs: '',
    ...dados,
    historico: [{ ts: now, quem: who, texto }],
    createdAt: now, updatedAt: now, updatedBy: who,
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
const mesKey = (m) => String(m || '').split('.').reverse().join('')
export function fundoPorCnpj(bases, cnpj) {
  const d = onlyDigits(cnpj)
  if (d.length < 14) return null
  const rows = bases.adm.filter((r) => onlyDigits(r.cnpj) === d)
  if (!rows.length) return null
  const ult = [...rows].sort((a, b) => mesKey(b.mesRef).localeCompare(mesKey(a.mesRef)))[0]
  return { fundo: ult.fundo, categoria: ult.classif || '' }
}
// Pendências do fundo nas outras telas: ADM (Taxa ADM) e ANBIMA (Taxa Anbima)
export function pendenciasDoSistema(bases, cnpj) {
  const d = onlyDigits(cnpj)
  const out = {}
  if (!d) return out
  const adm = bases.adm.filter((r) => onlyDigits(r.cnpj) === d && r.status !== 'PAGO' && (Number(r.val) || 0) > 0)
  const anb = bases.anbima.filter((r) => onlyDigits(r.cnpj) === d && r.status !== 'PAGO' && (Number(r.val) || 0) > 0)
  if (adm.length) out.adm = { valor: round2(adm.reduce((a, r) => a + Number(r.val), 0)), obs: 'Pendente na Taxa ADM: ' + [...new Set(adm.map((r) => r.mesRef))].sort((a, b) => mesKey(a).localeCompare(mesKey(b))).join(', ') }
  if (anb.length) out.anbima = { valor: round2(anb.reduce((a, r) => a + Number(r.val), 0)), obs: `${anb.length} título(s) pendente(s): ${anb.map((r) => r.titulo).join(', ')}` }
  return out
}
const round2 = (v) => Math.round(v * 100) / 100

// ---- arquivos (PDF/Excel), guardados em pedaços no Firestore ----
const PARTE = 700 * 1024 // caracteres de base64 por documento (abaixo do limite de 1 MB)
export const MAX_ARQUIVO = 8 * 1024 * 1024
const arqRef = (id, n) => doc(db, 'controle', `tc_arq__${id}__${n}`)
export async function enviarArquivo(file, who) {
  if (file.size > MAX_ARQUIVO) throw new Error(`${file.name}: maior que 8 MB`)
  const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = rej; r.readAsDataURL(file) })
  const id = 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const partes = Math.max(1, Math.ceil(b64.length / PARTE))
  for (let i = 0; i < partes; i += 4) {
    const batch = writeBatch(db)
    for (let n = i; n < Math.min(partes, i + 4); n++) batch.set(arqRef(id, n), { d: b64.slice(n * PARTE, (n + 1) * PARTE) })
    await batch.commit()
  }
  return { id, nome: file.name, tipo: file.type || '', tamanho: file.size, partes, por: who, em: Date.now() }
}
export async function baixarArquivo(a) {
  const docs = await Promise.all(Array.from({ length: a.partes }, (_, n) => getDoc(arqRef(a.id, n))))
  const b64 = docs.map((d) => (d.exists() ? d.data().d : '')).join('')
  const bin = atob(b64), bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const url = URL.createObjectURL(new Blob([bytes], { type: a.tipo || 'application/octet-stream' }))
  const link = document.createElement('a'); link.href = url; link.download = a.nome; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
export async function apagarArquivo(a) {
  await Promise.all(Array.from({ length: a.partes }, (_, n) => deleteDoc(arqRef(a.id, n)).catch(() => {})))
}

// ---- acesso: todos veem; edita quem tem permissão ou o código ----
export const ACESSO_REF = () => doc(db, 'controle', 'transfer_closed_acesso')
export async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
export async function salvarCodigo(codigo, atual, who) {
  const salt = [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, '0')).join('')
  await setDoc(ACESSO_REF(), { ...(atual || {}), salt, hash: await sha256(salt + ':' + codigo), updatedAt: Date.now(), updatedBy: who })
}

// ---- planilha ----
// Lê Fundo, CNPJ, Categoria, Situação, Atividade, Data e, se houver, uma coluna
// para cada item (Tarifa, ADM, Custódia…), Status despesas, Transferido e Evidência.
export function parsePlanilha(buffer) {
  const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' })
  const out = []
  for (const name of wb.SheetNames) {
    const grid = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: true })
    const hi = grid.slice(0, 15).findIndex((r) => r.some((c) => /^FUNDO/.test(norm(c))) && r.some((c) => /CNPJ/.test(norm(c))))
    if (hi < 0) continue
    const head = grid[hi].map((c) => norm(c).replace(/[^A-Z0-9/ ]/g, '').trim())
    const col = (re) => head.findIndex((h) => re.test(h))
    const C = {
      fundo: col(/^FUNDO|RAZAO/), cnpj: col(/^CNPJ/), cat: col(/CATEG|CLASSIF/), sit: col(/^SITUA/), ativ: col(/^ATIVIDADE|^TIPO/),
      data: col(/^DATA/), despesas: col(/STATUS DESP/), transf: col(/^TRANSFERIDO|ENCERRADO$/), evid: col(/EVIDENC|LOOPING/), incorp: col(/INCORPORAD.* PARA|DESTINO/), retido: col(/CAIXA RETIDO|^RETIDO/),
    }
    const itemCol = Object.fromEntries(ITENS.map(([k, l]) => [k, head.findIndex((h) => h === norm(l).replace(/[^A-Z0-9/ ]/g, '') || h === k.toUpperCase())]))
    for (const r of grid.slice(hi + 1)) {
      const fundo = String(r[C.fundo] ?? '').replace(/\s+/g, ' ').trim()
      let cnpj = String(r[C.cnpj] ?? '').trim()
      let categoria = C.cat >= 0 ? String(r[C.cat] ?? '').trim() : ''
      // linha com uma coluna deslocada: o CNPJ caiu em Categoria
      if (!/\d{8}/.test(onlyDigits(cnpj)) && onlyDigits(categoria).length === 14) { cnpj = categoria; categoria = '' }
      if ((!fundo && !cnpj) || /^TOTAL/i.test(fundo)) continue
      const itens = {}
      // cada item: ✓ (VERDADEIRO) = liquidado; número = valor lançado; vazio/FALSO = nada
      Object.entries(itemCol).forEach(([k, i]) => {
        if (i < 0) return
        const c = r[i]
        if (c === true || /^(VERDADEIRO|TRUE|SIM|OK|X|LIQUIDADO|CONCLUIDO)$/.test(norm(c))) itens[k] = { status: LIQ }
        else if (typeof c !== 'boolean' && parseValor(c)) itens[k] = { valor: parseValor(c), status: PEND }
      })
      const ativ = norm(r[C.ativ])
      out.push({
        fundo, cnpj,
        categoria,
        atividade: /INCORP/.test(ativ) ? 'INCORPORADO' : /TRANSF/.test(ativ) ? 'TRANSF_ADM' : 'ENCERRAMENTO',
        situacao: conc(r[C.sit]), statusDespesas: C.despesas >= 0 ? conc(r[C.despesas]) : undefined, transferido: C.transf >= 0 ? conc(r[C.transf]) : undefined,
        evidencia: C.evid >= 0 ? String(r[C.evid] ?? '').trim() : '', incorporadoPara: C.incorp >= 0 ? String(r[C.incorp] ?? '').trim() : '',
        data: C.data >= 0 ? toISO(r[C.data]) : '', itens,
        caixaRetido: C.retido >= 0 ? parseValor(r[C.retido]) || undefined : undefined,
      })
    }
  }
  return out
}
const conc = (v) => (v === true || /CONCLU|FINALIZ|^OK|^SIM|LIQUID|VERDADEIRO|^TRUE/.test(norm(v)) ? CONC : PEND)
function toISO(v) {
  if (typeof v === 'number' && v > 20000) return new Date(Math.round((v - 25569) * 864e5)).toISOString().slice(0, 10)
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(String(v || '').trim())
  if (m) return `${m[3]}-${m[2]}-${m[1]}`
  return /^\d{4}-\d{2}-\d{2}/.test(String(v || '')) ? String(v).slice(0, 10) : ''
}
// Junta a planilha pelo CNPJ (ou nome): novos entram; os que existem recebem o
// cadastro e os valores que vierem (itens já liquidados ou excluídos não mudam).
export function mergePlanilha(processos, linhas, who) {
  const key = (x) => onlyDigits(x.cnpj) || norm(x.fundo)
  const atual = new Map(processos.map((p) => [key(p), p]))
  let novos = 0, atualizados = 0
  const now = Date.now()
  const out = [...processos]
  for (const l of linhas) {
    const p = atual.get(key(l))
    const limpo = Object.fromEntries(Object.entries(l).filter(([, v]) => v !== undefined && v !== ''))
    if (!p) { out.push(novoProcesso(limpo, who, 'Incluído pela planilha')); novos++; continue }
    const patch = {}
    ;['fundo', 'cnpj', 'categoria', 'atividade', 'data', 'evidencia', 'incorporadoPara', 'situacao', 'statusDespesas', 'transferido', 'caixaRetido'].forEach((f) => { if (limpo[f] && limpo[f] !== p[f]) patch[f] = limpo[f] })
    const itens = { ...(p.itens || {}) }
    let mudouItem = false
    Object.entries(l.itens || {}).forEach(([k, x]) => {
      const cur = itens[k]
      if (cur && cur.status && cur.status !== PEND) return
      if (x.status === LIQ) { itens[k] = { ...(cur || {}), status: LIQ }; mudouItem = true }
      else if (parseValor(cur?.valor) !== x.valor) { itens[k] = { ...(cur || {}), valor: x.valor, status: PEND }; mudouItem = true }
    })
    if (mudouItem) patch.itens = itens
    if (!Object.keys(patch).length) continue
    out[out.indexOf(p)] = { ...p, ...patch, updatedAt: now, updatedBy: who, historico: [...(p.historico || []), { ts: now, quem: who, texto: 'Atualizado pela planilha' }] }
    atualizados++
  }
  return { processos: out, novos, atualizados }
}

export const statusTxt = (v) => (v === CONC ? 'Concluído' : 'Pendente')
export const EXPORT_HEADERS = ['Fundo', 'CNPJ', 'Categoria', 'Atividade', 'Incorporado para', 'Situação', 'Data', ...ITENS.map(([, l]) => l), 'Outros', 'Total', 'Liquidado', 'Pendente', 'Caixa retido', 'Detalhe caixa retido', 'Status despesas', 'Transferido / encerrado', 'Evidência looping', 'Responsável']
export function toSheetRow(p) {
  const r = resumo(p)
  const val = (k) => { const x = p.itens?.[k]; return x && x.status !== EXC ? parseValor(x.valor) || '' : '' }
  const outros = (p.extras || []).filter((x) => x.status !== EXC).reduce((a, x) => a + parseValor(x.valor), 0)
  return [p.fundo, p.cnpj, p.categoria, ATIVIDADES[p.atividade], p.incorporadoPara || '', statusTxt(p.situacao), br(p.data), ...ITENS.map(([k]) => val(k)), outros || '', r.total, r.liquidado, r.pendente, r.caixaRetido || '', p.caixaRetidoObs || '', statusTxt(p.statusDespesas), statusTxt(p.transferido), p.evidencia || '', p.responsavel || '']
}

// ---- PDF "Folha de conclusão" ----
let logoData = null
async function carregarLogo() {
  if (logoData) return logoData
  const blob = await (await fetch(logoUrl)).blob()
  logoData = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob) })
  return logoData
}
const VERDE = [68, 114, 62], VERDE_CLARO = [143, 179, 82], ESCURO = [17, 33, 24], CINZA = [100, 110, 104], LINHA = [226, 232, 226], AMBAR = [176, 120, 20]

export async function folhaConclusao(p, who) {
  const r = resumo(p)
  const itens = itensValidos(p)
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
  const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight(), M = 14
  const agora = new Date()
  const agoraTxt = agora.toLocaleDateString('pt-BR') + ' ' + agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  const logo = await carregarLogo().catch(() => null)

  pdf.setFillColor(...ESCURO); pdf.rect(0, 0, W, 34, 'F')
  pdf.setFillColor(...VERDE_CLARO); pdf.rect(0, 34, W, 1.2, 'F')
  if (logo) pdf.addImage(logo, 'PNG', M, 8, 16, 17.8)
  pdf.setTextColor(255, 255, 255); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(17)
  pdf.text('Folha de Conclusão', M + 22, 16)
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9.5); pdf.setTextColor(200, 220, 190)
  pdf.text(`Transfer / Closed · ${ATIVIDADES[p.atividade] || ''}`, M + 22, 22.5)
  pdf.setFontSize(8); pdf.setTextColor(170, 190, 165); pdf.text(EMPRESA, M + 22, 27.5)
  pdf.setFontSize(8); pdf.setTextColor(200, 220, 190); pdf.text('Situação', W - M, 15, { align: 'right' })
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11); pdf.setTextColor(...(r.concluido ? VERDE_CLARO : [240, 190, 90]))
  pdf.text(statusTxt(p.situacao).toUpperCase(), W - M, 21, { align: 'right' })

  // dados do fundo
  let y = 43
  const campos = [
    ['Fundo', p.fundo || '—', 2], ['CNPJ', p.cnpj || '—', 1],
    ['Categoria', p.categoria || '—', 1], ['Atividade', ATIVIDADES[p.atividade] || '—', 1], ['Data', br(p.data) || '—', 1],
    ...(p.atividade === 'INCORPORADO' ? [['Incorporado para (nome / CNPJ / conta)', p.incorporadoPara || '—', 3]] : []),
    ['Status despesas', statusTxt(p.statusDespesas), 1], ['Transferido / encerrado', statusTxt(p.transferido), 1], ['Responsável', p.responsavel || '—', 1],
    ['Caixa retido', r.caixaRetido ? 'R$ ' + fmtBR(r.caixaRetido) : '—', 1], ...(p.caixaRetidoObs ? [['Detalhe do caixa retido', p.caixaRetidoObs, 2]] : []),
  ]
  const colW = (W - 2 * M) / 3
  let cx = M, cy = y
  pdf.setDrawColor(...LINHA)
  campos.forEach(([k, v, span]) => {
    const w = colW * span - 2
    if (cx + w > W - M + 1) { cx = M; cy += 15 }
    pdf.setFillColor(246, 249, 244); pdf.roundedRect(cx, cy, w, 12.5, 1.5, 1.5, 'FD')
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(6.8); pdf.setTextColor(...CINZA); pdf.text(k.toUpperCase(), cx + 3, cy + 4.3)
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor(...ESCURO); pdf.text(pdf.splitTextToSize(String(v), w - 6)[0], cx + 3, cy + 9.4)
    cx += w + 2
  })
  y = cy + 19

  // resumo
  const cards = [['Total', r.total, ESCURO, `${r.qtd} item(ns)`], ['Liquidado', r.liquidado, VERDE, `${r.qtd - r.qtdPend} item(ns)`], ['Pendente', r.pendente, r.pendente ? AMBAR : VERDE, `${r.qtdPend} item(ns)`]]
  const cw = (W - 2 * M - 2 * 3) / 3
  cards.forEach(([k, v, cor, sub], i) => {
    const x = M + i * (cw + 3)
    pdf.setFillColor(255, 255, 255); pdf.setDrawColor(...LINHA); pdf.roundedRect(x, y, cw, 19, 1.5, 1.5, 'FD')
    pdf.setFillColor(...cor); pdf.rect(x, y + 1.5, 1, 16, 'F')
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(6.8); pdf.setTextColor(...CINZA); pdf.text(k.toUpperCase(), x + 4, y + 5.2)
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(12); pdf.setTextColor(...cor); pdf.text('R$ ' + fmtBR(v), x + 4, y + 11.8)
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(6.8); pdf.setTextColor(...CINZA); pdf.text(sub, x + 4, y + 16)
  })
  y += 26

  autoTable(pdf, {
    startY: y,
    margin: { left: M, right: M, bottom: 18 },
    head: [['Item', 'Observação', 'Valor (R$)', 'Status', 'Liquidado em']],
    body: itens.map((x) => [x.label, x.obs || '', x.v ? fmtBR(x.v) : '—', x.status === LIQ ? 'Liquidado' : 'Pendente', x.status === LIQ ? br(x.data) : '']),
    foot: [['Total', '', fmtBR(r.total), r.pendente ? `Pendente R$ ${fmtBR(r.pendente)}` : 'Tudo liquidado', '']],
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: 8.2, cellPadding: { top: 1.5, bottom: 1.5, left: 2.5, right: 2.5 }, textColor: ESCURO, overflow: 'linebreak' },
    headStyles: { fillColor: VERDE, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
    footStyles: { fillColor: [236, 243, 232], textColor: ESCURO, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 247] },
    columnStyles: { 0: { cellWidth: 34, fontStyle: 'bold' }, 1: { cellWidth: 'auto', textColor: CINZA, fontSize: 7.5 }, 2: { cellWidth: 30, halign: 'right' }, 3: { cellWidth: 24 }, 4: { cellWidth: 24 } },
    didParseCell: (h) => {
      if ((h.section === 'head' || h.section === 'foot') && h.column.index === 2) h.cell.styles.halign = 'right'
      if (h.section === 'body' && h.column.index === 3) { h.cell.styles.fontStyle = 'bold'; h.cell.styles.textColor = h.cell.raw === 'Liquidado' ? VERDE : AMBAR }
    },
    didDrawCell: (h) => { if (h.section === 'body') { pdf.setDrawColor(...LINHA); pdf.setLineWidth(0.15); pdf.line(h.cell.x, h.cell.y + h.cell.height, h.cell.x + h.cell.width, h.cell.y + h.cell.height) } },
  })
  y = pdf.lastAutoTable.finalY + 8
  if (!itens.length) { pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(...CINZA); pdf.text('Nenhum item com valor lançado.', M, y); y += 8 }

  const blocos = [
    p.evidencia && ['EVIDÊNCIA DO LOOPING', p.evidencia, true],
    p.obs?.trim() && ['OBSERVAÇÕES', p.obs.trim()],
    (p.arquivos || []).length && ['ARQUIVOS ANEXADOS NO SISTEMA', p.arquivos.map((a) => a.nome).join('  ·  ')],
  ].filter(Boolean)
  for (const [t, v, link] of blocos) {
    const txt = pdf.splitTextToSize(v, W - 2 * M - 8)
    const h = 9 + txt.length * 3.8
    if (y + h > H - 40) { pdf.addPage(); y = 18 }
    pdf.setFillColor(246, 249, 244); pdf.setDrawColor(...LINHA); pdf.roundedRect(M, y, W - 2 * M, h, 1.5, 1.5, 'FD')
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7); pdf.setTextColor(...CINZA); pdf.text(t, M + 4, y + 5)
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.3); pdf.setTextColor(...(link ? [40, 90, 160] : ESCURO))
    if (link && /^https?:\/\//.test(v)) pdf.textWithLink(txt[0], M + 4, y + 9.5, { url: v }); else pdf.text(txt, M + 4, y + 9.5)
    y += h + 5
  }

  // assinaturas
  y = Math.max(y + 10, H - 40)
  if (y > H - 22) { pdf.addPage(); y = H - 40 }
  const sw = (W - 2 * M - 10) / 2
  ;[['Responsável', p.responsavel], ['Aprovação', '']].forEach(([t, nome], i) => {
    const x = M + i * (sw + 10)
    pdf.setDrawColor(...CINZA); pdf.setLineWidth(0.3); pdf.line(x, y, x + sw, y)
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.5); pdf.setTextColor(...CINZA); pdf.text(t + (nome ? ` — ${nome}` : ''), x, y + 4.5)
  })

  const n = pdf.getNumberOfPages()
  for (let i = 1; i <= n; i++) {
    pdf.setPage(i)
    pdf.setDrawColor(...LINHA); pdf.setLineWidth(0.3); pdf.line(M, H - 12, W - M, H - 12)
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7); pdf.setTextColor(...CINZA)
    pdf.text(`${EMPRESA} · Gerado em ${agoraTxt}${who ? ` por ${who}` : ''}`, M, H - 7.5)
    pdf.text(`Página ${i} de ${n}`, W - M, H - 7.5, { align: 'right' })
  }
  const slug = String(p.fundo || 'fundo').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40)
  pdf.save(`folha_conclusao_${slug}_${todayISO()}.pdf`)
}

// ---- PDF "Resumo geral": todos os fundos (da lista filtrada), no formato da planilha ----
const ABREV = { tarifa: 'Tarifa', adm: 'ADM', custodia: 'Custód.', gestao: 'Gestão', anbima: 'ANBIMA', cvm: 'CVM', banco: 'Banco', auditoria: 'Audit.', lastro: 'Lastro', notas: 'NF', zitec: 'Zitec', iof: 'IOF', ir: 'IR', aportes: 'Aportes', reembolso: 'Reemb.', escrow: 'Escrow', ativos: 'Ativos' }
const curto = (v) => { v = Math.abs(v); return v >= 1e6 ? (v / 1e6).toFixed(1).replace('.', ',') + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1).replace('.', ',') + 'K' : fmtBR(v) }

export async function resumoGeral(processos, { filtro = '', who = '' } = {}) {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' })
  const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight(), M = 10
  const agora = new Date()
  const agoraTxt = agora.toLocaleDateString('pt-BR') + ' ' + agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  const logo = await carregarLogo().catch(() => null)
  const lista = [...processos].sort((a, b) => String(a.data || '').localeCompare(String(b.data || '')) || a.fundo.localeCompare(b.fundo))
  const rs = lista.map((p) => resumo(p))
  const soma = (k) => rs.reduce((a, r) => a + r[k], 0)

  pdf.setFillColor(...ESCURO); pdf.rect(0, 0, W, 26, 'F')
  pdf.setFillColor(...VERDE_CLARO); pdf.rect(0, 26, W, 1, 'F')
  if (logo) pdf.addImage(logo, 'PNG', M, 5, 13, 14.5)
  pdf.setTextColor(255, 255, 255); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(15); pdf.text('Resumo Transfer / Closed', M + 18, 12)
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); pdf.setTextColor(200, 220, 190)
  pdf.text(`${EMPRESA}${filtro ? ` · ${filtro}` : ''}`, M + 18, 18)
  pdf.text('Emitido em ' + agoraTxt, W - M, 12, { align: 'right' })

  // resumo
  let y = 32
  const conc = lista.filter((p) => p.situacao === CONC).length
  const cards = [['Fundos', String(lista.length), ESCURO], ['Concluídos', String(conc), VERDE], ['Pendentes', String(lista.length - conc), lista.length - conc ? AMBAR : VERDE],
    ['Total lançado', 'R$ ' + fmtBR(soma('total')), ESCURO], ['Liquidado', 'R$ ' + fmtBR(soma('liquidado')), VERDE], ['Pendente', 'R$ ' + fmtBR(soma('pendente')), soma('pendente') ? AMBAR : VERDE],
    ['Caixa retido', 'R$ ' + fmtBR(soma('caixaRetido')), ESCURO]]
  const cw = (W - 2 * M - 6 * 2.5) / 7
  cards.forEach(([k, v, cor], i) => {
    const x = M + i * (cw + 2.5)
    pdf.setFillColor(255, 255, 255); pdf.setDrawColor(...LINHA); pdf.roundedRect(x, y, cw, 14, 1.2, 1.2, 'FD')
    pdf.setFillColor(...cor); pdf.rect(x, y + 1.2, 0.9, 11.6, 'F')
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(6.3); pdf.setTextColor(...CINZA); pdf.text(k.toUpperCase(), x + 3, y + 4.6)
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10); pdf.setTextColor(...cor); pdf.text(v, x + 3, y + 10.6)
  })
  y += 19

  // matriz no formato da planilha
  const st = (v) => (v === CONC ? 'Concluído' : 'Pendente')
  const head = [['Fundo', 'CNPJ', 'Atividade', 'Situação', 'Data', ...ITENS.map(([k]) => ABREV[k]), 'Status desp.', 'Transf./encerr.']]
  const cel = (p, k) => { const x = p.itens?.[k]; if (!x || x.status === EXC) return ''; const v = parseValor(x.valor); return x.status === LIQ ? (v ? curto(v) : '') : v ? curto(v) : '' }
  const body = lista.map((p) => [p.fundo, p.cnpj, ATIVIDADES[p.atividade] || '', st(p.situacao), br(p.data), ...ITENS.map(([k]) => cel(p, k)), st(p.statusDespesas), st(p.transferido)])
  const nI = ITENS.length, i0 = 5
  autoTable(pdf, {
    startY: y, head, body,
    margin: { left: M, right: M, bottom: 14, top: 12 },
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: 6.2, cellPadding: { top: 1.6, bottom: 1.6, left: 1.2, right: 1.2 }, textColor: ESCURO, overflow: 'linebreak', valign: 'middle' },
    headStyles: { fillColor: VERDE, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 5.8, halign: 'center' },
    alternateRowStyles: { fillColor: [248, 250, 247] },
    columnStyles: {
      0: { cellWidth: 52, fontStyle: 'bold' }, 1: { cellWidth: 24, fontSize: 5.8 }, 2: { cellWidth: 17, fontSize: 5.6 }, 3: { cellWidth: 14 }, 4: { cellWidth: 13 },
      ...Object.fromEntries(Array.from({ length: nI }, (_, j) => [i0 + j, { cellWidth: 7.6, halign: 'center', fontSize: 5.2 }])),
      [i0 + nI]: { cellWidth: 14 }, [i0 + nI + 1]: { cellWidth: 14 },
    },
    didParseCell: (h) => {
      if (h.section !== 'body') return
      const p = lista[h.row.index], c = h.column.index
      if (c === 3 || c >= i0 + nI) { h.cell.styles.fontStyle = 'bold'; h.cell.styles.textColor = h.cell.raw === 'Concluído' ? VERDE : AMBAR }
      if (c >= i0 && c < i0 + nI) { const x = p.itens?.[ITENS[c - i0][0]]; if (x && x.status !== LIQ) h.cell.styles.textColor = AMBAR }
    },
    didDrawCell: (h) => {
      if (h.section === 'body') { pdf.setDrawColor(...LINHA); pdf.setLineWidth(0.12); pdf.line(h.cell.x, h.cell.y + h.cell.height, h.cell.x + h.cell.width, h.cell.y + h.cell.height) }
      const c = h.column.index
      if (h.section !== 'body' || c < i0 || c >= i0 + nI) return
      const x = lista[h.row.index].itens?.[ITENS[c - i0][0]]
      if (!x || x.status !== LIQ) return
      // ✓ desenhado (a fonte padrão do PDF não tem o caractere)
      const cx = h.cell.x + h.cell.width / 2, cy = h.cell.y + h.cell.height / 2 - (parseValor(x.valor) ? 1.3 : 0)
      pdf.setDrawColor(...VERDE); pdf.setLineWidth(0.45)
      pdf.line(cx - 1.3, cy, cx - 0.4, cy + 0.9); pdf.line(cx - 0.4, cy + 0.9, cx + 1.4, cy - 1)
    },
    didDrawPage: () => {
      if (pdf.internal.getCurrentPageInfo().pageNumber > 1) {
        pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8); pdf.setTextColor(...ESCURO); pdf.text('Resumo Transfer / Closed', M, 8)
      }
    },
  })
  y = pdf.lastAutoTable.finalY + 4
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(6.5); pdf.setTextColor(...CINZA)
  pdf.setDrawColor(...VERDE); pdf.setLineWidth(0.45); pdf.line(M + 0.5, y, M + 1.4, y + 0.9); pdf.line(M + 1.4, y + 0.9, M + 3.2, y - 1)
  pdf.text('liquidado/concluído   ·   valor em amarelo = lançado e ainda pendente   ·   vazio = nada lançado', M + 5, y + 0.6)

  // valores por fundo
  autoTable(pdf, {
    startY: y + 6,
    head: [['Fundo', 'Atividade', 'Itens', 'Total', 'Liquidado', 'Pendente', 'Caixa retido', 'Evidência do looping']],
    body: lista.map((p, i) => [p.fundo, ATIVIDADES[p.atividade] || '', `${rs[i].qtd - rs[i].qtdPend}/${rs[i].qtd}`, fmtBR(rs[i].total), fmtBR(rs[i].liquidado), fmtBR(rs[i].pendente), rs[i].caixaRetido ? fmtBR(rs[i].caixaRetido) : '', p.evidencia ? 'link' : '']),
    foot: [['Total', '', '', fmtBR(soma('total')), fmtBR(soma('liquidado')), fmtBR(soma('pendente')), fmtBR(soma('caixaRetido')), '']],
    margin: { left: M, right: M, bottom: 14, top: 12 },
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: 6.8, cellPadding: { top: 1.2, bottom: 1.2, left: 2, right: 2 }, textColor: ESCURO },
    headStyles: { fillColor: VERDE, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 6.8 },
    footStyles: { fillColor: [236, 243, 232], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 247] },
    columnStyles: { 0: { cellWidth: 90, fontStyle: 'bold' }, 2: { halign: 'center' }, 3: { halign: 'right' }, 4: { halign: 'right', textColor: VERDE }, 5: { halign: 'right', textColor: AMBAR }, 6: { halign: 'right' }, 7: { textColor: [40, 90, 160] } },
    didParseCell: (h) => { if ((h.section === 'head' || h.section === 'foot') && h.column.index >= 3 && h.column.index <= 6) h.cell.styles.halign = 'right' },
    didDrawCell: (h) => {
      if (h.section === 'body' && h.column.index === 7 && lista[h.row.index].evidencia) pdf.link(h.cell.x, h.cell.y, h.cell.width, h.cell.height, { url: lista[h.row.index].evidencia })
    },
  })

  const n = pdf.getNumberOfPages()
  for (let i = 1; i <= n; i++) {
    pdf.setPage(i)
    pdf.setDrawColor(...LINHA); pdf.setLineWidth(0.3); pdf.line(M, H - 9, W - M, H - 9)
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(6.5); pdf.setTextColor(...CINZA)
    pdf.text(`${EMPRESA} · Gerado em ${agoraTxt}${who ? ` por ${who}` : ''}`, M, H - 5)
    pdf.text(`Página ${i} de ${n}`, W - M, H - 5, { align: 'right' })
  }
  pdf.save(`resumo_transfer_closed_${todayISO()}.pdf`)
}
