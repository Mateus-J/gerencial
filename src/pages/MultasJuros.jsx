import { useEffect, useMemo, useState } from 'react'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { Plus, Download, Trash2 } from 'lucide-react'
import { db } from '../lib/firebase'
import { PageHeader, Card } from '../components/PageShell'

const DOC_REF = () => doc(db, 'controle', 'multas_juros')

const defState = () => ({
  params: { taxaMultaDia: 0.0033, tetoMulta: 0.20, jurosFixo: 0.01, convencao: 'seguinte' },
  selic: { '2026-07': 0.0112 },
  guias: [
    { id: 'mj_exemplo', fundo: 'Exemplo FIDC', cnpj: '', tributo: 'DARF - Multa CVM', processo: '', venc: '2026-06-03', pgto: '2026-07-31', valor: 1526795.97, status: 'Pendente' },
  ],
})

const fmtBRL = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtPct = (v) => (Number(v || 0) * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%'
const parseDate = (s) => { if (!s) return null; const p = s.split('-').map(Number); if (p.length !== 3) return null; return new Date(p[0], p[1] - 1, p[2]) }
const diffDays = (a, b) => Math.round((a - b) / 86400000)
const monthKey = (dt) => dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0')
const addMonths = (dt, n) => new Date(dt.getFullYear(), dt.getMonth() + n, 1)
const monthLabel = (key) => { const [y, m] = key.split('-'); return ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'][parseInt(m) - 1] + '/' + y }

// Regras: multa de mora 0,33%/dia (teto 20%); juros = Selic acumulada dos
// meses intermediários entre vencimento e pagamento, + taxa fixa no mês de
// quitação; sem juros se vencimento e pagamento caem no mesmo mês/ano.
function calcGuia(g, mj) {
  const venc = parseDate(g.venc), pgto = parseDate(g.pgto)
  if (!venc || !pgto || !g.valor) return null
  const ajuste = mj.params.convencao === 'vencimento' ? 1 : 0
  const dias = diffDays(pgto, venc) + ajuste
  const taxaMultaDia = Number(mj.params.taxaMultaDia) || 0
  const teto = Number(mj.params.tetoMulta) || 0
  const multaCalc = dias * taxaMultaDia
  const multaAplicada = Math.min(Math.max(multaCalc, 0), teto)
  const valorMulta = g.valor * multaAplicada
  const mesSeg = addMonths(venc, 1), mesAnt = addMonths(pgto, -1)
  let selicAcum = 0
  if (mesSeg <= mesAnt) {
    let cursor = new Date(mesSeg), guard = 0
    while (cursor <= mesAnt && guard < 600) {
      selicAcum += Number(mj.selic[monthKey(cursor)]) || 0
      cursor = addMonths(cursor, 1); guard++
    }
  }
  const sameMonth = venc.getFullYear() === pgto.getFullYear() && venc.getMonth() === pgto.getMonth()
  const jurosPct = sameMonth ? 0 : selicAcum + (Number(mj.params.jurosFixo) || 0)
  const valorJuros = g.valor * jurosPct
  const total = Number(g.valor) + valorMulta + valorJuros
  return { dias, multaCalc, multaAplicada, valorMulta, selicAcum, jurosPct, valorJuros, total }
}

export default function MultasJuros() {
  const [mj, setMj] = useState(defState())
  const [loading, setLoading] = useState(true)
  const [selicMonth, setSelicMonth] = useState('')
  const [selicRate, setSelicRate] = useState('')

  useEffect(() => {
    let mounted = true
    getDoc(DOC_REF())
      .then((snap) => { if (mounted && snap.exists()) setMj({ ...defState(), ...snap.data() }) })
      .catch((e) => console.warn('mjLoad err', e))
      .finally(() => mounted && setLoading(false))
    return () => { mounted = false }
  }, [])

  function persist(next) {
    setMj(next)
    setDoc(DOC_REF(), JSON.parse(JSON.stringify(next)), { merge: false }).catch((e) => console.warn('mjSave err', e))
  }

  function addRow() {
    const id = 'mj' + Date.now() + Math.floor(Math.random() * 1000)
    persist({ ...mj, guias: [...mj.guias, { id, fundo: '', cnpj: '', tributo: '', processo: '', venc: '', pgto: '', valor: 0, status: 'Pendente' }] })
  }
  function deleteRow(id) {
    if (!confirm('Excluir esta guia?')) return
    persist({ ...mj, guias: mj.guias.filter((g) => g.id !== id) })
  }
  function editField(id, field, value) {
    const guias = mj.guias.map((g) => g.id === id ? { ...g, [field]: field === 'valor' ? (parseFloat(String(value).replace(/\./g, '').replace(',', '.')) || 0) : value } : g)
    persist({ ...mj, guias })
  }
  function editParam(field, value) {
    const params = { ...mj.params }
    if (field === 'convencao') params.convencao = value
    else params[field] = (parseFloat(String(value).replace(',', '.')) || 0) / 100
    persist({ ...mj, params })
  }
  function addSelic() {
    const rate = parseFloat(String(selicRate).replace(',', '.'))
    if (!selicMonth || isNaN(rate)) { alert('Informe mês e taxa válidos'); return }
    persist({ ...mj, selic: { ...mj.selic, [selicMonth]: rate / 100 } })
    setSelicMonth(''); setSelicRate('')
  }
  function deleteSelic(key) {
    const selic = { ...mj.selic }
    delete selic[key]
    persist({ ...mj, selic })
  }

  const computed = useMemo(() => mj.guias.map((g) => ({ guia: g, calc: calcGuia(g, mj) })), [mj])

  const totais = computed.reduce((acc, { guia, calc }) => {
    if (!calc) return acc
    acc.imposto += Number(guia.valor) || 0
    acc.multa += calc.valorMulta
    acc.juros += calc.valorJuros
    acc.total += calc.total
    return acc
  }, { imposto: 0, multa: 0, juros: 0, total: 0 })

  function exportCSV() {
    let csv = '\uFEFFNº;Fundo;CNPJ;Tributo;Processo;Vencimento;Pagamento;Valor Imposto;Status;Dias Atraso;Multa %;Valor Multa;Selic Acum %;Juros %;Valor Juros;Total a Pagar\n'
    computed.forEach(({ guia: g, calc }, i) => {
      csv += [i + 1, g.fundo, g.cnpj, g.tributo, g.processo, g.venc, g.pgto, g.valor, g.status,
        calc?.dias ?? '', calc ? fmtPct(calc.multaAplicada) : '', calc ? calc.valorMulta.toFixed(2) : '',
        calc ? fmtPct(calc.selicAcum) : '', calc ? fmtPct(calc.jurosPct) : '', calc ? calc.valorJuros.toFixed(2) : '',
        calc ? calc.total.toFixed(2) : ''].join(';') + '\n'
    })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    a.download = 'multas_juros_' + new Date().toISOString().slice(0, 10) + '.csv'
    a.click()
  }

  if (loading) {
    return (
      <div>
        <PageHeader eyebrow="Operacional" title="Multas e Juros" />
        <Card className="p-10 text-center text-slate-500">Carregando…</Card>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        eyebrow="Operacional"
        title="Multas e Juros"
        actions={
          <>
            <button onClick={addRow} className="flex items-center gap-1.5 text-[12px] border border-bg-border rounded-lg px-3 py-1.5 text-slate-300 hover:bg-bg-panel2"><Plus size={13} /> Nova guia</button>
            <button onClick={exportCSV} className="flex items-center gap-1.5 text-[12px] bg-id-dark hover:bg-id-mid rounded-lg px-3 py-1.5 font-medium"><Download size={13} /> Exportar CSV</button>
          </>
        }
      />
      <p className="text-[11px] text-slate-500 -mt-3 mb-4">Multa de mora 0,33%/dia (teto 20%). Juros = Selic acumulada dos meses intermediários + taxa fixa no mês de quitação.</p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Card className="p-3"><div className="text-[10px] uppercase text-slate-500">Total Imposto</div><div className="font-display text-lg font-semibold">{fmtBRL(totais.imposto)}</div></Card>
        <Card className="p-3"><div className="text-[10px] uppercase text-red-400/80">Total Multa</div><div className="font-display text-lg font-semibold text-red-400">{fmtBRL(totais.multa)}</div></Card>
        <Card className="p-3"><div className="text-[10px] uppercase text-amber-400/80">Total Juros</div><div className="font-display text-lg font-semibold text-amber-400">{fmtBRL(totais.juros)}</div></Card>
        <Card className="p-3"><div className="text-[10px] uppercase text-id-light">Total a Pagar</div><div className="font-display text-lg font-semibold text-id-light">{fmtBRL(totais.total)}</div></Card>
      </div>

      {/* Parâmetros + Selic */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <Card className="p-4">
          <div className="text-[10.5px] font-semibold uppercase text-slate-500 mb-3">Parâmetros</div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-[11px] text-slate-400">Multa/dia (%)
              <input defaultValue={(mj.params.taxaMultaDia * 100).toString()} onBlur={(e) => editParam('taxaMultaDia', e.target.value)} className="mt-1 w-full bg-bg-panel2 border border-bg-border rounded-lg px-2 py-1.5 text-[12px]" />
            </label>
            <label className="text-[11px] text-slate-400">Teto multa (%)
              <input defaultValue={(mj.params.tetoMulta * 100).toString()} onBlur={(e) => editParam('tetoMulta', e.target.value)} className="mt-1 w-full bg-bg-panel2 border border-bg-border rounded-lg px-2 py-1.5 text-[12px]" />
            </label>
            <label className="text-[11px] text-slate-400">Juros fixo mês quitação (%)
              <input defaultValue={(mj.params.jurosFixo * 100).toString()} onBlur={(e) => editParam('jurosFixo', e.target.value)} className="mt-1 w-full bg-bg-panel2 border border-bg-border rounded-lg px-2 py-1.5 text-[12px]" />
            </label>
            <label className="text-[11px] text-slate-400">Convenção contagem
              <select defaultValue={mj.params.convencao} onChange={(e) => editParam('convencao', e.target.value)} className="mt-1 w-full bg-bg-panel2 border border-bg-border rounded-lg px-2 py-1.5 text-[12px]">
                <option value="seguinte">Dia seguinte ao vencimento</option>
                <option value="vencimento">Incluir dia do vencimento</option>
              </select>
            </label>
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-[10.5px] font-semibold uppercase text-slate-500 mb-3">Tabela Selic mensal (RFB/SICALC)</div>
          <div className="flex gap-2 mb-2">
            <input type="month" value={selicMonth} onChange={(e) => setSelicMonth(e.target.value)} className="flex-1 bg-bg-panel2 border border-bg-border rounded-lg px-2 py-1.5 text-[12px]" />
            <input placeholder="Taxa %" value={selicRate} onChange={(e) => setSelicRate(e.target.value)} className="w-20 bg-bg-panel2 border border-bg-border rounded-lg px-2 py-1.5 text-[12px]" />
            <button onClick={addSelic} className="bg-id-dark hover:bg-id-mid rounded-lg px-3 text-[12px]">+</button>
          </div>
          <div className="max-h-[140px] overflow-y-auto space-y-1">
            {Object.entries(mj.selic).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between text-[11.5px] bg-bg-panel2 rounded-md px-2 py-1">
                <span>{monthLabel(k)}</span>
                <span className="font-mono">{fmtPct(v)}</span>
                <button onClick={() => deleteSelic(k)} className="text-red-400 text-[11px]">🗑</button>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Tabela de guias */}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10.5px] uppercase tracking-wider text-slate-500 border-b border-bg-border">
                <th className="px-2 py-2 font-medium">Fundo</th>
                <th className="px-2 py-2 font-medium">Tributo</th>
                <th className="px-2 py-2 font-medium">Vencimento</th>
                <th className="px-2 py-2 font-medium">Pagamento</th>
                <th className="px-2 py-2 font-medium text-right">Valor</th>
                <th className="px-2 py-2 font-medium text-right">Dias</th>
                <th className="px-2 py-2 font-medium text-right">Multa</th>
                <th className="px-2 py-2 font-medium text-right">Juros</th>
                <th className="px-2 py-2 font-medium text-right">Total</th>
                <th className="px-2 py-2 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {computed.map(({ guia: g, calc }) => (
                <tr key={g.id} className="border-b border-bg-border/60 text-[12px] hover:bg-bg-panel2/60">
                  <td className="px-2 py-1.5"><input defaultValue={g.fundo} onBlur={(e) => editField(g.id, 'fundo', e.target.value)} className="bg-transparent w-full outline-none" /></td>
                  <td className="px-2 py-1.5"><input defaultValue={g.tributo} onBlur={(e) => editField(g.id, 'tributo', e.target.value)} className="bg-transparent w-full outline-none" /></td>
                  <td className="px-2 py-1.5"><input type="date" defaultValue={g.venc} onBlur={(e) => editField(g.id, 'venc', e.target.value)} className="bg-transparent outline-none font-mono" /></td>
                  <td className="px-2 py-1.5"><input type="date" defaultValue={g.pgto} onBlur={(e) => editField(g.id, 'pgto', e.target.value)} className="bg-transparent outline-none font-mono" /></td>
                  <td className="px-2 py-1.5 text-right"><input defaultValue={g.valor} onBlur={(e) => editField(g.id, 'valor', e.target.value)} className="bg-transparent w-24 text-right font-mono outline-none" /></td>
                  <td className="px-2 py-1.5 text-right font-mono text-slate-400">{calc?.dias ?? '—'}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-red-400">{calc ? fmtBRL(calc.valorMulta) : '—'}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-amber-400">{calc ? fmtBRL(calc.valorJuros) : '—'}</td>
                  <td className="px-2 py-1.5 text-right font-mono font-semibold text-id-light">{calc ? fmtBRL(calc.total) : '—'}</td>
                  <td className="px-2 py-1.5 text-center"><button onClick={() => deleteRow(g.id)} className="text-slate-500 hover:text-red-400"><Trash2 size={13} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
