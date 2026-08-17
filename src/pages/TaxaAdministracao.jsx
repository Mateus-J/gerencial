import { useEffect, useMemo, useRef, useState } from 'react'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import * as XLSX from 'xlsx'
import { Upload, Download, Trash2, Plus } from 'lucide-react'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell,
} from 'recharts'
import { db } from '../lib/firebase'
import { PageHeader, Card } from '../components/PageShell'
import { useToast } from '../components/Toast'

const DOC_REF = () => doc(db, 'controle', 'taxa_adm')
const TA_C = ['#8FB352', '#38bdf8', '#a78bfa', '#f59e0b', '#2dd4bf', '#f87171', '#0ea5e9', '#84cc16', '#ec4899', '#eab308']

const taFmt = (v) => { v = Number(v) || 0; return 'R$ ' + (v >= 1e6 ? (v / 1e6).toFixed(2).replace('.', ',') + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1).replace('.', ',') + 'K' : v.toFixed(0)) }
const taFull = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })
const sortKey = (m) => { const p = m.split('.'); return parseInt(p[1]) * 100 + parseInt(p[0]) }

function recalc(parsed) {
  const months = [...new Set(parsed.map((r) => r.mesRef))].sort((a, b) => sortKey(a) - sortKey(b))
  // months[months.length - 1] vira `undefined` quando a lista fica vazia
  // (ex.: excluir todos os registros) — e o Firestore rejeita a gravação
  // inteira se algum campo vier `undefined`. `null` é seguro.
  const lastMes = months.length ? months[months.length - 1] : null
  const monthly = months.map((mes) => {
    const mr = parsed.filter((r) => r.mesRef === mes)
    const pago = mr.filter((r) => r.status === 'PAGO').reduce((a, r) => a + r.val, 0)
    const pend = mr.filter((r) => r.status === 'PENDENTE').reduce((a, r) => a + r.val, 0)
    return { mes, total: pago + pend, pago, pend, count: mr.length }
  })
  const allTotal = parsed.reduce((a, r) => a + r.val, 0)
  const allPago = parsed.filter((r) => r.status === 'PAGO').reduce((a, r) => a + r.val, 0)
  return {
    parsed, months, lastMes, monthly, allTotal, allPago, allPend: allTotal - allPago,
    allPct: allTotal > 0 ? parseFloat(((allPago / allTotal) * 100).toFixed(2)) : 0,
  }
}

export default function TaxaAdministracao() {
  const toast = useToast()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState('all') // all | mes
  const [selMes, setSelMes] = useState(null)
  const [fGestor, setFGestor] = useState('')
  const [fClassif, setFClassif] = useState('')
  const [fStatus, setFStatus] = useState('')
  const [fFundo, setFFundo] = useState('')
  const [sortCol, setSortCol] = useState('val')
  const [sortAsc, setSortAsc] = useState(false)
  const [selected, setSelected] = useState(new Set())
  const fileRef = useRef(null)

  useEffect(() => {
    let mounted = true
    getDoc(DOC_REF())
      .then((snap) => {
        if (!mounted) return
        if (snap.exists()) {
          const d = snap.data()
          if (d?.parsed) { setData(d); setSelMes(d.lastMes) }
        }
      })
      .catch((e) => console.warn('taLoad err', e))
      .finally(() => mounted && setLoading(false))
    return () => { mounted = false }
  }, [])

  async function persist(next) {
    setData(next)
    try { await setDoc(DOC_REF(), next, { merge: false }) } catch (e) { console.warn('taSave err', e); toast.error('Erro ao salvar: ' + e.message) }
  }

  function handleImport(file) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = async (e) => {
      try {
        const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
        let hdrIdx = raw.findIndex((r) => String(r[0] || '').toLowerCase().includes('data da receita'))
        if (hdrIdx < 0) hdrIdx = 0
        const headerRow = raw[hdrIdx].map((h) => String(h || '').toLowerCase())
        const findCol = (...kw) => { for (let i = 0; i < headerRow.length; i++) if (kw.some((k) => headerRow[i].includes(k))) return i; return -1 }
        const idxFundo = (() => { const i = findCol('a que se refere', 'despesa paga'); return i >= 0 ? i : 7 })()
        const idxGestor = (() => { const i = findCol('gestor'); return i >= 0 ? i : 9 })()
        const idxClassif = (() => { const i = findCol('classificaç'); return i >= 0 ? i : 10 })()
        const idxCNPJ = (() => { const i = findCol('cnpj'); return i >= 0 ? i : 11 })()
        const idxConta = (() => { const i = findCol('conta do fundo', 'conta'); return i >= 0 ? i : 8 })()
        const idxValor = (() => { const i = findCol('valor total'); return i >= 0 ? i : 12 })()
        const idxStatus = (() => { const i = findCol('status'); return i >= 0 ? i : 17 })()
        const idxMesRef = (() => { const i = findCol('mês referencia', 'mes referencia', 'mês ref', 'mes ref'); return i >= 0 ? i : 18 })()

        const normMesRef = (v) => {
          let s = String(v || '').trim().replace(/'/g, '')
          if (/^\d{2}\.\d{4}$/.test(s)) return s
          const dm = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
          if (dm) return dm[2] + '.' + dm[1]
          return null
        }

        const parsedNew = []
        raw.slice(hdrIdx + 1).forEach((r) => {
          const fundo = String(r[idxFundo] || '').trim(); if (!fundo) return
          const gestor = String(r[idxGestor] || '').trim()
          const classif = String(r[idxClassif] || '').trim()
          const cnpj = String(r[idxCNPJ] || '').trim()
          const conta = String(r[idxConta] || '').trim()
          const mesRef = normMesRef(r[idxMesRef])
          const status = String(r[idxStatus] || '').trim().toUpperCase()
          const val = parseFloat(String(r[idxValor] || '0').replace(',', '.')) || 0
          if (!mesRef || val <= 0) return
          parsedNew.push({ fundo, gestor, classif, cnpj, conta, mesRef, status, val })
        })
        if (!parsedNew.length) { toast.error('Nenhum dado válido no arquivo.'); return }

        const makeKey = (r) => (r.fundo || '').trim().toUpperCase() + '|' + (r.mesRef || '').trim()
        const existing = data?.parsed || []
        const existingMap = {}
        existing.forEach((r, idx) => { existingMap[makeKey(r)] = idx })
        let countNew = 0, countUpdated = 0
        const merged = [...existing]
        parsedNew.forEach((newRow) => {
          const key = makeKey(newRow)
          if (key in existingMap) { merged[existingMap[key]] = { ...merged[existingMap[key]], ...newRow }; countUpdated++ }
          else { merged.push(newRow); countNew++ }
        })

        const next = { ...recalc(merged), importedAt: new Date().toLocaleString('pt-BR') }
        setSelMes(next.lastMes); setMode('all'); setSelected(new Set())
        await persist(next)
        toast.success(`Importado: ${countNew} novo(s), ${countUpdated} atualizado(s) — total ${merged.length} registros, ${next.months.length} meses.`)
      } catch (err) { console.error(err); toast.error('Erro: ' + err.message) }
    }
    reader.readAsArrayBuffer(file)
  }

  const gestores = useMemo(() => [...new Set((data?.parsed || []).map((r) => r.gestor).filter((g) => g && g !== '0'))].sort(), [data])
  const classes = useMemo(() => [...new Set((data?.parsed || []).map((r) => r.classif).filter((c) => c && c !== '0'))].sort(), [data])

  const filtered = useMemo(() => {
    if (!data) return []
    return data.parsed.filter((r) => {
      if (mode === 'mes' && r.mesRef !== selMes) return false
      if (fGestor && r.gestor !== fGestor) return false
      if (fClassif && r.classif !== fClassif) return false
      if (fStatus && r.status !== fStatus) return false
      if (fFundo && !r.fundo.toLowerCase().includes(fFundo.toLowerCase())) return false
      return true
    })
  }, [data, mode, selMes, fGestor, fClassif, fStatus, fFundo])

  function editRow(ri, field, val) {
    const parsed = data.parsed.map((r, i) => (i === ri ? { ...r, [field]: field === 'val' ? parseFloat(val) || 0 : val } : r))
    persist(recalc(parsed))
  }
  function deleteRow(ri) {
    const parsed = data.parsed.filter((_, i) => i !== ri)
    persist(recalc(parsed))
  }
  function addRow() {
    const mes = mode === 'mes' ? selMes : data.lastMes || ''
    const parsed = [{ fundo: 'Novo Fundo', gestor: '', classif: '', mesRef: mes, status: 'PENDENTE', val: 0 }, ...data.parsed]
    persist(recalc(parsed))
    toast.success('Registro adicionado!')
  }
  function bulkDelete() {
    if (!selected.size) return
    if (!confirm(`Excluir ${selected.size} registro(s) selecionado(s)?`)) return
    const n = selected.size
    const parsed = data.parsed.filter((_, i) => !selected.has(i))
    setSelected(new Set())
    persist(recalc(parsed))
    toast.success(`${n} registro(s) excluído(s).`)
  }
  function toggleSelect(ri) {
    setSelected((s) => { const n = new Set(s); n.has(ri) ? n.delete(ri) : n.add(ri); return n })
  }

  function exportCSV() {
    if (!filtered.length) { toast.error('Nenhum dado para exportar.'); return }
    const h = 'Fundo;Gestor;Classificação;Mês Ref;Status;Valor'
    const lines = filtered.map((r) => [r.fundo, r.gestor, r.classif, r.mesRef, r.status, r.val.toFixed(2).replace('.', ',')].join(';'))
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['\uFEFF' + h + '\n' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }))
    a.download = 'taxa_adm_' + new Date().toISOString().slice(0, 10) + '.csv'
    a.click()
    toast.success('CSV exportado!')
  }

  const sortedRows = useMemo(() => {
    const rows = filtered.map((r) => ({ ...r, _ri: data.parsed.indexOf(r) }))
    rows.sort((a, b) => {
      const va = sortCol === 'val' ? a.val : (a[sortCol] || '').toLowerCase()
      const vb = sortCol === 'val' ? b.val : (b[sortCol] || '').toLowerCase()
      return sortAsc ? (va > vb ? 1 : va < vb ? -1 : 0) : (va < vb ? 1 : va > vb ? -1 : 0)
    })
    return rows.slice(0, 150)
  }, [filtered, sortCol, sortAsc, data])

  if (loading) {
    return (
      <div>
        <PageHeader eyebrow="Operacional" title="Taxa de Administração" />
        <Card className="p-10 text-center text-[var(--tx3)]">Carregando…</Card>
      </div>
    )
  }

  if (!data) {
    return (
      <div>
        <PageHeader
          eyebrow="Operacional"
          title="Taxa de Administração"
          actions={
            <>
              <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => handleImport(e.target.files[0])} />
              <button onClick={() => fileRef.current?.click()} className="flex items-center gap-1.5 text-[12px] bg-id-dark hover:bg-id-mid rounded-lg px-3 py-1.5 font-medium">
                <Upload size={13} /> Importar planilha
              </button>
            </>
          }
        />
        <Card className="p-10 text-center text-[var(--tx3)]">Nenhum dado importado ainda. Importe a planilha de cobranças (.xlsx) para começar.</Card>
      </div>
    )
  }

  const rows = filtered
  const total = rows.reduce((a, r) => a + r.val, 0)
  const pago = rows.filter((r) => r.status === 'PAGO').reduce((a, r) => a + r.val, 0)
  const pend = rows.filter((r) => r.status === 'PENDENTE').reduce((a, r) => a + r.val, 0)
  const pct = total > 0 ? parseFloat(((pago / total) * 100).toFixed(2)) : 0
  const mo = data.monthly
  const cur = mo[mo.length - 1]
  const prev = mo.length >= 2 ? mo[mo.length - 2] : null
  const growth = prev ? (((cur.total - prev.total) / prev.total) * 100).toFixed(1) : '0'
  const fundosU = new Set(rows.map((r) => r.fundo)).size
  const gestU = new Set(rows.map((r) => r.gestor).filter((g) => g && g !== '0')).size

  const agg = (key, sf) => {
    const m = {}
    rows.filter((r) => !sf || r.status === sf).forEach((r) => { m[r[key]] = (m[r[key]] || 0) + r.val })
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 7).map(([name, value]) => ({ name, value }))
  }
  const topDevedores = agg('fundo', 'PENDENTE')
  const topPagadores = agg('fundo', 'PAGO')
  const clsDist = agg('classif').filter((c) => c.name && c.name !== '0')

  return (
    <div>
      <PageHeader
        eyebrow="Operacional"
        title="Taxa de Administração"
        actions={
          <>
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

      {/* Filtro modo + meses */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <button onClick={() => setMode('all')} className={`text-[11px] px-3 py-1 rounded-full border ${mode === 'all' ? 'bg-id-dark border-id-dark' : 'border-[var(--bdr)] text-[var(--tx3)]'}`}>Período completo</button>
        <button onClick={() => setMode('mes')} className={`text-[11px] px-3 py-1 rounded-full border ${mode === 'mes' ? 'bg-id-dark border-id-dark' : 'border-[var(--bdr)] text-[var(--tx3)]'}`}>Só um mês</button>
        <div className="flex gap-1 flex-wrap">
          {[...data.months].reverse().slice(0, 18).map((m) => (
            <button key={m} onClick={() => { setSelMes(m); setMode('mes') }} className={`text-[10.5px] font-mono px-2 py-0.5 rounded-full border ${selMes === m && mode === 'mes' ? 'bg-sky-500 border-sky-500' : 'border-[var(--bdr)] text-[var(--tx3)]'}`}>{m}</button>
          ))}
        </div>
      </div>

      {/* Filtros */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <select value={fGestor} onChange={(e) => setFGestor(e.target.value)} className="bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-2 py-1.5 text-[12px]">
          <option value="">Todos gestores</option>{gestores.map((g) => <option key={g}>{g}</option>)}
        </select>
        <select value={fClassif} onChange={(e) => setFClassif(e.target.value)} className="bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-2 py-1.5 text-[12px]">
          <option value="">Todas classif.</option>{classes.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className="bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-2 py-1.5 text-[12px]">
          <option value="">Todos status</option><option>PAGO</option><option>PENDENTE</option>
        </select>
        <input value={fFundo} onChange={(e) => setFFundo(e.target.value)} placeholder="Buscar fundo…" className="flex-1 min-w-[160px] bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-3 py-1.5 text-[12px]" />
      </div>

      {/* Hero + KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <Card className="p-4 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-[3px] bg-id-mid" />
          <div className="text-[10.5px] uppercase text-[var(--tx3)]">Total Cobrado · {mode === 'mes' ? selMes : 'Período Filtrado'}</div>
          <div className="font-display text-[32px] font-semibold mt-1">{taFull(total)}</div>
          <div className="flex gap-3 mt-2 items-baseline text-[12px]">
            <span className={parseFloat(growth) >= 0 ? 'text-id-light' : 'text-red-400'}>{parseFloat(growth) >= 0 ? '↑' : '↓'} {Math.abs(growth)}%</span>
            <span className="text-[var(--tx3)]">vs. {prev ? prev.mes : 'mês anterior'}</span>
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-[10.5px] uppercase text-id-light">✓ Recebido</div>
          <div className="font-display text-2xl font-semibold text-id-light mt-1">{taFmt(pago)}</div>
          <div className="text-[11px] text-[var(--tx3)] mt-1">{pct}% do total cobrado</div>
        </Card>
        <Card className="p-4">
          <div className={`text-[10.5px] uppercase ${pend > 0 ? 'text-red-400' : 'text-[var(--tx3)]'}`}>Em Aberto</div>
          <div className={`font-display text-2xl font-semibold mt-1 ${pend > 0 ? 'text-red-400' : 'text-[var(--tx3)]'}`}>{taFmt(pend)}</div>
          <div className="text-[11px] text-[var(--tx3)] mt-1">{(100 - pct).toFixed(1)}% pendente</div>
        </Card>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Card className="p-3"><div className="text-[10px] text-[var(--tx3)] uppercase">Fundos no período</div><div className="font-display text-lg font-semibold">{fundosU}</div></Card>
        <Card className="p-3"><div className="text-[10px] text-[var(--tx3)] uppercase">Gestores ativos</div><div className="font-display text-lg font-semibold">{gestU}</div></Card>
        <Card className="p-3"><div className="text-[10px] text-[var(--tx3)] uppercase">% Recebido</div><div className={`font-display text-lg font-semibold ${pct >= 90 ? 'text-id-light' : pct >= 75 ? 'text-amber-400' : 'text-red-400'}`}>{pct}%</div></Card>
        <Card className="p-3"><div className="text-[10px] text-[var(--tx3)] uppercase">Ticket médio/fundo</div><div className="font-display text-lg font-semibold">{fundosU > 0 ? taFmt(total / fundosU) : '—'}</div></Card>
      </div>

      {/* Gráficos */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-4">
        <Card className="p-4 lg:col-span-2 h-[280px]">
          <div className="text-[11px] font-medium text-[var(--tx3)] mb-2">Evolução mensal</div>
          <ResponsiveContainer width="100%" height="90%">
            <LineChart data={mo}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2e38" />
              <XAxis dataKey="mes" tick={{ fontSize: 10, fill: '#64748b' }} />
              <YAxis tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={taFmt} />
              <Tooltip formatter={(v) => taFull(v)} contentStyle={{ background: '#171a21', border: '1px solid #2a2e38', fontSize: 12 }} />
              <Line type="monotone" dataKey="total" stroke="#8FB352" strokeWidth={2.5} dot={{ r: 2 }} />
              <Line type="monotone" dataKey="pago" stroke="#38bdf8" strokeWidth={2} dot={{ r: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
        <Card className="p-4 h-[280px]">
          <div className="text-[11px] font-medium text-[var(--tx3)] mb-2">Por classificação</div>
          <ResponsiveContainer width="100%" height="90%">
            <PieChart>
              <Pie data={clsDist} dataKey="value" nameKey="name" innerRadius={45} outerRadius={70}>
                {clsDist.map((_, i) => <Cell key={i} fill={TA_C[i % TA_C.length]} />)}
              </Pie>
              <Tooltip formatter={(v) => taFull(v)} contentStyle={{ background: '#171a21', border: '1px solid #2a2e38', fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Top devedores / pagadores */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <Card className="p-4">
          <div className="text-[11px] font-medium text-red-400 mb-2">Top devedores</div>
          <div className="space-y-1.5">
            {topDevedores.map((f) => (
              <div key={f.name} className="flex items-center gap-2 text-[11.5px]">
                <span className="flex-1 truncate">{f.name}</span>
                <span className="font-mono text-red-400">{taFmt(f.value)}</span>
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
                <span className="font-mono text-id-light">{taFmt(f.value)}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Tabela editável */}
      <Card>
        <div className="p-3 border-b border-[var(--bdr)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button onClick={addRow} className="flex items-center gap-1 text-[11px] border border-[var(--bdr)] rounded-lg px-2.5 py-1 text-[var(--tx2)] hover:bg-[var(--sur2)]"><Plus size={12} /> Nova linha</button>
            {selected.size > 0 && (
              <button onClick={bulkDelete} className="flex items-center gap-1 text-[11px] border border-red-500/40 text-red-400 rounded-lg px-2.5 py-1"><Trash2 size={12} /> Excluir {selected.size}</button>
            )}
          </div>
          <span className="text-[11px] text-[var(--tx3)]">{Math.min(150, filtered.length)} de {filtered.length} registros</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10.5px] uppercase tracking-wider text-[var(--tx3)] border-b border-[var(--bdr)]">
                <th className="px-2 py-2 w-8"></th>
                {[['fundo', 'Fundo'], ['gestor', 'Gestor'], ['classif', 'Classif.'], ['mesRef', 'Mês'], ['val', 'Valor'], ['status', 'Status']].map(([c, l]) => (
                  <th key={c} className="px-2 py-2 font-medium cursor-pointer" onClick={() => { sortCol === c ? setSortAsc(!sortAsc) : (setSortCol(c), setSortAsc(c !== 'val')) }}>
                    {l}{sortCol === c ? (sortAsc ? ' ↑' : ' ↓') : ''}
                  </th>
                ))}
                <th className="px-2 py-2 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((r) => (
                <tr key={r._ri} className="border-b border-[var(--bdr)]/60 text-[12px] hover:bg-[var(--sur2)]/60">
                  <td className="px-2 py-1.5 text-center"><input type="checkbox" checked={selected.has(r._ri)} onChange={() => toggleSelect(r._ri)} /></td>
                  <td className="px-2 py-1.5"><input defaultValue={r.fundo} onBlur={(e) => editRow(r._ri, 'fundo', e.target.value)} className="bg-transparent w-full outline-none" /></td>
                  <td className="px-2 py-1.5"><input defaultValue={r.gestor} onBlur={(e) => editRow(r._ri, 'gestor', e.target.value)} className="bg-transparent w-full outline-none" /></td>
                  <td className="px-2 py-1.5"><input defaultValue={r.classif} onBlur={(e) => editRow(r._ri, 'classif', e.target.value)} className="bg-transparent w-full outline-none" /></td>
                  <td className="px-2 py-1.5"><input defaultValue={r.mesRef} onBlur={(e) => editRow(r._ri, 'mesRef', e.target.value)} className="bg-transparent w-16 font-mono outline-none" /></td>
                  <td className="px-2 py-1.5 text-right"><input defaultValue={r.val.toFixed(2)} onBlur={(e) => editRow(r._ri, 'val', e.target.value)} className="bg-transparent w-20 text-right font-mono outline-none" /></td>
                  <td className="px-2 py-1.5">
                    <select defaultValue={r.status} onChange={(e) => editRow(r._ri, 'status', e.target.value)} className="bg-transparent text-[11px]">
                      <option>PAGO</option><option>PENDENTE</option>
                    </select>
                  </td>
                  <td className="px-2 py-1.5 text-center"><button onClick={() => deleteRow(r._ri)} className="text-[var(--tx3)] hover:text-red-400">✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
