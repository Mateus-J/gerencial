// Demonstrativo de Caixa: cálculo do saldo lançamento a lançamento e geração
// do PDF (jsPDF + autotable) com a identidade da ID.
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import logoUrl from '../assets/logo-id.png'

export const EMPRESA = 'ID Corretora de Títulos e Valores Mobiliários S.A.'

export const parseValor = (v) => {
  if (typeof v === 'number') return v
  const s = String(v ?? '').replace(/[R$\s]/g, '')
  if (!s) return 0
  const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s)
  return Number.isFinite(n) ? n : 0
}
export const fmt = (v) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const br = (iso) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10).split('-').reverse().join('/') : iso || '')
export const novoId = () => 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

// Saldo após cada lançamento, na ordem em que estão
export function calcular(d) {
  let saldo = parseValor(d.saldoAnterior)
  let entradas = 0, saidas = 0
  const linhas = (d.lancamentos || []).map((l) => {
    const v = parseValor(l.valor)
    if (l.tipo === 'E') { saldo += v; entradas += v } else { saldo -= v; saidas += v }
    return { ...l, v, saldo }
  })
  return { linhas, entradas, saidas, saldoInicial: parseValor(d.saldoAnterior), saldoFinal: saldo }
}

// Colar do Excel/PDF: uma linha por lançamento — "data ⇥ histórico ⇥ entrada ⇥ saída"
// (ou "data ⇥ histórico ⇥ valor", com saída quando negativo / quando o texto indica)
export function parseColado(texto, dataPadrao = '') {
  const out = []
  for (const raw of String(texto || '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    let cols = raw.split('\t').map((c) => c.trim())
    if (cols.length < 2) {
      // sem tabulação: "12/05/2025 Histórico ... 1.234,56"
      const m = /^(\d{2}\/\d{2}\/\d{4})?\s*(.*?)\s+(-?[\d.]+,\d{2})\s*(-?[\d.]+,\d{2})?$/.exec(line)
      if (!m) continue
      cols = [m[1] || '', m[2], m[3], m[4] || '']
    }
    let [data, hist, a, b] = cols
    if (!/\d{2}\/\d{2}\/\d{4}/.test(data || '')) { b = a; a = hist; hist = data; data = '' }
    if (/^saldo( anterior)?$/i.test(hist || '')) continue
    const iso = /(\d{2})\/(\d{2})\/(\d{4})/.exec(data || '')
    const dataISO = iso ? `${iso[3]}-${iso[2]}-${iso[1]}` : dataPadrao
    const ent = parseValor(a), sai = parseValor(b)
    let tipo, valor
    if (b !== undefined && b !== '' && sai) { tipo = 'S'; valor = Math.abs(sai) }
    else if (ent < 0) { tipo = 'S'; valor = -ent }
    else { tipo = /^(APLICA|TARIFA|TED ENVIAD|PAGAMENTO|DEBITO|TRANSFER[EÊ]NCIA ENVIAD)/i.test(hist) && b === undefined ? 'S' : 'E'; valor = ent }
    if (!valor) continue
    out.push({ id: novoId(), data: dataISO, historico: hist, tipo, valor })
  }
  return out
}

let logoData = null
async function carregarLogo() {
  if (logoData) return logoData
  const blob = await (await fetch(logoUrl)).blob()
  logoData = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob) })
  return logoData
}

const VERDE = [68, 114, 62], VERDE_CLARO = [143, 179, 82], ESCURO = [17, 33, 24], CINZA = [100, 110, 104], LINHA = [226, 232, 226]

export async function gerarPDF(d) {
  const { linhas, entradas, saidas, saldoInicial, saldoFinal } = calcular(d)
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
  const W = pdf.internal.pageSize.getWidth(), M = 14
  const emissao = d.emissao ? new Date(d.emissao) : new Date()
  const emissaoTxt = emissao.toLocaleDateString('pt-BR') + ' ' + emissao.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const logo = await carregarLogo().catch(() => null)

  // faixa do topo
  pdf.setFillColor(...ESCURO); pdf.rect(0, 0, W, 34, 'F')
  pdf.setFillColor(...VERDE_CLARO); pdf.rect(0, 34, W, 1.2, 'F')
  if (logo) pdf.addImage(logo, 'PNG', M, 8, 16, 17.8)
  pdf.setTextColor(255, 255, 255); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(17)
  pdf.text('Demonstrativo de Caixa', M + 22, 16)
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9.5); pdf.setTextColor(200, 220, 190)
  pdf.text(d.conta || 'Caixa ADM', M + 22, 22.5)
  pdf.setFontSize(8); pdf.setTextColor(170, 190, 165)
  pdf.text(EMPRESA, M + 22, 27.5)
  pdf.setFontSize(8); pdf.setTextColor(200, 220, 190)
  pdf.text('Emitido em', W - M, 15, { align: 'right' })
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10); pdf.setTextColor(255, 255, 255)
  pdf.text(emissaoTxt, W - M, 20.5, { align: 'right' })

  // dados do cliente
  let y = 43
  const campos = [
    ['Cliente', d.cliente || '—', 2],
    ['CNPJ', d.cnpj || '—', 1],
    ['Período', `${br(d.periodoInicio) || '—'}  a  ${br(d.periodoFim) || '—'}`, 1],
    ['Conta', [d.conta || 'Caixa ADM', d.agenciaConta].filter(Boolean).join(' · '), 1],
    ['Lançamentos', String(linhas.length), 1],
  ]
  const colW = (W - 2 * M) / 3
  let cx = M, cy = y
  pdf.setDrawColor(...LINHA)
  campos.forEach(([k, v, span]) => {
    const w = colW * span - 2
    if (cx + w > W - M + 1) { cx = M; cy += 15 }
    pdf.setFillColor(246, 249, 244); pdf.roundedRect(cx, cy, w, 12.5, 1.5, 1.5, 'FD')
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(6.8); pdf.setTextColor(...CINZA)
    pdf.text(k.toUpperCase(), cx + 3, cy + 4.3)
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor(...ESCURO)
    pdf.text(pdf.splitTextToSize(v, w - 6)[0], cx + 3, cy + 9.4)
    cx += w + 2
  })
  y = cy + 19

  // resumo
  const cards = [
    ['Saldo anterior', saldoInicial, ESCURO, br(d.dataSaldoAnterior)],
    ['Entradas', entradas, VERDE, `${linhas.filter((l) => l.tipo === 'E').length} lançamento(s)`],
    ['Saídas', saidas, [185, 55, 55], `${linhas.filter((l) => l.tipo !== 'E').length} lançamento(s)`],
    ['Saldo final', saldoFinal, saldoFinal < 0 ? [185, 55, 55] : VERDE, br(d.periodoFim)],
  ]
  const cw = (W - 2 * M - 3 * 3) / 4
  cards.forEach(([k, v, cor, sub], i) => {
    const x = M + i * (cw + 3)
    pdf.setFillColor(255, 255, 255); pdf.setDrawColor(...LINHA); pdf.roundedRect(x, y, cw, 19, 1.5, 1.5, 'FD')
    pdf.setFillColor(...cor); pdf.rect(x, y + 1.5, 1, 16, 'F')
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(6.8); pdf.setTextColor(...CINZA)
    pdf.text(k.toUpperCase(), x + 4, y + 5.2)
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11.5); pdf.setTextColor(...cor)
    pdf.text('R$ ' + fmt(v), x + 4, y + 11.6)
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(6.8); pdf.setTextColor(...CINZA)
    if (sub) pdf.text(sub, x + 4, y + 16)
  })
  y += 26

  // lançamentos
  const body = [
    [{ content: br(d.dataSaldoAnterior), styles: { textColor: CINZA } }, { content: 'Saldo anterior', styles: { fontStyle: 'bold' } }, '', '', { content: fmt(saldoInicial), styles: { fontStyle: 'bold' } }],
    ...linhas.map((l) => [br(l.data), l.historico || '', l.tipo === 'E' ? fmt(l.v) : '', l.tipo !== 'E' ? fmt(l.v) : '', fmt(l.saldo)]),
  ]
  autoTable(pdf, {
    startY: y,
    margin: { left: M, right: M, bottom: 18, top: 16 },
    head: [['Data liquidação', 'Histórico', 'Entradas', 'Saídas', 'Saldo']],
    body,
    foot: [['', 'Saldo final', fmt(entradas), fmt(saidas), fmt(saldoFinal)]],
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: 8.3, cellPadding: { top: 2.2, bottom: 2.2, left: 2.5, right: 2.5 }, textColor: ESCURO, lineColor: LINHA, overflow: 'linebreak' },
    headStyles: { fillColor: VERDE, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
    footStyles: { fillColor: [236, 243, 232], textColor: ESCURO, fontStyle: 'bold', fontSize: 8.6 },
    alternateRowStyles: { fillColor: [248, 250, 247] },
    columnStyles: {
      0: { cellWidth: 25 },
      1: { cellWidth: 'auto' },
      2: { cellWidth: 27, halign: 'right', textColor: VERDE },
      3: { cellWidth: 27, halign: 'right', textColor: [185, 55, 55] },
      4: { cellWidth: 29, halign: 'right' },
    },
    didParseCell: (h) => {
      if ((h.section === 'head' || h.section === 'foot') && h.column.index >= 2) h.cell.styles.halign = 'right'
      if (h.section === 'body' && h.column.index === 4 && parseValor(h.cell.raw?.content ?? h.cell.raw) < 0) h.cell.styles.textColor = [185, 55, 55]
    },
    didDrawCell: (h) => {
      if (h.section === 'body') { pdf.setDrawColor(...LINHA); pdf.setLineWidth(0.15); pdf.line(h.cell.x, h.cell.y + h.cell.height, h.cell.x + h.cell.width, h.cell.y + h.cell.height) }
    },
    didDrawPage: () => {
      // nas páginas seguintes, um cabeçalho discreto
      if (pdf.internal.getCurrentPageInfo().pageNumber > 1) {
        pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8.5); pdf.setTextColor(...ESCURO)
        pdf.text(`Demonstrativo de Caixa — ${d.cliente || ''}`, M, 10)
        pdf.setFont('helvetica', 'normal'); pdf.setTextColor(...CINZA)
        pdf.text(`${br(d.periodoInicio)} a ${br(d.periodoFim)}`, W - M, 10, { align: 'right' })
      }
    },
  })
  y = pdf.lastAutoTable.finalY + 8

  if (d.observacoes?.trim()) {
    const txt = pdf.splitTextToSize(d.observacoes.trim(), W - 2 * M - 8)
    const h = 9 + txt.length * 3.8
    if (y + h > pdf.internal.pageSize.getHeight() - 22) { pdf.addPage(); y = 18 }
    pdf.setFillColor(246, 249, 244); pdf.setDrawColor(...LINHA); pdf.roundedRect(M, y, W - 2 * M, h, 1.5, 1.5, 'FD')
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7); pdf.setTextColor(...CINZA); pdf.text('OBSERVAÇÕES', M + 4, y + 5)
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.3); pdf.setTextColor(...ESCURO); pdf.text(txt, M + 4, y + 9.5)
  }

  // rodapé em todas as páginas
  const n = pdf.getNumberOfPages(), H = pdf.internal.pageSize.getHeight()
  for (let i = 1; i <= n; i++) {
    pdf.setPage(i)
    pdf.setDrawColor(...LINHA); pdf.setLineWidth(0.3); pdf.line(M, H - 12, W - M, H - 12)
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7); pdf.setTextColor(...CINZA)
    pdf.text(`${EMPRESA} · Documento gerado em ${emissaoTxt}${d.geradoPor ? ` por ${d.geradoPor}` : ''}`, M, H - 7.5)
    pdf.text(`Página ${i} de ${n}`, W - M, H - 7.5, { align: 'right' })
  }

  const slug = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40)
  pdf.save(`demonstrativo_${slug(d.cliente) || 'caixa'}_${(d.periodoInicio || '').replace(/-/g, '')}${d.periodoFim && d.periodoFim !== d.periodoInicio ? '_' + d.periodoFim.replace(/-/g, '') : ''}.pdf`)
}
