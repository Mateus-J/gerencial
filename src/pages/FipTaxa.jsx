import { useEffect, useMemo, useRef, useState } from 'react'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import * as XLSX from 'xlsx'
import { Upload, Download, Trash2, Plus, Info, X } from 'lucide-react'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell,
} from 'recharts'
import { db } from '../lib/firebase'
import { PageHeader, Card } from '../components/PageShell'
import { useToast } from '../components/Toast'

// Os dois FIP (Custódia e Administração) leem/escrevem no MESMO documento —
// vêm da mesma planilha e representam o mesmo conjunto de lançamentos, só
// que cada tela foca e soma uma coluna de valor diferente.
const DOC_REF = () => doc(db, 'controle', 'fip_taxas')
// Cadastro dos FIPs (CNPJ → Administrador/Custodiante/Gestor/Situação) — é
// o que define quem realmente cobra custódia/administração de cada fundo.
const CADASTRO_REF = () => doc(db, 'controle', 'fip_cadastro')
const FIP_C = ['#8FB352', '#38bdf8', '#a78bfa', '#f59e0b', '#2dd4bf', '#f87171', '#0ea5e9', '#84cc16', '#ec4899', '#eab308']

const norm = (s) => (s || '').toString().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
const onlyDigits = (s) => (s || '').toString().replace(/\D/g, '')

const fFmt = (v) => { v = Number(v) || 0; return 'R$ ' + (v >= 1e6 ? (v / 1e6).toFixed(2).replace('.', ',') + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1).replace('.', ',') + 'K' : v.toFixed(0)) }
const fFull = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })
const sortKey = (m) => { const p = (m || '').split('.'); return (parseInt(p[1]) || 0) * 100 + (parseInt(p[0]) || 0) }

function excelDateToISO(v) {
  if (!v) return ''
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10)
  if (typeof v === 'number') {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000))
    return isNaN(d) ? '' : d.toISOString().slice(0, 10)
  }
  const s = String(v).trim()
  let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  if (m) return `${m[3]}-${m[2]}-${m[1]}`
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return s.slice(0, 10)
  return ''
}
function toMesRef(v) {
  const iso = excelDateToISO(v)
  if (!iso) return null
  const [y, m] = iso.split('-')
  return m + '.' + y
}
function brDate(iso) {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

function parseNum(v) {
  if (v === '' || v === null || v === undefined) return 0
  const n = parseFloat(String(v).replace(/\./g, (m, o, s) => (s.indexOf(',') > o ? '' : m)).replace(',', '.'))
  return isNaN(n) ? 0 : n
}

export default function FipTaxa({ campo, title }) {
  const toast = useToast()
  const [parsed, setParsed] = useState(null)
  const [cadastro, setCadastro] = useState({})
  const [cadastroImportedAt, setCadastroImportedAt] = useState(null)
  const [loading, setLoading] = useState(true)
  const [importedAt, setImportedAt] = useState(null)
  const [mode, setMode] = useState('all')
  const [selMes, setSelMes] = useState(null)
  const [fGestor, setFGestor] = useState('')
  const [fSituacao, setFSituacao] = useState('')
  const [fStatus, setFStatus] = useState('')
  const [fFundo, setFFundo] = useState('')
  const [sortCol, setSortCol] = useState('val')
  const [sortAsc, setSortAsc] = useState(false)
  const [selected, setSelected] = useState(new Set())
  const [detailRow, setDetailRow] = useState(null)
  const fileRef = useRef(null)
  const cadastroFileRef = useRef(null)

  const valField = campo === 'custodia' ? 'valorCustodia' : 'valorAdm'

  useEffect(() => {
    let mounted = true
    getDoc(DOC_REF())
      .then((snap) => {
        if (!mounted) return
        if (snap.exists()) {
          const d = snap.data()
          setParsed(d.parsed || [])
          setImportedAt(d.importedAt || null)
        }
      })
      .catch((e) => console.warn('fipLoad err', e))
      .finally(() => mounted && setLoading(false))
    getDoc(CADASTRO_REF())
      .then((snap) => { if (mounted && snap.exists()) { setCadastro(snap.data().map || {}); setCadastroImportedAt(snap.data().importedAt || null) } })
      .catch((e) => console.warn('fipCadastroLoad err', e))
    return () => { mounted = false }
  }, [])

  function handleImportCadastro(file) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = async (e) => {
      try {
        const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
        const hdrIdx = raw.findIndex((r) => String(r[0] || '').toLowerCase().includes('cnpj'))
        if (hdrIdx < 0) { toast.error('Não encontrei a coluna CNPJ no cadastro.'); return }
        const headerRow = raw[hdrIdx].map((h) => String(h || '').toLowerCase().trim())
        const findCol = (...kw) => { for (let i = 0; i < headerRow.length; i++) if (kw.some((k) => headerRow[i].includes(k))) return i; return -1 }
        const idx = {
          cnpj: (() => { const i = findCol('cnpj'); return i >= 0 ? i : 0 })(),
          nome: (() => { const i = findCol('nome do fundo', 'nome'); return i >= 0 ? i : 1 })(),
          classificacao: (() => { const i = findCol('classificaç'); return i >= 0 ? i : 5 })(),
          administrador: (() => { const i = findCol('administrador'); return i >= 0 ? i : 6 })(),
          custodiante: (() => { const i = findCol('custodiante'); return i >= 0 ? i : 7 })(),
          gestor: (() => { const i = findCol('gestor'); return i >= 0 ? i : 8 })(),
          situacao: (() => { const i = findCol('situaç'); return i >= 0 ? i : 9 })(),
        }
        const map = {}
        raw.slice(hdrIdx + 1).forEach((r) => {
          const cnpjRaw = String(r[idx.cnpj] || '').trim()
          const cnpjKey = onlyDigits(cnpjRaw)
          if (!cnpjKey) return
          map[cnpjKey] = {
            cnpj: cnpjRaw,
            nome: String(r[idx.nome] || '').trim(),
            classificacao: String(r[idx.classificacao] || '').trim(),
            administrador: String(r[idx.administrador] || '').trim(),
            custodiante: String(r[idx.custodiante] || '').trim(),
            gestor: String(r[idx.gestor] || '').trim(),
            situacao: String(r[idx.situacao] || '').trim(),
          }
        })
        if (!Object.keys(map).length) { toast.error('Nenhum CNPJ válido encontrado no cadastro.'); return }
        const now = new Date().toLocaleString('pt-BR')
        await setDoc(CADASTRO_REF(), { map, importedAt: now }, { merge: false })
        setCadastro(map)
        setCadastroImportedAt(now)
        toast.success(`Cadastro importado: ${Object.keys(map).length} fundos.`)
      } catch (err) { console.error(err); toast.error('Erro: ' + err.message) }
    }
    reader.readAsArrayBuffer(file)
  }

  async function persist(nextParsed) {
    setParsed(nextParsed)
    try { await setDoc(DOC_REF(), { parsed: nextParsed, importedAt }, { merge: false }) } catch (e) { console.warn('fipSave err', e); toast.error('Erro ao salvar: ' + e.message) }
  }

  function handleImport(file) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = async (e) => {
      try {
        const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellDates: true })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
        let hdrIdx = raw.findIndex((r) => String(r[0] || '').toLowerCase().includes('data da receita'))
        if (hdrIdx < 0) hdrIdx = raw.findIndex((r) => (r || []).some((c) => String(c || '').toLowerCase().includes('cnpj')))
        if (hdrIdx < 0) { toast.error('Não encontrei o cabeçalho da planilha (esperava a coluna "Data da receita...").'); return }
        const headerRow = raw[hdrIdx].map((h) => String(h || '').toLowerCase().trim())
        const findCol = (...kw) => { for (let i = 0; i < headerRow.length; i++) if (kw.some((k) => headerRow[i].includes(k))) return i; return -1 }

        const idx = {
          dataReceita: (() => { const i = findCol('data da receita'); return i >= 0 ? i : 0 })(),
          dataPrevista: (() => { const i = findCol('data prevista'); return i >= 0 ? i : 1 })(),
          valorAdm: (() => { const i = headerRow.findIndex((h) => h.includes('receita') && h.includes('adm')); return i >= 0 ? i : 2 })(),
          valorCustodia: (() => { const i = headerRow.findIndex((h) => h.includes('receita') && h.includes('custód')); return i >= 0 ? i : 3 })(),
          fundo: (() => { const i = findCol('a que se refere', 'despesa paga'); return i >= 0 ? i : 4 })(),
          classificacao: (() => { const i = findCol('classificaç'); return i >= 0 ? i : 5 })(),
          cnpj: (() => { const i = findCol('cnpj'); return i >= 0 ? i : 6 })(),
          conta: (() => { const i = findCol('conta'); return i >= 0 ? i : 7 })(),
          valorTotal: (() => { const i = findCol('valor total'); return i >= 0 ? i : 8 })(),
          administrador: (() => { const i = headerRow.findIndex((h) => h === 'administrador'); return i >= 0 ? i : 9 })(),
          custodiaEmpresa: (() => { const i = headerRow.findIndex((h) => h === 'custódia' || h === 'custodia'); return i >= 0 ? i : 10 })(),
          gestor: (() => { const i = headerRow.findIndex((h) => h === 'gestor'); return i >= 0 ? i : 11 })(),
          saldos: (() => { const i = findCol('saldos'); return i >= 0 ? i : 12 })(),
          resgatar: (() => { const i = findCol('resgatar'); return i >= 0 ? i : 13 })(),
          dataPgto: (() => { const i = findCol('data de pgto', 'data pgto'); return i >= 0 ? i : 14 })(),
          status: (() => { const i = findCol('status'); return i >= 0 ? i : 15 })(),
          mesRef: (() => { const i = findCol('mês referencia', 'mes referencia', 'mês ref', 'mes ref'); return i >= 0 ? i : 16 })(),
          situacaoFundo: (() => { const i = findCol('situação do fundo', 'situacao do fundo'); return i >= 0 ? i : 17 })(),
          obs: (() => { const i = findCol('observaç'); return i >= 0 ? i : 18 })(),
        }

        const parsedNew = []
        raw.slice(hdrIdx + 1).forEach((r) => {
          const fundo = String(r[idx.fundo] || '').trim()
          if (!fundo) return
          const mesRef = toMesRef(r[idx.mesRef])
          const valorAdm = parseNum(r[idx.valorAdm])
          const valorCustodia = parseNum(r[idx.valorCustodia])
          if (!mesRef || (valorAdm <= 0 && valorCustodia <= 0)) return
          parsedNew.push({
            dataReceita: excelDateToISO(r[idx.dataReceita]),
            dataPrevista: excelDateToISO(r[idx.dataPrevista]),
            valorAdm, valorCustodia,
            fundo,
            classificacao: String(r[idx.classificacao] || '').trim(),
            cnpj: String(r[idx.cnpj] || '').trim(),
            conta: String(r[idx.conta] || '').trim(),
            valorTotal: parseNum(r[idx.valorTotal]),
            administrador: String(r[idx.administrador] || '').trim(),
            custodiaEmpresa: String(r[idx.custodiaEmpresa] || '').trim(),
            gestor: String(r[idx.gestor] || '').trim(),
            saldos: parseNum(r[idx.saldos]),
            resgatar: parseNum(r[idx.resgatar]),
            dataPgto: excelDateToISO(r[idx.dataPgto]),
            status: String(r[idx.status] || '').trim().toUpperCase() || 'PENDENTE',
            mesRef,
            situacaoFundo: String(r[idx.situacaoFundo] || '').trim(),
            obs: String(r[idx.obs] || '').trim(),
          })
        })
        if (!parsedNew.length) { toast.error('Nenhum dado válido no arquivo.'); return }

        const makeKey = (r) => (r.cnpj || r.fundo).trim().toUpperCase() + '|' + r.mesRef
        const existing = parsed || []
        const existingMap = {}
        existing.forEach((r, i) => { existingMap[makeKey(r)] = i })
        let countNew = 0, countUpdated = 0
        const merged = [...existing]
        parsedNew.forEach((row) => {
          const key = makeKey(row)
          if (key in existingMap) { merged[existingMap[key]] = { ...merged[existingMap[key]], ...row }; countUpdated++ }
          else { merged.push(row); countNew++ }
        })

        const now = new Date().toLocaleString('pt-BR')
        setImportedAt(now)
        setSelected(new Set())
        setMode('all')
        await persist(merged)
        toast.success(`Importado: ${countNew} novo(s), ${countUpdated} atualizado(s) — total ${merged.length} registros.`)
      } catch (err) { console.error(err); toast.error('Erro: ' + err.message) }
    }
    reader.readAsArrayBuffer(file)
  }

  const months = useMemo(() => [...new Set((parsed || []).map((r) => r.mesRef))].sort((a, b) => sortKey(a) - sortKey(b)), [parsed])
  const gestores = useMemo(() => [...new Set((parsed || []).map((r) => r.gestor).filter(Boolean))].sort(), [parsed])
  const situacoes = useMemo(() => [...new Set((parsed || []).map((r) => r.situacaoFundo).filter(Boolean))].sort(), [parsed])

  const filtered = useMemo(() => {
    if (!parsed) return []
    return parsed.filter((r) => {
      const cad = cadastro[onlyDigits(r.cnpj)]
      // Classificação vem do CADASTRO (Administrador/Custodiante reais por
      // fundo), não da planilha de lançamentos — que pode vir com a coluna
      // errada. Sem cadastro pra aquele CNPJ, o registro fica de fora (mais
      // seguro que assumir uma classificação incerta).
      if (campo === 'custodia') {
        if (!cad || !norm(cad.custodiante).includes('ID CTVM')) return false
      } else {
        if (!cad || !norm(cad.administrador).includes('HORIZON')) return false
      }
      if (mode === 'mes' && r.mesRef !== selMes) return false
      if (fGestor && r.gestor !== fGestor) return false
      if (fSituacao && r.situacaoFundo !== fSituacao) return false
      if (fStatus && r.status !== fStatus) return false
      if (fFundo && !r.fundo.toLowerCase().includes(fFundo.toLowerCase())) return false
      return true
    })
  }, [parsed, cadastro, campo, mode, selMes, fGestor, fSituacao, fStatus, fFundo])

  function editRow(ri, field, val) {
    const isNum = field === valField
    const next = parsed.map((r, i) => (i === ri ? { ...r, [field]: isNum ? parseNum(val) : val } : r))
    persist(next)
  }
  function deleteRow(ri) {
    if (!confirm('Excluir este registro?')) return
    persist(parsed.filter((_, i) => i !== ri))
    toast.success('Registro excluído.')
  }
  function addRow() {
    const mes = mode === 'mes' ? selMes : months[months.length - 1] || toMesRef(new Date())
    const novo = {
      dataReceita: '', dataPrevista: '', valorAdm: 0, valorCustodia: 0, fundo: 'Novo Fundo',
      classificacao: 'FIP', cnpj: '', conta: '', valorTotal: 0, administrador: '', custodiaEmpresa: '',
      gestor: '', saldos: 0, resgatar: 0, dataPgto: '', status: 'PENDENTE', mesRef: mes, situacaoFundo: 'ATIVO', obs: '',
    }
    persist([novo, ...(parsed || [])])
    toast.success('Registro adicionado!')
  }
  function bulkDelete() {
    if (!selected.size) return
    if (!confirm(`Excluir ${selected.size} registro(s) selecionado(s)?`)) return
    const n = selected.size
    persist(parsed.filter((_, i) => !selected.has(i)))
    setSelected(new Set())
    toast.success(`${n} registro(s) excluído(s).`)
  }
  function toggleSelect(ri) {
    setSelected((s) => { const n = new Set(s); n.has(ri) ? n.delete(ri) : n.add(ri); return n })
  }

  function exportCSV() {
    if (!filtered.length) { toast.error('Nenhum dado para exportar.'); return }
    const h = 'Fundo;Classificação;Gestor;CNPJ;Mês Ref;Status;Situação;Valor ADM;Valor Custódia;Valor Total'
    const lines = filtered.map((r) => [r.fundo, r.classificacao, r.gestor, r.cnpj, r.mesRef, r.status, r.situacaoFundo, r.valorAdm.toFixed(2).replace('.', ','), r.valorCustodia.toFixed(2).replace('.', ','), r.valorTotal.toFixed(2).replace('.', ',')].join(';'))
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['\uFEFF' + h + '\n' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }))
    a.download = 'fip_' + campo + '_' + new Date().toISOString().slice(0, 10) + '.csv'
    a.click()
    toast.success('CSV exportado!')
  }

  const sortedRows = useMemo(() => {
    if (!parsed) return []
    const rows = filtered.map((r) => ({ ...r, _ri: parsed.indexOf(r) }))
    rows.sort((a, b) => {
      const va = sortCol === 'val' ? a[valField] : (a[sortCol] || '').toString().toLowerCase()
      const vb = sortCol === 'val' ? b[valField] : (b[sortCol] || '').toString().toLowerCase()
      return sortAsc ? (va > vb ? 1 : va < vb ? -1 : 0) : (va < vb ? 1 : va > vb ? -1 : 0)
    })
    return rows.slice(0, 150)
  }, [filtered, sortCol, sortAsc, parsed, valField])

  if (loading) {
    return (
      <div>
        <PageHeader eyebrow="Área FIP" title={title} />
        <Card className="p-10 text-center text-[var(--tx3)]">Carregando…</Card>
      </div>
    )
  }

  if (!parsed || !parsed.length) {
    return (
      <div>
        <PageHeader
          eyebrow="Área FIP"
          title={title}
          actions={
            <>
              <input ref={cadastroFileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => handleImportCadastro(e.target.files[0])} />
              <button onClick={() => cadastroFileRef.current?.click()} className="flex items-center gap-1.5 text-[12px] border border-[var(--bdr)] rounded-lg px-3 py-1.5 text-[var(--tx2)] hover:bg-[var(--sur2)]">
                <Upload size={13} /> Importar cadastro FIPs
              </button>
              <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => handleImport(e.target.files[0])} />
              <button onClick={() => fileRef.current?.click()} className="flex items-center gap-1.5 text-[12px] bg-id-dark hover:bg-id-mid rounded-lg px-3 py-1.5 font-medium">
                <Upload size={13} /> Importar planilha
              </button>
            </>
          }
        />
        {!Object.keys(cadastro).length && (
          <p className="text-[11.5px] text-amber-500 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 mb-3">
            Sem o cadastro dos FIPs (CNPJ → Administrador/Custodiante) importado, nada aparece aqui — é ele que define o que é custódia da ID CTVM e o que é administração da Horizon.
          </p>
        )}
        <Card className="p-10 text-center text-[var(--tx3)]">Nenhum dado importado ainda. Importe a planilha de custódia dos FIPs (.xlsx) para começar.</Card>
      </div>
    )
  }

  const semCadastro = parsed.filter((r) => !cadastro[onlyDigits(r.cnpj)]).length

  const rows = filtered
  const total = rows.reduce((a, r) => a + r[valField], 0)
  const pago = rows.filter((r) => r.status === 'PAGO').reduce((a, r) => a + r[valField], 0)
  const pend = rows.filter((r) => r.status === 'PENDENTE').reduce((a, r) => a + r[valField], 0)
  const pct = total > 0 ? parseFloat(((pago / total) * 100).toFixed(2)) : 0
  const monthly = months.map((mes) => {
    const mr = parsed.filter((r) => r.mesRef === mes)
    const t = mr.reduce((a, r) => a + r[valField], 0)
    const p = mr.filter((r) => r.status === 'PAGO').reduce((a, r) => a + r[valField], 0)
    return { mes, total: t, pago: p }
  })
  const cur = monthly[monthly.length - 1]
  const prev = monthly.length >= 2 ? monthly[monthly.length - 2] : null
  const growth = prev && prev.total > 0 ? (((cur.total - prev.total) / prev.total) * 100).toFixed(1) : '0'
  const fundosU = new Set(rows.map((r) => r.fundo)).size
  const gestU = new Set(rows.map((r) => r.gestor).filter(Boolean)).size

  const agg = (key, sf) => {
    const m = {}
    rows.filter((r) => !sf || r.status === sf).forEach((r) => { m[r[key]] = (m[r[key]] || 0) + r[valField] })
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 7).map(([name, value]) => ({ name, value }))
  }
  const topDevedores = agg('fundo', 'PENDENTE')
  const topPagadores = agg('fundo', 'PAGO')
  const situacaoDist = agg('situacaoFundo').filter((c) => c.name)

  return (
    <div>
      <PageHeader
        eyebrow="Área FIP"
        title={title}
        actions={
          <>
            <input ref={cadastroFileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => handleImportCadastro(e.target.files[0])} />
            <button onClick={() => cadastroFileRef.current?.click()} className="flex items-center gap-1.5 text-[12px] border border-[var(--bdr)] rounded-lg px-3 py-1.5 text-[var(--tx2)] hover:bg-[var(--sur2)]">
              <Upload size={13} /> Cadastro FIPs
            </button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => handleImport(e.target.files[0])} />
            <button onClick={() => fileRef.current?.click()} className="flex items-center gap-1.5 text-[12px] border border-[var(--bdr)] rounded-lg px-3 py-1.5 text-[var(--tx2)] hover:bg-[var(--sur2)]">
              <Upload size={13} /> Importar planilha
            </button>
            <button onClick={exportCSV} className="flex items-center gap-1.5 text-[12px] bg-id-dark hover:bg-id-mid rounded-lg px-3 py-1.5 font-medium">
              <Download size={13} /> Exportar CSV
            </button>
          </>
        }
      />
      {semCadastro > 0 && (
        <p className="text-[11px] text-amber-500 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-1.5 mb-3">
          {semCadastro} lançamento(s) sem cadastro (CNPJ não encontrado) — não entram em nenhuma das duas telas até você importar/atualizar o cadastro dos FIPs.
          {cadastroImportedAt && <span className="text-[var(--tx4)]"> · cadastro importado em {cadastroImportedAt}</span>}
        </p>
      )}

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <button onClick={() => setMode('all')} className={`text-[11px] px-3 py-1 rounded-full border ${mode === 'all' ? 'bg-id-dark border-id-dark' : 'border-[var(--bdr)] text-[var(--tx3)]'}`}>Período completo</button>
        <button onClick={() => setMode('mes')} className={`text-[11px] px-3 py-1 rounded-full border ${mode === 'mes' ? 'bg-id-dark border-id-dark' : 'border-[var(--bdr)] text-[var(--tx3)]'}`}>Só um mês</button>
        <div className="flex gap-1 flex-wrap">
          {[...months].reverse().slice(0, 18).map((m) => (
            <button key={m} onClick={() => { setSelMes(m); setMode('mes') }} className={`text-[10.5px] font-mono px-2 py-0.5 rounded-full border ${selMes === m && mode === 'mes' ? 'bg-sky-500 border-sky-500' : 'border-[var(--bdr)] text-[var(--tx3)]'}`}>{m}</button>
          ))}
        </div>
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        <select value={fGestor} onChange={(e) => setFGestor(e.target.value)} className="bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-2 py-1.5 text-[12px]">
          <option value="">Todos gestores</option>{gestores.map((g) => <option key={g}>{g}</option>)}
        </select>
        <select value={fSituacao} onChange={(e) => setFSituacao(e.target.value)} className="bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-2 py-1.5 text-[12px]">
          <option value="">Toda situação</option>{situacoes.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className="bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-2 py-1.5 text-[12px]">
          <option value="">Todos status</option><option>PAGO</option><option>PENDENTE</option>
        </select>
        <input value={fFundo} onChange={(e) => setFFundo(e.target.value)} placeholder="Buscar fundo…" className="flex-1 min-w-[160px] bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-3 py-1.5 text-[12px]" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <Card className="p-4 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-[3px] bg-id-mid" />
          <div className="text-[10.5px] uppercase text-[var(--tx3)]">Total {campo === 'custodia' ? 'Custódia' : 'Administração'} · {mode === 'mes' ? selMes : 'Período Filtrado'}</div>
          <div className="font-display text-[32px] font-semibold mt-1">{fFull(total)}</div>
          <div className="flex gap-3 mt-2 items-baseline text-[12px]">
            <span className={parseFloat(growth) >= 0 ? 'text-id-light' : 'text-red-400'}>{parseFloat(growth) >= 0 ? '↑' : '↓'} {Math.abs(growth)}%</span>
            <span className="text-[var(--tx3)]">vs. {prev ? prev.mes : 'mês anterior'}</span>
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-[10.5px] uppercase text-id-light">✓ Recebido</div>
          <div className="font-display text-2xl font-semibold text-id-light mt-1">{fFmt(pago)}</div>
          <div className="text-[11px] text-[var(--tx3)] mt-1">{pct}% do total cobrado</div>
        </Card>
        <Card className="p-4">
          <div className={`text-[10.5px] uppercase ${pend > 0 ? 'text-red-400' : 'text-[var(--tx3)]'}`}>Em Aberto</div>
          <div className={`font-display text-2xl font-semibold mt-1 ${pend > 0 ? 'text-red-400' : 'text-[var(--tx3)]'}`}>{fFmt(pend)}</div>
          <div className="text-[11px] text-[var(--tx3)] mt-1">{(100 - pct).toFixed(1)}% pendente</div>
        </Card>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Card className="p-3"><div className="text-[10px] text-[var(--tx3)] uppercase">Fundos no período</div><div className="font-display text-lg font-semibold">{fundosU}</div></Card>
        <Card className="p-3"><div className="text-[10px] text-[var(--tx3)] uppercase">Gestores ativos</div><div className="font-display text-lg font-semibold">{gestU}</div></Card>
        <Card className="p-3"><div className="text-[10px] text-[var(--tx3)] uppercase">% Recebido</div><div className={`font-display text-lg font-semibold ${pct >= 90 ? 'text-id-light' : pct >= 75 ? 'text-amber-400' : 'text-red-400'}`}>{pct}%</div></Card>
        <Card className="p-3"><div className="text-[10px] text-[var(--tx3)] uppercase">Ticket médio/fundo</div><div className="font-display text-lg font-semibold">{fundosU > 0 ? fFmt(total / fundosU) : '—'}</div></Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-4">
        <Card className="p-4 lg:col-span-2 h-[280px]">
          <div className="text-[11px] font-medium text-[var(--tx3)] mb-2">Evolução mensal</div>
          <ResponsiveContainer width="100%" height="90%">
            <LineChart data={monthly}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2e38" />
              <XAxis dataKey="mes" tick={{ fontSize: 10, fill: '#64748b' }} />
              <YAxis tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={fFmt} />
              <Tooltip formatter={(v) => fFull(v)} contentStyle={{ background: '#171a21', border: '1px solid #2a2e38', fontSize: 12 }} />
              <Line type="monotone" dataKey="total" stroke="#8FB352" strokeWidth={2.5} dot={{ r: 2 }} />
              <Line type="monotone" dataKey="pago" stroke="#38bdf8" strokeWidth={2} dot={{ r: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
        <Card className="p-4 h-[280px]">
          <div className="text-[11px] font-medium text-[var(--tx3)] mb-2">Por situação do fundo</div>
          <ResponsiveContainer width="100%" height="90%">
            <PieChart>
              <Pie data={situacaoDist} dataKey="value" nameKey="name" innerRadius={45} outerRadius={70}>
                {situacaoDist.map((_, i) => <Cell key={i} fill={FIP_C[i % FIP_C.length]} />)}
              </Pie>
              <Tooltip formatter={(v) => fFull(v)} contentStyle={{ background: '#171a21', border: '1px solid #2a2e38', fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <Card className="p-4">
          <div className="text-[11px] font-medium text-red-400 mb-2">Top devedores</div>
          <div className="space-y-1.5">
            {topDevedores.map((f) => (
              <div key={f.name} className="flex items-center gap-2 text-[11.5px]">
                <span className="flex-1 truncate">{f.name}</span>
                <span className="font-mono text-red-400">{fFmt(f.value)}</span>
              </div>
            ))}
            {!topDevedores.length && <div className="text-[12px] text-id-light">✅ Nenhum devedor no período</div>}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] font-medium text-id-light mb-2">Top pagadores</div>
          <div className="space-y-1.5">
            {topPagadores.map((f) => (
              <div key={f.name} className="flex items-center gap-2 text-[11.5px]">
                <span className="flex-1 truncate">{f.name}</span>
                <span className="font-mono text-id-light">{fFmt(f.value)}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card>
        <div className="p-3 border-b border-[var(--bdr)] flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <button onClick={addRow} className="flex items-center gap-1 text-[11px] border border-[var(--bdr)] rounded-lg px-2.5 py-1 text-[var(--tx2)] hover:bg-[var(--sur2)]"><Plus size={12} /> Nova linha</button>
            {selected.size > 0 && (
              <button onClick={bulkDelete} className="flex items-center gap-1 text-[11px] border border-red-500/40 text-red-400 rounded-lg px-2.5 py-1"><Trash2 size={12} /> Excluir {selected.size}</button>
            )}
          </div>
          <span className="text-[11px] text-[var(--tx3)]">{Math.min(150, filtered.length)} de {filtered.length} registros{importedAt ? ` · última importação ${importedAt}` : ''}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10.5px] uppercase tracking-wider text-[var(--tx3)] border-b border-[var(--bdr)]">
                <th className="px-2 py-2 w-8"></th>
                {[['fundo', 'Fundo'], ['gestor', 'Gestor'], ['classificacao', 'Classif.'], ['mesRef', 'Mês'], ['val', campo === 'custodia' ? 'Valor Custódia' : 'Valor ADM'], ['status', 'Status'], ['situacaoFundo', 'Situação']].map(([c, l]) => (
                  <th key={c} className="px-2 py-2 font-medium cursor-pointer" onClick={() => { sortCol === c ? setSortAsc(!sortAsc) : (setSortCol(c), setSortAsc(c !== 'val')) }}>
                    {l}{sortCol === c ? (sortAsc ? ' ↑' : ' ↓') : ''}
                  </th>
                ))}
                <th className="px-2 py-2 w-16 text-right"></th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((r) => (
                <tr key={r._ri} className="group/row border-b border-[var(--bdr)]/60 text-[12px] hover:bg-[var(--sur2)]/60">
                  <td className="px-2 py-1.5 text-center"><input type="checkbox" checked={selected.has(r._ri)} onChange={() => toggleSelect(r._ri)} /></td>
                  <td className="px-2 py-1.5"><input defaultValue={r.fundo} onBlur={(e) => editRow(r._ri, 'fundo', e.target.value)} className="bg-transparent w-full outline-none min-w-[160px]" /></td>
                  <td className="px-2 py-1.5"><input defaultValue={r.gestor} onBlur={(e) => editRow(r._ri, 'gestor', e.target.value)} className="bg-transparent w-full outline-none min-w-[100px]" /></td>
                  <td className="px-2 py-1.5"><input defaultValue={r.classificacao} onBlur={(e) => editRow(r._ri, 'classificacao', e.target.value)} className="bg-transparent w-16 outline-none" /></td>
                  <td className="px-2 py-1.5"><input defaultValue={r.mesRef} onBlur={(e) => editRow(r._ri, 'mesRef', e.target.value)} className="bg-transparent w-16 font-mono outline-none" /></td>
                  <td className="px-2 py-1.5 text-right"><input defaultValue={r[valField].toFixed(2)} onBlur={(e) => editRow(r._ri, valField, e.target.value)} className="bg-transparent w-24 text-right font-mono outline-none" /></td>
                  <td className="px-2 py-1.5">
                    <select defaultValue={r.status} onChange={(e) => editRow(r._ri, 'status', e.target.value)} className="bg-transparent text-[11px]">
                      <option>PAGO</option><option>PENDENTE</option>
                    </select>
                  </td>
                  <td className="px-2 py-1.5"><input defaultValue={r.situacaoFundo} onBlur={(e) => editRow(r._ri, 'situacaoFundo', e.target.value)} className="bg-transparent w-24 outline-none" /></td>
                  <td className="px-2 py-1.5 text-right">
                    <div className="flex items-center gap-2 justify-end">
                      <button onClick={() => setDetailRow(r)} title="Ver todos os detalhes" className="opacity-70 hover:opacity-100 text-[var(--tx3)] hover:text-id-light"><Info size={13} /></button>
                      <button onClick={() => deleteRow(r._ri)} title="Excluir" className="opacity-0 group-hover/row:opacity-100 text-[var(--tx4)] hover:text-red-500 transition-opacity">✕</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {detailRow && <FipDetailModal row={detailRow} onClose={() => setDetailRow(null)} />}
    </div>
  )
}

function DetailField({ label, value }) {
  if (!value && value !== 0) return null
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-[var(--tx3)] mb-0.5">{label}</div>
      <div className="text-[13px] text-[var(--tx)] whitespace-pre-wrap break-words">{value}</div>
    </div>
  )
}

function FipDetailModal({ row, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4">
      <div onClick={(e) => e.stopPropagation()} className="bg-[var(--sur)] border border-[var(--bdr)] rounded-xl w-full max-w-[460px] shadow-card max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--bdr)]">
          <div className="font-display font-semibold text-[14px]">{row.fundo}</div>
          <button onClick={onClose} className="text-[var(--tx3)] hover:text-[var(--tx)]"><X size={18} /></button>
        </div>
        <div className="p-5 flex flex-col gap-3.5">
          <div className="grid grid-cols-2 gap-3">
            <DetailField label="CNPJ" value={row.cnpj} />
            <DetailField label="Conta" value={row.conta} />
            <DetailField label="Administrador" value={row.administrador} />
            <DetailField label="Custódia" value={row.custodiaEmpresa} />
            <DetailField label="Valor ADM" value={fFull(row.valorAdm)} />
            <DetailField label="Valor Custódia" value={fFull(row.valorCustodia)} />
            <DetailField label="Valor Total" value={fFull(row.valorTotal)} />
            <DetailField label="Saldos" value={fFull(row.saldos)} />
            <DetailField label="Resgatar" value={fFull(row.resgatar)} />
            <DetailField label="Data da receita" value={brDate(row.dataReceita)} />
            <DetailField label="Data prevista" value={brDate(row.dataPrevista)} />
            <DetailField label="Data de pagamento" value={brDate(row.dataPgto)} />
          </div>
          <DetailField label="Observação" value={row.obs} />
        </div>
      </div>
    </div>
  )
}
