import { useEffect, useMemo, useRef, useState } from 'react'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import * as XLSX from 'xlsx'
import { Upload, Download } from 'lucide-react'
import { db } from '../lib/firebase'
import { PageHeader, Card } from '../components/PageShell'
import { useToast } from '../components/Toast'

const DOC_REF = () => doc(db, 'controle', 'portal_saldos')
const psFmt = (v) => (!v && v !== 0 ? '—' : 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))

export default function PortalSaldos() {
  const toast = useToast()
  const [rows, setRows] = useState([])
  const [dataRef, setDataRef] = useState('')
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [tipo, setTipo] = useState('todos')
  const [sort, setSort] = useState('nome')
  const fileRef = useRef(null)

  useEffect(() => {
    let mounted = true
    getDoc(DOC_REF())
      .then((snap) => {
        if (!mounted || !snap.exists()) return
        const d = snap.data()
        setRows(d.rows || [])
        setDataRef(d.dataRef || '')
      })
      .catch((e) => console.warn('psLoad err', e))
      .finally(() => mounted && setLoading(false))
    return () => { mounted = false }
  }, [])

  function persist(nextRows, nextRef) {
    setRows(nextRows)
    setDataRef(nextRef)
    setDoc(DOC_REF(), { rows: nextRows, dataRef: nextRef }, { merge: false }).catch((e) => console.warn('psSave err', e))
  }

  function handleImport(file) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
        const parsed = []
        data.forEach((row) => {
          const nome = String(row[0] || '').trim().replace(/_x0009_/g, '').trim()
          const cnpj = String(row[1] || '').trim()
          const saldo = parseFloat(String(row[2] || '0').replace(',', '.')) || 0
          const conta = String(row[3] || '').trim()
          const tp = String(row[4] || '').trim()
          if (!nome || nome === 'Nome Fundo' || nome === 'Portal IDSF' || nome === 'Tipo Operacao') return
          if (!['Contas de Liquidação', 'Contas de Cobrança'].includes(tp)) return
          parsed.push({ nome: nome.substring(0, 120), cnpj, saldo, conta, tipo: tp })
        })
        const ref = new Date().toLocaleDateString('pt-BR') + ' ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
        persist(parsed, ref)
        toast.success(parsed.length + ' fundos importados do Portal IDSF!')
      } catch (err) { console.error(err); toast.error('Erro: ' + err.message) }
    }
    reader.readAsArrayBuffer(file)
  }

  function exportCSV() {
    if (!rows.length) { toast.error('Nenhum dado para exportar.'); return }
    const h = 'Fundo;CNPJ;Saldo;Conta;Tipo'
    const fmt = (v) => (v != null ? Number(v).toFixed(2).replace('.', ',') : '')
    const lines = rows.map((r) => [r.nome, r.cnpj, fmt(r.saldo), r.conta, r.tipo].join(';'))
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['\uFEFF' + h + '\n' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }))
    a.download = 'portal_saldos_' + new Date().toISOString().slice(0, 10) + '.csv'
    a.click()
    toast.success('CSV exportado!')
  }

  const filtered = useMemo(() => {
    let list = [...rows]
    if (search) list = list.filter((r) => r.nome.toLowerCase().includes(search.toLowerCase()) || r.cnpj.includes(search))
    if (tipo === 'liquidacao') list = list.filter((r) => r.tipo === 'Contas de Liquidação')
    if (tipo === 'cobranca') list = list.filter((r) => r.tipo === 'Contas de Cobrança')
    if (tipo === 'comsaldo') list = list.filter((r) => r.saldo > 0)
    if (tipo === 'zerado') list = list.filter((r) => r.saldo <= 0)
    if (sort === 'saldo_desc') list.sort((a, b) => b.saldo - a.saldo)
    else if (sort === 'saldo_asc') list.sort((a, b) => a.saldo - b.saldo)
    else list.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
    return list
  }, [rows, search, tipo, sort])

  const totalLiq = rows.filter((r) => r.tipo === 'Contas de Liquidação').reduce((a, r) => a + r.saldo, 0)
  const totalCob = rows.filter((r) => r.tipo === 'Contas de Cobrança').reduce((a, r) => a + r.saldo, 0)
  const comSaldo = rows.filter((r) => r.saldo > 0).length
  const zerados = rows.filter((r) => r.saldo <= 0).length

  return (
    <div>
      <PageHeader
        eyebrow="Operacional"
        title="Portal Saldos"
        actions={
          <>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => handleImport(e.target.files[0])} />
            <button onClick={() => fileRef.current?.click()} className="flex items-center gap-1.5 text-[12px] border border-[var(--bdr)] rounded-lg px-3 py-1.5 text-[var(--tx2)] hover:bg-[var(--sur2)]">
              <Upload size={13} /> Importar Excel
            </button>
            <button onClick={exportCSV} className="flex items-center gap-1.5 text-[12px] bg-id-dark hover:bg-id-mid rounded-lg px-3 py-1.5 font-medium">
              <Download size={13} /> Exportar CSV
            </button>
          </>
        }
      />
      <p className="text-[11px] text-[var(--tx3)] -mt-3 mb-4">{dataRef ? 'Atualizado em: ' + dataRef : 'Nenhum arquivo importado'}</p>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <Card className="p-3"><div className="text-[10px] uppercase text-[var(--tx3)]">Total Liquidação</div><div className="font-display text-lg font-semibold text-sky-400">{psFmt(totalLiq)}</div><div className="text-[10.5px] text-[var(--tx3)]">{rows.filter((r) => r.tipo === 'Contas de Liquidação').length} fundos</div></Card>
        <Card className="p-3"><div className="text-[10px] uppercase text-[var(--tx3)]">Total Cobrança</div><div className="font-display text-lg font-semibold text-id-light">{psFmt(totalCob)}</div><div className="text-[10.5px] text-[var(--tx3)]">{rows.filter((r) => r.tipo === 'Contas de Cobrança').length} fundos</div></Card>
        <Card className="p-3"><div className="text-[10px] uppercase text-[var(--tx3)]">Total Geral</div><div className="font-display text-lg font-semibold text-teal-400">{psFmt(totalLiq + totalCob)}</div><div className="text-[10.5px] text-[var(--tx3)]">{rows.length} contas</div></Card>
        <Card className="p-3 cursor-pointer" onClick={() => setTipo('comsaldo')}><div className="text-[10px] uppercase text-[var(--tx3)]">Com Saldo</div><div className="font-display text-lg font-semibold text-id-light">{comSaldo}</div><div className="text-[10.5px] text-[var(--tx3)]">Clique para filtrar</div></Card>
        <Card className="p-3 cursor-pointer" onClick={() => setTipo('zerado')}><div className="text-[10px] uppercase text-[var(--tx3)]">Zerados</div><div className="font-display text-lg font-semibold text-[var(--tx3)]">{zerados}</div><div className="text-[10.5px] text-[var(--tx3)]">Clique para filtrar</div></Card>
      </div>

      <Card>
        <div className="p-3 border-b border-[var(--bdr)] flex gap-2">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar fundo ou CNPJ…" className="flex-1 bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-3 py-2 text-[12px] outline-none focus:border-id-mid placeholder:text-[var(--tx3)]" />
          <select value={tipo} onChange={(e) => setTipo(e.target.value)} className="bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-2 text-[12px]">
            <option value="todos">Todos tipos</option>
            <option value="liquidacao">Liquidação</option>
            <option value="cobranca">Cobrança</option>
            <option value="comsaldo">Com saldo</option>
            <option value="zerado">Zerados</option>
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value)} className="bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-2 text-[12px]">
            <option value="nome">Nome A-Z</option>
            <option value="saldo_desc">Maior saldo</option>
            <option value="saldo_asc">Menor saldo</option>
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10.5px] uppercase tracking-wider text-[var(--tx3)] border-b border-[var(--bdr)]">
                <th className="px-3 py-2.5 font-medium">Fundo</th>
                <th className="px-3 py-2.5 font-medium">CNPJ</th>
                <th className="px-3 py-2.5 font-medium text-right">Saldo</th>
                <th className="px-3 py-2.5 font-medium">Conta</th>
                <th className="px-3 py-2.5 font-medium text-center">Tipo</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="text-center py-10 text-[var(--tx3)]">Carregando…</td></tr>
              ) : !filtered.length ? (
                <tr><td colSpan={5} className="text-center py-10 text-[var(--tx3)]">{rows.length ? 'Nenhum resultado.' : 'Clique em Importar Excel para começar.'}</td></tr>
              ) : filtered.map((r, i) => {
                const isLiq = r.tipo === 'Contas de Liquidação'
                return (
                  <tr key={i} className="border-b border-[var(--bdr)]/60 hover:bg-[var(--sur2)]/60 text-[12.5px]">
                    <td className="px-3 py-2.5 font-medium max-w-[280px] truncate" title={r.nome}>{r.nome}</td>
                    <td className="px-3 py-2.5 text-[var(--tx3)] text-[11px] whitespace-nowrap">{r.cnpj}</td>
                    <td className={`px-3 py-2.5 text-right tabular-nums ${r.saldo > 0 ? 'font-semibold' : 'text-[var(--tx3)]'}`}>{psFmt(r.saldo)}</td>
                    <td className="px-3 py-2.5 text-[var(--tx3)] text-[11px] whitespace-nowrap">{r.conta}</td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${isLiq ? 'bg-sky-500/15 text-sky-300' : 'bg-id-mid/15 text-id-light'}`}>{isLiq ? 'Liquidação' : 'Cobrança'}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2.5 text-[11px] text-[var(--tx3)] border-t border-[var(--bdr)]">{filtered.length} de {rows.length} contas</div>
      </Card>
    </div>
  )
}
