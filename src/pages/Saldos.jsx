import { useEffect, useMemo, useRef, useState } from 'react'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { Upload, FileSpreadsheet, Download, X } from 'lucide-react'
import { db } from '../lib/firebase'
import { PageHeader, Card } from '../components/PageShell'

const DOC_REF = () => doc(db, 'controle', 'saldos_v2')

const sdFmt = (v) =>
  v === null || v === undefined ? '—' : 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const emptySD = () => ({
  cotistas: [],
  dataRef: null,
  extratos: {},
  rfSaldoInicial: 0,
  rfSaldoAtual: 0,
  sobSaldoInicial: 0,
  sobSaldoAtual: 0,
})

const STOPWORDS = new Set([
  'DE', 'DO', 'DA', 'EM', 'NO', 'NA', 'DOS', 'DAS', 'FUNDO', 'INVESTIMENTO',
  'DIREITOS', 'CREDITORIOS', 'FINANCEIRO', 'RENDA', 'FIXA', 'LONGO', 'PRAZO', 'CREDITO', 'PRIVADO',
  'RESPONSABILIDADE', 'LIMITADA', 'SIMPLES', 'COTAS', 'FUNDOS', 'MULTIMERCADO', 'IMOBILIARIO',
  'PARTICIPACOES', 'MULTIESTRATEGIA', 'NAO', 'PADRONIZADO', 'PADRONIZADOS', 'FIAGRO', 'AGROINDUSTRIAL',
])
function matchNome(nomeExt, lista) {
  const ne = nomeExt.toUpperCase().replace(/\s+/g, ' ').trim()
  let r = lista.find((c) => c.nome.toUpperCase().replace(/\s+/g, ' ').trim() === ne)
  if (r) return r
  r = lista.find((c) => {
    const nc = c.nome.toUpperCase().replace(/\s+/g, ' ').trim()
    return ne.length >= 50 && nc.length >= 50 && (ne.startsWith(nc.slice(0, 50)) || nc.startsWith(ne.slice(0, 50)))
  })
  if (r) return r
  const tokens = (s) => s.split(' ').filter((w) => w.length > 2 && !STOPWORDS.has(w))
  r = lista.find((c) => {
    const tokLiq = tokens(c.nome.toUpperCase().replace(/\s+/g, ' ').trim())
    const tokExt = tokens(ne)
    if (!tokLiq.length || !tokExt.length) return false
    if (tokLiq[0] !== tokExt[0]) return false
    const common = tokExt.filter((t) => tokLiq.includes(t))
    return common.length >= 2
  })
  return r || null
}

export default function Saldos() {
  const [SD, setSD] = useState(emptySD())
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filtro, setFiltro] = useState('todos')
  const [sort, setSort] = useState({ col: null, asc: true })
  const [bloqIdx, setBloqIdx] = useState(null)
  const [bloqVal, setBloqVal] = useState('')
  const [bloqDesc, setBloqDesc] = useState('')
  const liqInputRef = useRef(null)
  const extInputRef = useRef(null)

  useEffect(() => {
    let mounted = true
    getDoc(DOC_REF())
      .then((snap) => {
        if (!mounted) return
        if (snap.exists()) setSD({ ...emptySD(), ...snap.data() })
      })
      .catch((e) => console.warn('sdLoad err', e))
      .finally(() => mounted && setLoading(false))
    return () => { mounted = false }
  }, [])

  function save(next) {
    setSD(next)
    setDoc(DOC_REF(), JSON.parse(JSON.stringify(next)), { merge: false }).catch((e) => console.warn('sdSave err', e))
  }

  function importLiquidez(file) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const parser = new DOMParser()
        const doc_ = parser.parseFromString(e.target.result, 'text/html')
        const rows = [...doc_.querySelectorAll('tr')]
        const cotistas = []
        let headerFound = false
        rows.forEach((tr) => {
          const cells = [...tr.querySelectorAll('td,th')].map((c) => c.textContent.trim())
          if (!headerFound) {
            if (cells.some((c) => c.includes('Fundo (Cotista)'))) headerFound = true
            return
          }
          if (cells.length < 6) return
          const seq = String(cells[0] || '').trim()
          const nome = String(cells[1] || '').trim()
          const nomeParecTotais = !isNaN(parseFloat(nome.replace(/\./g, '').replace(',', '.'))) && nome.replace(/[0-9.,]/g, '').trim() === ''
          if (!nome || nome.toUpperCase().includes('TOTAL') || nome === 'nan' || nome === 'Fundo (Cotista)' || seq.toUpperCase().includes('TOTAL') || nomeParecTotais) return
          const parseV = (s) => {
            const v = parseFloat(String(s).replace(/[^0-9]/g, ''))
            return isNaN(v) || v < 0 ? 0 : v / 100
          }
          const idRF = parseV(cells[4])
          const idSob = parseV(cells[5])
          if (idRF > 0) cotistas.push({ nome: nome.substring(0, 120), fundo: 'ID RF', saldoInicial: idRF, saldoAtualizado: idRF, saldoBloqueado: 0 })
          if (idSob > 0) cotistas.push({ nome: nome.substring(0, 120), fundo: 'ID Soberano', saldoInicial: idSob, saldoAtualizado: idSob, saldoBloqueado: 0 })
          if (idRF === 0 && idSob === 0) cotistas.push({ nome: nome.substring(0, 120), fundo: '—', saldoInicial: 0, saldoAtualizado: 0, saldoBloqueado: 0, _semFundo: true })
        })
        if (!cotistas.length) { alert('⚠ Nenhum cotista encontrado. Verifique o arquivo.'); return }
        cotistas.forEach((c) => {
          const existing = SD.cotistas.find((x) => x.nome === c.nome && x.fundo === c.fundo)
          if (existing) {
            c.saldoBloqueado = existing.saldoBloqueado || 0
            if (existing.bloqueios) c.bloqueios = existing.bloqueios
          }
        })
        const next = {
          ...SD,
          cotistas,
          dataRef: new Date().toLocaleDateString('pt-BR'),
          extratos: {},
          rfSaldoAtual: 0,
          sobSaldoAtual: 0,
          rfSaldoInicial: cotistas.filter((c) => c.fundo === 'ID RF').reduce((a, c) => a + c.saldoInicial, 0),
          sobSaldoInicial: cotistas.filter((c) => c.fundo === 'ID Soberano').reduce((a, c) => a + c.saldoInicial, 0),
        }
        cotistas.forEach((c) => { delete c._fundoIncorreto; delete c._regularizado })
        save(next)
      } catch (err) {
        console.error(err)
        alert('⚠ Erro ao ler planilha: ' + err.message)
      }
    }
    reader.readAsText(file, 'iso-8859-1')
  }

  function importExtrato(file) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const text = e.target.result
        const csvLines = text.split('\n').filter((l) => l.trim())
        const sep = csvLines[0].includes(';') ? ';' : ','
        const rows = csvLines.map((l) => l.split(sep).map((c) => c.replace(/"/g, '').trim()))
        const hdr = rows[0].map((h) => h.toLowerCase())
        const dcI = hdr.findIndex((h) => h === 'fl_debito_credito')
        const valI = hdr.findIndex((h) => h === 'valor')
        const descI = hdr.findIndex((h) => h === 'ds_complemento')
        const saldoI = hdr.findIndex((h) => h === 'vl_saldo_in')
        const dtI = hdr.findIndex((h) => h === 'dt_mov')
        const histI = hdr.findIndex((h) => h === 'ds_historico')
        if (dcI < 0 || valI < 0 || descI < 0) { alert('⚠ Colunas não encontradas no CSV'); return }
        const parseV = (s) => parseFloat(String(s).replace(',', '.')) || 0
        const data = rows.slice(1).filter((r) => r.length > Math.max(dcI, valI, descI))
        const isSob = file.name.includes('454398')
        const fundoKey = isSob ? 'ID Soberano' : 'ID RF'
        const outroFundoKey = isSob ? 'ID RF' : 'ID Soberano'

        const ultimaLinha = data[data.length - 1]
        const lastSaldoIn = saldoI >= 0 && ultimaLinha?.[saldoI] ? parseV(ultimaLinha[saldoI]) : null
        const lastDC = (ultimaLinha?.[dcI] || '').trim().toUpperCase()
        const lastVal = parseV(ultimaLinha?.[valI])
        const saldoFundoAtual = lastSaldoIn != null ? Math.max(0, lastDC === 'D' ? lastSaldoIn - lastVal : lastSaldoIn + lastVal) : 0

        const movMap = {}
        data.forEach((r) => {
          const dc = (r[dcI] || '').trim().toUpperCase()
          const v = parseV(r[valI])
          const nome = (r[descI] || '').trim().toUpperCase().replace(/\s+/g, ' ')
          const isInterno =
            nome.includes('TARIFA') || nome.includes('LANCAMENTO DE TARIFA') ||
            (nome.startsWith('ID RF FUNDO') && !isSob) ||
            (nome.startsWith('ID SOBERANO FUNDO') && isSob) ||
            (nome.startsWith('ID RF LONGO') && isSob) ||
            nome.startsWith('EBS2 TRADE')
          if (!nome || !['D', 'C'].includes(dc) || isInterno) return
          if (!movMap[nome]) movMap[nome] = { debitos: 0, creditos: 0, qtdD: 0, qtdC: 0, detalhes: [] }
          if (dc === 'D') { movMap[nome].debitos += v; movMap[nome].qtdD++ } else { movMap[nome].creditos += v; movMap[nome].qtdC++ }
          movMap[nome].detalhes.push({ dc, v, dt: dtI >= 0 ? r[dtI] : '', hist: histI >= 0 ? r[histI] : '' })
        })

        const cotistas = SD.cotistas.map((c) => ({ ...c }))
        cotistas.filter((c) => c.fundo === outroFundoKey).forEach((c) => {
          if (c._fundoIncorreto) delete c._fundoIncorreto
          if (c.obs && c.obs.includes('Resgate no ' + fundoKey)) c.obs = null
        })

        const fundoCotistas = cotistas.filter((c) => c.fundo === fundoKey && !c._wrongFund && !c._semFundo)
        fundoCotistas.forEach((c) => { c.saldoAtualizado = c.saldoInicial; c.movDetalhes = null; c.obs = null })

        let matched = 0
        Object.keys(movMap).forEach((nomeExt) => {
          const mov = movMap[nomeExt]
          const cotista = matchNome(nomeExt, fundoCotistas)
          if (cotista) {
            cotista.saldoAtualizado = cotista.saldoInicial - mov.debitos + mov.creditos
            cotista.movDetalhes = mov
            if (mov.qtdD > 1) cotista.obs = mov.qtdD + 'x resgates (R$ ' + mov.debitos.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) + ' total)'
            matched++
          } else if (mov.debitos > 0) {
            const posOutro = matchNome(nomeExt, cotistas.filter((c) => c.fundo === outroFundoKey && !c._wrongFund && !c._semFundo))
            if (posOutro) {
              posOutro._fundoIncorreto = posOutro._fundoIncorreto || []
              posOutro._fundoIncorreto.push({ fundo: fundoKey, debitos: mov.debitos, creditos: mov.creditos, qtdD: mov.qtdD, detalhes: mov.detalhes })
              posOutro.obs = (mov.qtdD > 1 ? mov.qtdD + 'x resgates no ' + fundoKey + ' (' + sdFmt(mov.debitos) + ') — ' : 'Resgate no ' + fundoKey + ' — ') + 'Tem posição aqui no ' + outroFundoKey
            } else {
              const alvo = matchNome(nomeExt, cotistas.filter((c) => c._semFundo))
              if (alvo) {
                alvo._fundoIncorreto = alvo._fundoIncorreto || []
                alvo._fundoIncorreto.push({ fundo: fundoKey, debitos: mov.debitos, creditos: mov.creditos, qtdD: mov.qtdD, detalhes: mov.detalhes })
                alvo.obs = 'Resgate no ' + fundoKey + ' (' + sdFmt(mov.debitos) + ') — sem posição em nenhum fundo de zeragem'
                alvo.movDetalhes = mov
              }
            }
          }
        })

        const next = {
          ...SD,
          cotistas,
          dataRef: new Date().toLocaleDateString('pt-BR'),
          rfSaldoAtual: isSob ? SD.rfSaldoAtual : saldoFundoAtual,
          sobSaldoAtual: isSob ? saldoFundoAtual : SD.sobSaldoAtual,
          rfSaldoInicial: cotistas.filter((c) => c.fundo === 'ID RF' && !c._wrongFund).reduce((a, c) => a + c.saldoInicial, 0),
          sobSaldoInicial: cotistas.filter((c) => c.fundo === 'ID Soberano' && !c._wrongFund).reduce((a, c) => a + c.saldoInicial, 0),
        }
        save(next)
        alert('✅ Extrato ' + fundoKey + ' importado — ' + matched + ' de ' + Object.keys(movMap).length + ' cotistas encontrados na liquidez')
      } catch (err) {
        console.error(err)
        alert('⚠ Erro: ' + err.message)
      }
    }
    reader.readAsText(file, 'iso-8859-1')
  }

  function regularizar(idx) {
    const cotistas = SD.cotistas.map((c, i) => (i === idx ? { ...c, _regularizado: true } : c))
    save({ ...SD, cotistas })
  }

  function openBloq(idx) {
    setBloqIdx(idx)
    setBloqVal('')
    setBloqDesc('')
  }

  function addBloqueio() {
    if (bloqIdx === null) return
    const v = parseFloat(String(bloqVal).replace(/\./g, '').replace(',', '.')) || 0
    if (!v) { alert('⚠ Digite um valor'); return }
    const cotistas = SD.cotistas.map((c, i) => {
      if (i !== bloqIdx) return c
      const bloqueios = [...(c.bloqueios || []), { valor: v, desc: bloqDesc.trim(), data: new Date().toLocaleDateString('pt-BR') }]
      return { ...c, bloqueios, saldoBloqueado: bloqueios.reduce((a, b) => a + b.valor, 0) }
    })
    save({ ...SD, cotistas })
    setBloqVal(''); setBloqDesc('')
  }

  function removeBloqueio(bIdx) {
    if (bloqIdx === null) return
    const cotistas = SD.cotistas.map((c, i) => {
      if (i !== bloqIdx) return c
      const bloqueios = (c.bloqueios || []).filter((_, j) => j !== bIdx)
      return { ...c, bloqueios, saldoBloqueado: bloqueios.reduce((a, b) => a + b.valor, 0) }
    })
    save({ ...SD, cotistas })
  }

  function exportCSV() {
    if (!SD.cotistas.length) { alert('Nenhum dado para exportar'); return }
    const h = 'Cotista;Fundo;Saldo Inicial;Movimentação;Saldo Atualizado;Saldo Bloqueado;Saldo Utilizado;Status;Observação'
    const fmt = (v) => (v != null ? Number(v).toFixed(2).replace('.', ',') : '')
    const lines = SD.cotistas.map((r) => {
      const sat2 = r.saldoAtualizado != null ? r.saldoAtualizado : r.saldoInicial
      const mov2 = sat2 - r.saldoInicial
      const al2 = sat2 < -1
      const outro2 = SD.cotistas.find((c) => c.nome === r.nome && c.fundo !== r.fundo)
      const temOutro2 = outro2 && (outro2.saldoAtualizado != null ? outro2.saldoAtualizado : outro2.saldoInicial) > 0
      const semPos2 = r.saldoInicial <= 0.01 && mov2 < -0.01
      const status2 = al2
        ? semPos2
          ? temOutro2 ? 'Fundo incorreto - sem posicao aqui, saldo no ' + (r.fundo === 'ID RF' ? 'ID Soberano' : 'ID RF') : 'Resgate em fundo incorreto'
          : temOutro2 ? 'Resgate a maior - tem saldo no ' + (r.fundo === 'ID RF' ? 'ID Soberano' : 'ID RF') : 'Resgate a maior'
        : 'OK'
      return [r.nome, r.fundo, fmt(r.saldoInicial), fmt(mov2), fmt(sat2), fmt(r.saldoBloqueado || 0), al2 ? fmt(sat2) : '', status2, r.obs || ''].join(';')
    })
    const csv = '\uFEFF' + h + '\n' + lines.join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    a.download = 'saldos_' + new Date().toISOString().slice(0, 10) + '.csv'
    a.click()
  }

  const rows = useMemo(() => {
    let list = [...SD.cotistas]
    if (search) list = list.filter((r) => r.nome.toLowerCase().includes(search.toLowerCase()))
    if (filtro === 'rf') list = list.filter((r) => r.fundo === 'ID RF')
    if (filtro === 'sob') list = list.filter((r) => r.fundo === 'ID Soberano')
    if (filtro === 'alerta') list = list.filter((r) => (r.saldoAtualizado != null ? r.saldoAtualizado : r.saldoInicial) < -1)
    if (filtro === 'semsaldo') list = list.filter((r) => (r.saldoInicial || 0) <= 0.01 && !r._wrongFund)
    if (filtro === 'incorreto') list = list.filter((r) => r._fundoIncorreto?.length && !r._regularizado)

    if (sort.col) {
      list.sort((a, b) => {
        const satA = a.saldoAtualizado != null ? a.saldoAtualizado : a.saldoInicial
        const satB = b.saldoAtualizado != null ? b.saldoAtualizado : b.saldoInicial
        let va, vb
        if (sort.col === 'nome') { va = a.nome || ''; vb = b.nome || ''; return sort.asc ? va.localeCompare(vb, 'pt-BR') : vb.localeCompare(va, 'pt-BR') }
        if (sort.col === 'fundo') { va = a.fundo || ''; vb = b.fundo || ''; return sort.asc ? va.localeCompare(vb, 'pt-BR') : vb.localeCompare(va, 'pt-BR') }
        if (sort.col === 'saldoInicial') { va = a.saldoInicial || 0; vb = b.saldoInicial || 0 }
        if (sort.col === 'saldoAtualizado') { va = satA; vb = satB }
        return sort.asc ? va - vb : vb - va
      })
    }
    return list
  }, [SD.cotistas, search, filtro, sort])

  const alertas = SD.cotistas.filter((r) => {
    const sat = r.saldoAtualizado != null ? r.saldoAtualizado : r.saldoInicial
    return sat < -1 || (r._fundoIncorreto?.length && !r._regularizado)
  }).length
  const semSaldo = SD.cotistas.filter((r) => (r.saldoInicial || 0) <= 0.01 && !r._wrongFund).length

  function toggleSort(col) {
    setSort((s) => (s.col === col ? { col, asc: !s.asc } : { col, asc: true }))
  }

  const bloqCotista = bloqIdx !== null ? SD.cotistas[bloqIdx] : null

  return (
    <div>
      <PageHeader
        eyebrow="Operacional"
        title="Saldos"
        actions={
          <>
            <input ref={liqInputRef} type="file" accept=".xls,.html,.htm" className="hidden" onChange={(e) => importLiquidez(e.target.files[0])} />
            <button onClick={() => liqInputRef.current?.click()} className="flex items-center gap-1.5 text-[12px] border border-bg-border rounded-lg px-3 py-1.5 text-slate-300 hover:bg-bg-panel2">
              <FileSpreadsheet size={13} /> Importar Liquidez
            </button>
            <input ref={extInputRef} type="file" accept=".csv" className="hidden" onChange={(e) => importExtrato(e.target.files[0])} />
            <button onClick={() => extInputRef.current?.click()} className="flex items-center gap-1.5 text-[12px] border border-bg-border rounded-lg px-3 py-1.5 text-slate-300 hover:bg-bg-panel2">
              <Upload size={13} /> Importar Extrato
            </button>
            <button onClick={exportCSV} className="flex items-center gap-1.5 text-[12px] bg-id-dark hover:bg-id-mid rounded-lg px-3 py-1.5 font-medium">
              <Download size={13} /> Exportar CSV
            </button>
          </>
        }
      />
      <p className="text-[11px] text-slate-500 -mt-3 mb-4">Data de referência: {SD.dataRef || '—'}</p>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
        <Card className="p-3">
          <div className="text-[10px] uppercase text-slate-500">ID RF · Inicial</div>
          <div className="font-display text-lg font-semibold text-sky-400">{sdFmt(SD.rfSaldoInicial)}</div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] uppercase text-slate-500">ID RF · Atual</div>
          <div className="font-display text-lg font-semibold text-id-light">{SD.rfSaldoAtual ? sdFmt(SD.rfSaldoAtual) : 'Aguardando extrato'}</div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] uppercase text-slate-500">ID Soberano · Inicial</div>
          <div className="font-display text-lg font-semibold text-purple-400">{sdFmt(SD.sobSaldoInicial)}</div>
        </Card>
        <Card className="p-3">
          <div className="text-[10px] uppercase text-slate-500">ID Soberano · Atual</div>
          <div className="font-display text-lg font-semibold text-id-light">{SD.sobSaldoAtual ? sdFmt(SD.sobSaldoAtual) : 'Aguardando extrato'}</div>
        </Card>
        <Card className={`p-3 cursor-pointer ${alertas > 0 ? 'border-red-500/40' : ''}`} onClick={() => setFiltro((f) => (f === 'alerta' ? 'todos' : 'alerta'))}>
          <div className="text-[10px] uppercase text-slate-500">Alertas</div>
          <div className={`font-display text-lg font-semibold ${alertas > 0 ? 'text-red-400' : 'text-id-light'}`}>{alertas > 0 ? `⚠ ${alertas}` : '✅ Todos OK'}</div>
        </Card>
        <Card className={`p-3 cursor-pointer ${semSaldo > 0 ? 'border-amber-500/40' : ''}`} onClick={() => setFiltro((f) => (f === 'semsaldo' ? 'todos' : 'semsaldo'))}>
          <div className="text-[10px] uppercase text-slate-500">Sem saldo</div>
          <div className={`font-display text-lg font-semibold ${semSaldo > 0 ? 'text-amber-400' : 'text-slate-500'}`}>{semSaldo > 0 ? `⚪ ${semSaldo}` : '—'}</div>
        </Card>
      </div>

      <Card>
        <div className="p-3 border-b border-bg-border flex gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar cotista…"
            className="flex-1 bg-bg-panel2 border border-bg-border rounded-lg px-3 py-2 text-[12px] outline-none focus:border-id-mid placeholder:text-slate-500"
          />
          <select value={filtro} onChange={(e) => setFiltro(e.target.value)} className="bg-bg-panel2 border border-bg-border rounded-lg px-2 text-[12px]">
            <option value="todos">Todos</option>
            <option value="rf">ID RF</option>
            <option value="sob">ID Soberano</option>
            <option value="alerta">Alertas</option>
            <option value="semsaldo">Sem saldo</option>
            <option value="incorreto">Fundo incorreto</option>
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10.5px] uppercase tracking-wider text-slate-500 border-b border-bg-border">
                {[['nome', 'Cotista'], ['fundo', 'Fundo'], ['saldoInicial', 'Saldo inicial'], ['saldoAtualizado', 'Saldo atualizado']].map(([col, label]) => (
                  <th key={col} className="px-3 py-2.5 font-medium cursor-pointer select-none" onClick={() => toggleSort(col)}>
                    {label}{sort.col === col ? (sort.asc ? ' ↑' : ' ↓') : ''}
                  </th>
                ))}
                <th className="px-3 py-2.5 font-medium">Bloqueado</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 font-medium">Obs.</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="text-center py-10 text-slate-500">Carregando…</td></tr>
              ) : !rows.length ? (
                <tr><td colSpan={7} className="text-center py-10 text-slate-500">{SD.cotistas.length ? 'Nenhum resultado para o filtro.' : 'Nenhum cotista. Clique em Importar Liquidez para começar.'}</td></tr>
              ) : rows.map((r) => {
                const idx = SD.cotistas.indexOf(r)
                const sat = r.saldoAtualizado != null ? r.saldoAtualizado : r.saldoInicial
                const saldoDisp = sat - (r.saldoBloqueado || 0)
                const alerta = saldoDisp < -1
                const semPosicao = !!(r._fundoIncorreto?.length)
                return (
                  <tr key={idx} className="border-b border-bg-border/60 hover:bg-bg-panel2/60 text-[12.5px]">
                    <td className="px-3 py-2.5 font-medium max-w-[240px] truncate" title={r.nome}>{r.nome}</td>
                    <td className="px-3 py-2.5">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${r.fundo === 'ID RF' ? 'bg-sky-500/15 text-sky-300' : r.fundo === 'ID Soberano' ? 'bg-purple-500/15 text-purple-300' : 'bg-bg-panel2 text-slate-500'}`}>{r.fundo || '—'}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{sdFmt(r.saldoInicial)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{sdFmt(sat)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums cursor-pointer text-id-light" onClick={() => openBloq(idx)}>
                      {r.bloqueios?.length ? sdFmt(r.saldoBloqueado) : <span className="text-slate-500 text-[11px]">+ Adicionar</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      {semPosicao ? (
                        r._regularizado ? (
                          <span className="text-[10.5px] px-2 py-0.5 rounded-md bg-id-mid/15 text-id-light">✅ Regularizado</span>
                        ) : (
                          <span className="flex items-center gap-1.5">
                            <span className="text-[10.5px] px-2 py-0.5 rounded-md bg-purple-500/15 text-purple-300">⚠ Fundo incorreto</span>
                            <button onClick={() => regularizar(idx)} className="text-[10px] border border-purple-400/40 text-purple-300 rounded-full px-2 py-0.5">Regularizar</button>
                          </span>
                        )
                      ) : alerta ? (
                        <span className="text-[10.5px] px-2 py-0.5 rounded-md bg-red-500/15 text-red-400">⚠ Resgate a maior</span>
                      ) : (
                        <span className="text-[10.5px] px-2 py-0.5 rounded-md bg-id-mid/15 text-id-light">✅ OK</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-[11px] text-amber-400/90 max-w-[220px] truncate" title={r.obs || ''}>{r.obs || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2.5 text-[11px] text-slate-500 border-t border-bg-border">{rows.length} de {SD.cotistas.length} cotistas</div>
      </Card>

      {bloqCotista && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setBloqIdx(null)}>
          <div className="bg-bg-panel border border-bg-border rounded-xl w-full max-w-[380px] p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="font-medium text-[13px]">{bloqCotista.nome}</div>
                <div className="text-[11px] text-slate-500">{bloqCotista.fundo}</div>
              </div>
              <button onClick={() => setBloqIdx(null)} className="text-slate-500 hover:text-white"><X size={16} /></button>
            </div>
            <div className="flex gap-2 mb-2">
              <input value={bloqVal} onChange={(e) => setBloqVal(e.target.value)} placeholder="Valor" className="w-[110px] bg-bg-panel2 border border-bg-border rounded-lg px-2 py-1.5 text-[12px]" />
              <input value={bloqDesc} onChange={(e) => setBloqDesc(e.target.value)} placeholder="Descrição" className="flex-1 bg-bg-panel2 border border-bg-border rounded-lg px-2 py-1.5 text-[12px]" />
              <button onClick={addBloqueio} className="bg-id-dark hover:bg-id-mid rounded-lg px-3 text-[12px]">+</button>
            </div>
            <div className="space-y-1.5 max-h-[220px] overflow-y-auto">
              {!bloqCotista.bloqueios?.length ? (
                <div className="text-[12px] text-slate-500 text-center py-3">Nenhum bloqueio cadastrado</div>
              ) : bloqCotista.bloqueios.map((b, i) => (
                <div key={i} className="flex items-center gap-2 bg-bg-panel2 border border-bg-border rounded-lg px-2.5 py-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-medium tabular-nums">{sdFmt(b.valor)}</div>
                    <div className="text-[11px] text-slate-500 truncate">{b.desc || 'Sem descrição'} · {b.data}</div>
                  </div>
                  <button onClick={() => removeBloqueio(i)} className="text-red-400 text-[13px]">✕</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
