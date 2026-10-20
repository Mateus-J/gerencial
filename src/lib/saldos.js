// Saldos dos fundos de zeragem (ID RF e ID Soberano).
// Liquidez (Zeragem Geral) = posição de cada cotista no início do dia.
// Extrato de cada fundo de zeragem = aplicações (C) e resgates (D) do dia.
// O saldo atualizado é calculado na hora a partir desses dois arquivos e do
// de-para salvo (nome do extrato → cotista), então reimportar ou corrigir um
// de-para sempre recalcula tudo sem deixar sobra da importação anterior.
import * as XLSX from 'xlsx'

export const FUNDOS = ['ID RF', 'ID Soberano']
// Número da conta de cada fundo de zeragem no nome do arquivo e no campo id_conta
const CONTA = { 'ID RF': { arquivo: '454489', idConta: '451' }, 'ID Soberano': { arquivo: '454398', idConta: '442' } }

const strip = (s) => String(s ?? '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
export const normNome = (s) => strip(s).replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()

// Número no formato brasileiro ("1.234,56") ou do sistema ("1234.56")
export function parseNum(v) {
  if (typeof v === 'number') return v
  const s = String(v ?? '').trim()
  if (!s) return 0
  const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s)
  return Number.isFinite(n) ? n : 0
}

// ---------- comparação de nomes ----------
// Palavras que não identificam o fundo (tipo, forma jurídica, termos comuns)
const GENERICAS = new Set(('FUNDO FUNDOS INVESTIMENTO INVESTIMENTOS INVEST DE DO DA DOS DAS EM NO NA NOS NAS E A O ' +
  'DIREITOS DIREITO DIRETOS CREDITORIOS CREDITORIO FINANCEIRO RENDA FIXA LONGO PRAZO CP LP ' +
  'RESPONSABILIDADE RESP LIMITADA LTDA RL SIMPLES COTAS COTA MULTIMERCADO MULT MULTI IMOBILIARIO IMOBILIARIA PARTICIPACOES ' +
  'MULTIESTRATEGIA NAO PADRONIZADO PADRONIZADOS NP FIAGRO AGROINDUSTRIAIS AGROINDUSTRIAL CADEIAS PRODUTIVAS IE EXTERIOR ' +
  'FIDC FII FIP FIM FIC FIA FIF FI FIRF S SA CLASSE UNICA SUBCLASSE SENIOR').split(' '))
const ROMANOS = { I: '1', II: '2', III: '3', IV: '4', V: '5', VI: '6', VII: '7', VIII: '8', IX: '9', X: '10', XX: '20', XXX: '30' }

// Tipo do fundo pelo nome; tipos diferentes nunca são o mesmo fundo
function tipoFundo(n) {
  const t = ` ${n} `
  if (/ FIAGRO /.test(t)) return null // Fiagro pode ser FII ou FIDC
  if (/ (FII|IMOBILIARIO) /.test(t)) return 'FII'
  if (/ (FIP|PARTICIPACOES) /.test(t)) return 'FIP'
  if (/ (FIDC|DIREITOS CREDITORIOS|DIRETOS CREDITORIOS) /.test(t)) return 'FIDC'
  if (/ (FIM|MULTIMERCADO) /.test(t)) return 'FIM'
  if (/ (FIRF|RENDA FIXA) /.test(t)) return 'FIRF'
  if (/ INVESTIMENTO FINANCEIRO /.test(t) && !/ COTAS /.test(t)) return 'FIF'
  return null
}
export function chaveNome(nome) {
  const n = normNome(nome)
  const ws = ` ${n} `.replace(/ (CREDITO PRIVADO|CRED PRIV) /g, ' ').trim().split(' ')
  const words = [], nums = []
  for (const w of ws) {
    if (!w || GENERICAS.has(w)) continue
    const r = ROMANOS[w] || (/^\d+$/.test(w) ? String(Number(w)) : null)
    if (r) nums.push(r); else words.push(w)
  }
  return { n, words: [...new Set(words)], nums: [...new Set(nums)].filter((x) => x !== '1').sort().join(','), tipo: tipoFundo(n) }
}

// Acha o cotista da liquidez para um nome do extrato. Regras (na dúvida, não casa
// e o nome vai para o de-para, onde o usuário escolhe uma vez e fica salvo):
// - o tipo do fundo não pode conflitar (FIDC × FII × FIP…);
// - a numeração tem que ser a mesma (BOREAL II ≠ BOREAL; "I" pode faltar);
// - as palavras do nome da liquidez têm que estar todas no nome do extrato, ou o
//   contrário quando o extrato traz 2+ palavras próprias (ou 1 palavra longa que
//   só existe num cotista, ex. "BELLENZIER" → "BELLENZIER PRIME CASH FIDC");
// - empate entre dois cotistas diferentes = não casa.
const cacheChave = new WeakMap()
const chaveDe = (c) => { let k = cacheChave.get(c); if (!k) { k = chaveNome(c.nome); cacheChave.set(c, k) } return k }
const dentro = (a, b) => a.every((t) => b.includes(t))
export function casarNome(nomeExt, cotistas, fundo) {
  const e = chaveNome(nomeExt)
  if (!e.words.length) return null
  const exato = cotistas.filter((c) => chaveDe(c).n === e.n)
  if (exato.length === 1) return exato[0]
  let best = null, bestScore = 0, empate = false
  for (const c of cotistas) {
    const k = chaveDe(c)
    if (!k.words.length || k.nums !== e.nums) continue
    if (e.tipo && k.tipo && e.tipo !== k.tipo) continue
    let ok = dentro(k.words, e.words)
    if (!ok && dentro(e.words, k.words)) {
      ok = e.words.length >= 2 || (e.words[0].length >= 5 && (!fundo || c[fundo] > 0) && cotistas.filter((x) => chaveDe(x).words.includes(e.words[0])).length === 1)
    }
    if (!ok) continue
    const comuns = k.words.filter((t) => e.words.includes(t)).length
    // mais palavras em comum ganha; empate entre fundos diferentes = ambíguo
    const score = comuns * 100 - Math.abs(k.words.length - e.words.length)
    if (score > bestScore) { best = c; bestScore = score; empate = false }
    else if (score === bestScore && k.n !== chaveDe(best).n) empate = true
  }
  return empate ? null : best
}

// Segunda chance, pelo valor: resgate igual à posição inteira do cotista naquele
// fundo e mesma primeira palavra do nome (ex. "ETNA LBO V" → "ETNA FIP").
export function casarPorValor(mov, cotistas, fundo) {
  const e = chaveNome(mov.nome)
  if (!e.words.length || !mov.debitos) return null
  const valores = [mov.debitos, ...mov.detalhes.filter((d) => d.dc === 'D').map((d) => d.v)]
  const cs = cotistas.filter((c) => c[fundo] > 0 && chaveDe(c).words[0] === e.words[0] && valores.some((v) => Math.abs(v - c[fundo]) < 0.01))
  return cs.length === 1 ? cs[0] : null
}

// ---------- leitura dos arquivos ----------
// Planilha "Zeragem Geral": uma linha por cotista, com a posição em cada fundo
export function parseLiquidez(buffer) {
  const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' })
  const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' })
  const hdrIdx = raw.findIndex((r) => r.some((c) => String(c).trim() === 'Fundo (Cotista)'))
  if (hdrIdx < 0) throw new Error('Não encontrei a coluna "Fundo (Cotista)" nesse arquivo. O layout pode ter mudado.')
  const header = raw[hdrIdx].map((h) => normNome(h))
  const iSeq = raw[hdrIdx].findIndex((h) => String(h).trim() === '#')
  const iNome = raw[hdrIdx].findIndex((h) => String(h).trim() === 'Fundo (Cotista)')
  const iRF = header.findIndex((h) => h === 'ID RF')
  const iSob = header.findIndex((h) => h === 'ID SOBERANO')
  if (iRF < 0 || iSob < 0) throw new Error('Não encontrei as colunas "ID RF" e "ID Soberano" na liquidez.')
  const dataBase = (raw.slice(0, hdrIdx).flat().map(String).join(' ').match(/(\d{2}\/\d{2}\/\d{4})/) || [])[1] || null
  const cotistas = []
  for (const r of raw.slice(hdrIdx + 1)) {
    const seq = String(r[iSeq] ?? '').trim()
    const nome = String(r[iNome] ?? '').replace(/\s+/g, ' ').trim()
    // linha de total: "TOTAL (436 fundos)" na coluna #, sem nome de fundo
    if (/^TOTAL\b/i.test(seq) || (!nome && !seq)) continue
    if (!nome) continue
    cotistas.push({ nome: nome.slice(0, 120), 'ID RF': Math.max(0, parseNum(r[iRF])), 'ID Soberano': Math.max(0, parseNum(r[iSob])) })
  }
  return { cotistas, dataBase }
}

// Extrato CSV do fundo de zeragem: agrupa aplicações/resgates por nome
export function parseExtrato(text, fileName = '') {
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  const sep = lines[0].includes(';') ? ';' : ','
  const rows = lines.map((l) => l.split(sep).map((c) => c.replace(/^"|"$/g, '').trim()))
  const hdr = rows[0].map((h) => h.toLowerCase())
  const col = (n) => hdr.indexOf(n)
  const I = { dc: col('fl_debito_credito'), val: col('valor'), nome: col('ds_complemento'), saldo: col('vl_saldo_in'), dt: col('dt_mov'), hist: col('ds_historico'), conta: col('id_conta') }
  if (I.dc < 0 || I.val < 0 || I.nome < 0) throw new Error('Colunas do extrato não encontradas (fl_debito_credito, valor, ds_complemento).')
  const data = rows.slice(1).filter((r) => r.length > Math.max(I.dc, I.val, I.nome))
  // Qual fundo de zeragem é: pelo número da conta no nome do arquivo ou pelo id_conta
  let fundo = FUNDOS.find((f) => fileName.includes(CONTA[f].arquivo))
  if (!fundo && I.conta >= 0) fundo = FUNDOS.find((f) => data.some((r) => r[I.conta] === CONTA[f].idConta))
  if (!fundo) throw new Error('Não consegui identificar se o extrato é do ID RF (454489) ou do ID Soberano (454398).')
  const movs = {}
  let saldoFinal = null
  for (const r of data) {
    const dc = (r[I.dc] || '').toUpperCase()
    if (!['D', 'C'].includes(dc)) continue
    const v = parseNum(r[I.val])
    if (I.saldo >= 0 && r[I.saldo] !== '') saldoFinal = parseNum(r[I.saldo]) // saldo já com o lançamento
    const nome = normNome(r[I.nome])
    if (!nome || isInterno(nome)) continue
    const m = (movs[nome] ||= { nome, debitos: 0, creditos: 0, qtdD: 0, qtdC: 0, detalhes: [] })
    if (dc === 'D') { m.debitos += v; m.qtdD++ } else { m.creditos += v; m.qtdC++ }
    m.detalhes.push({ dc, v, dt: I.dt >= 0 ? r[I.dt] : '', hist: I.hist >= 0 ? r[I.hist] : '' })
  }
  const datas = data.map((r) => r[I.dt]).filter(Boolean)
  return { fundo, movs: Object.values(movs), saldoFinal, dataMov: datas[datas.length - 1] || null }
}
// Movimentos entre os próprios fundos/contas da casa, tarifas: não são de cotista
function isInterno(n) {
  return /TARIFA/.test(n) || /^ID (RF|SOBERANO) (FUNDO|LONGO)/.test(n) || n.startsWith('ID CORRETORA') || n.startsWith('EBS2 TRADE')
}

// ---------- cálculo ----------
export const chaveLinha = (nome, fundo) => `${nome}|${fundo}`
export const IGNORAR = '__ignorar'
export const FORA = '__fora'

// Para cada nome do extrato: a quem pertence e como foi decidido
export function vinculos(SD) {
  const cot = SD.cotistas || []
  const depara = SD.depara || {}
  const out = []
  for (const f of FUNDOS) {
    for (const m of SD.extratos?.[f]?.movs || []) {
      const manual = depara[m.nome]
      let cotista = null, como = 'auto'
      if (manual === IGNORAR || manual === FORA) como = manual
      else if (manual && cot.some((c) => c.nome === manual)) { cotista = manual; como = 'manual' }
      else {
        const c = casarNome(m.nome, cot, f) || casarPorValor(m, cot, f)
        if (c) cotista = c.nome
        else como = 'nenhum'
      }
      out.push({ fundo: f, mov: m, cotista, como })
    }
  }
  return out
}

// Monta as linhas da tela: posição da liquidez + movimentos dos extratos.
export function calcular(SD) {
  const cot = SD.cotistas || []
  const extras = SD.extras || {}
  const linhas = new Map()
  const linha = (nome, fundo, saldoInicial, fora = false) => {
    const k = chaveLinha(nome, fundo)
    if (!linhas.has(k)) {
      const x = extras[k] || {}
      linhas.set(k, { key: k, nome, fundo, saldoInicial, fora, debitos: 0, creditos: 0, qtdD: 0, movs: [], bloqueios: x.bloqueios || [], regularizado: !!x.regularizado })
    }
    return linhas.get(k)
  }
  cot.forEach((c) => FUNDOS.forEach((f) => { if (c[f] > 0) linha(c.nome, f, c[f]) }))
  const vs = vinculos(SD)
  for (const v of vs) {
    if (v.como === IGNORAR) continue
    const c = v.cotista ? cot.find((x) => x.nome === v.cotista) : null
    // sem cotista na liquidez: aparece com o nome do extrato, marcado como fora da liquidez
    const l = c ? linha(c.nome, v.fundo, c[v.fundo] || 0) : linha(v.mov.nome, v.fundo, 0, true)
    l.debitos += v.mov.debitos; l.creditos += v.mov.creditos; l.qtdD += v.mov.qtdD
    l.movs.push({ ...v.mov, como: v.como })
  }
  const outro = (f) => FUNDOS.find((x) => x !== f)
  const rows = [...linhas.values()].map((l) => {
    const mov = l.creditos - l.debitos
    const saldoAtualizado = l.saldoInicial + mov
    const bloqueado = l.bloqueios.reduce((a, b) => a + (Number(b.valor) || 0), 0)
    const c = cot.find((x) => x.nome === l.nome)
    const posOutro = c ? c[outro(l.fundo)] || 0 : 0
    const noOutro = posOutro > 0 ? ` — tem posição no ${outro(l.fundo)}` : ''
    let status = 'ok', obs = ''
    if (l.fora) {
      const confirmado = l.movs.every((m) => m.como === FORA)
      status = confirmado ? 'foraok' : 'fora'
      obs = confirmado ? 'Fora da liquidez (confirmado)' : 'Não está na liquidez — vincule a um cotista ou confirme'
    } else if (l.saldoInicial <= 0.01 && l.debitos > 0.01) {
      status = l.regularizado ? 'regularizado' : 'incorreto'
      obs = `Resgate de ${fmt(l.debitos)} sem posição no ${l.fundo}${noOutro}`
    } else if (saldoAtualizado - bloqueado < -1) {
      status = 'maior'
      obs = `Resgate a maior: falta ${fmt(bloqueado - saldoAtualizado)}${noOutro}`
    } else if (l.saldoInicial <= 0.01 && l.creditos > 0) {
      obs = 'Aplicação no dia (sem posição na liquidez)'
    } else if (l.qtdD > 1) {
      obs = `${l.qtdD}x resgates (${fmt(l.debitos)})`
    }
    return { ...l, mov, saldoAtualizado, bloqueado, status, obs }
  })
  // cotistas da liquidez sem posição e sem movimento no dia
  const comLinha = new Set(rows.map((r) => r.nome))
  cot.filter((c) => !comLinha.has(c.nome)).forEach((c) => rows.push({ key: chaveLinha(c.nome, '—'), nome: c.nome, fundo: '—', saldoInicial: 0, fora: false, debitos: 0, creditos: 0, qtdD: 0, movs: [], bloqueios: [], mov: 0, saldoAtualizado: 0, bloqueado: 0, status: 'semsaldo', obs: '' }))
  return { rows, vinculos: vs }
}

// Documento antigo (uma linha por cotista+fundo) → formato atual
export function migrar(d) {
  if (!d || d.v === 3) return d
  const por = new Map(), extras = {}
  for (const c of d.cotistas || []) {
    const x = por.get(c.nome) || { nome: c.nome, 'ID RF': 0, 'ID Soberano': 0 }
    if (FUNDOS.includes(c.fundo)) {
      x[c.fundo] = Number(c.saldoInicial) || 0
      if (c.bloqueios?.length) extras[chaveLinha(c.nome, c.fundo)] = { bloqueios: c.bloqueios }
    }
    por.set(c.nome, x)
  }
  return { v: 3, cotistas: [...por.values()], dataBase: d.dataRef || null, extratos: {}, depara: {}, extras }
}

const fmt = (v) => 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
