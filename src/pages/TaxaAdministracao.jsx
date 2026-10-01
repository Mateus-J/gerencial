import { useEffect, useMemo, useRef, useState } from 'react'
import { doc, onSnapshot, runTransaction } from 'firebase/firestore'
import * as XLSX from 'xlsx'
import {
  Upload, Download, Trash2, Plus, Pencil, X, CheckCircle2, Clock, AlertCircle, Search,
  FileSpreadsheet, ChevronLeft, ChevronRight, TrendingUp, TrendingDown, Building2, Users, Wallet,
} from 'lucide-react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell,
} from 'recharts'
import { db } from '../lib/firebase'
import { PageHeader, Card } from '../components/PageShell'
import { useToast } from '../components/Toast'
import { useAuth } from '../context/AuthContext'
import { useIsDark, chartTheme } from '../hooks/useIsDark'
import {
  ensureIds, cleanRow, recalc, parseWorkbook, mergeImport, newId, parseNum, onlyDigits, norm, sortKey,
  fmtShort, fmtFull, brDate, todayISO, rowsToSheetData, TEMPLATE_HEADERS,
} from '../lib/taxaAdm'

const DOC_REF = () => doc(db, 'controle', 'taxa_adm')
const FIP_DOC_REF = () => doc(db, 'controle', 'fip_taxas')
const FIP_CADASTRO_REF = () => doc(db, 'controle', 'fip_cadastro')
const PALETTE = ['#8FB352', '#38bdf8', '#a78bfa', '#f59e0b', '#2dd4bf', '#f87171', '#0ea5e9', '#84cc16', '#ec4899', '#eab308']
const PAGE_SIZE = 50
const FIELD_LABEL = {
  fundo: 'Fundo', gestor: 'Gestor', classif: 'Classificação', cnpj: 'CNPJ', conta: 'Conta', mesRef: 'Mês',
  status: 'Status', val: 'Valor', vencimento: 'Vencimento', dataPagamento: 'Pagamento', obs: 'Observação',
}

const isOverdue = (r) => r.status !== 'PAGO' && r.vencimento && r.vencimento < todayISO()
const mesToInput = (m) => (/^\d{2}\.\d{4}$/.test(m || '') ? m.slice(3) + '-' + m.slice(0, 2) : '')
const inputToMes = (v) => (/^\d{4}-\d{2}$/.test(v || '') ? v.slice(5) + '.' + v.slice(0, 4) : '')
const currentMes = () => { const d = new Date(); return String(d.getMonth() + 1).padStart(2, '0') + '.' + d.getFullYear() }

function timeAgo(ts) {
  if (!ts) return ''
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 45) return 'agora há pouco'
  const m = Math.round(s / 60)
  if (m < 60) return `há ${m} min`
  const h = Math.round(m / 60)
  if (h < 24) return `há ${h} h`
  return new Date(ts).toLocaleDateString('pt-BR')
}

export default function TaxaAdministracao() {
  const toast = useToast()
  const { currentUser } = useAuth()
  const who = currentUser?.name || currentUser?.username || ''
  const ct = chartTheme(useIsDark())

  const [docData, setDocData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [live, setLive] = useState('connecting') // connecting | ok | offline
  const [saving, setSaving] = useState(0)
  const [fipParsed, setFipParsed] = useState([])
  const [fipCadastro, setFipCadastro] = useState({})

  const [selMes, setSelMes] = useState('') // '' = período completo
  const [fGestor, setFGestor] = useState('')
  const [fClassif, setFClassif] = useState('')
  const [fStatus, setFStatus] = useState('')
  const [q, setQ] = useState('')
  const [sortCol, setSortCol] = useState('val')
  const [sortAsc, setSortAsc] = useState(false)
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState(new Set())
  const [editing, setEditing] = useState(null) // linha em edição, ou {} pra novo lançamento
  const [preview, setPreview] = useState(null) // { rows, skipped, fileName }
  const fileRef = useRef(null)
  const [, tick] = useState(0)

  // Tudo em tempo real: qualquer pessoa que marcar um pagamento, mudar um
  // valor ou importar a planilha atualiza a tela de todos na hora.
  useEffect(() => {
    const unsub = onSnapshot(DOC_REF(), { includeMetadataChanges: true }, (snap) => {
      setLive(snap.metadata.fromCache ? 'offline' : 'ok')
      if (!snap.metadata.hasPendingWrites) setDocData(snap.exists() ? snap.data() : null)
      setLoading(false)
    }, (e) => { console.warn('taLoad err', e); setLive('offline'); setLoading(false) })
    // FIPs administrados pela própria ID CTVM entram aqui (somente leitura —
    // a edição acontece na Área FIP).
    const unsubFip = onSnapshot(FIP_DOC_REF(), (snap) => setFipParsed(snap.exists() ? snap.data().parsed || [] : []), (e) => console.warn('taFipLoad err', e))
    const unsubCad = onSnapshot(FIP_CADASTRO_REF(), (snap) => setFipCadastro(snap.exists() ? snap.data().map || {} : {}), (e) => console.warn('taFipCadastroLoad err', e))
    const t = setInterval(() => tick((x) => x + 1), 30000)
    return () => { unsub(); unsubFip(); unsubCad(); clearInterval(t) }
  }, [])

  const rows = useMemo(() => ensureIds(docData?.parsed || []), [docData])

  const fipAdmRows = useMemo(() => fipParsed
    .filter((r) => norm(fipCadastro[onlyDigits(r.cnpj)]?.administrador).includes('ID CTVM'))
    .map((r) => ({
      id: 'fip-' + onlyDigits(r.cnpj) + '-' + r.mesRef, fundo: r.fundo, gestor: r.gestor, classif: r.classificacao,
      cnpj: r.cnpj, conta: r.conta, mesRef: r.mesRef, status: r.status, val: Number(r.valorAdm) || 0, _fromFip: true,
    })), [fipParsed, fipCadastro])

  const combined = useMemo(() => recalc([...rows, ...fipAdmRows]), [rows, fipAdmRows])

  // Toda gravação passa por aqui: aplica na tela na hora (otimista) e grava
  // numa transação em cima da versão MAIS RECENTE do servidor — assim duas
  // pessoas editando ao mesmo tempo não apagam a alteração uma da outra.
  // `fn` precisa ser pura (a transação pode rodar mais de uma vez).
  async function mutate(fn, { msg, extra, action } = {}) {
    setDocData((prev) => ({ ...(prev || {}), parsed: fn(ensureIds(prev?.parsed || [])) }))
    setSaving((s) => s + 1)
    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(DOC_REF())
        const cur = snap.exists() ? snap.data() : {}
        const next = fn(ensureIds(cur.parsed || [])).map(cleanRow)
        tx.set(DOC_REF(), {
          ...recalc(next),
          importedAt: cur.importedAt ?? null,
          importedBy: cur.importedBy ?? null,
          ...(extra || {}),
          updatedAt: Date.now(),
          updatedBy: who,
        })
      })
      if (msg) toast.success(msg, action)
    } catch (e) {
      console.warn('taSave err', e)
      toast.error('Não foi possível salvar: ' + e.message)
    } finally {
      setSaving((s) => s - 1)
    }
  }

  const stamp = () => ({ updatedAt: Date.now(), updatedBy: who })

  function updateRow(id, patch, msg) {
    const st = stamp()
    mutate((list) => list.map((r) => (r.id === id ? { ...r, ...patch, ...st } : r)), { msg })
  }
  function setStatus(ids, status) {
    const set = new Set(ids)
    const st = stamp()
    const today = todayISO()
    mutate((list) => list.map((r) => (set.has(r.id)
      ? { ...r, status, dataPagamento: status === 'PAGO' ? r.dataPagamento || today : '', ...st }
      : r)), { msg: ids.length > 1 ? `${ids.length} lançamentos marcados como ${status.toLowerCase()}.` : undefined })
  }
  function addRow(row) {
    const full = { ...row, id: newId(), ...stamp() }
    mutate((list) => [full, ...list], { msg: 'Lançamento incluído.' })
  }
  function deleteRows(ids) {
    const set = new Set(ids)
    const removed = rows.filter((r) => set.has(r.id))
    if (!removed.length) return
    setSelected(new Set())
    mutate((list) => list.filter((r) => !set.has(r.id)), {
      msg: `${removed.length} lançamento(s) excluído(s).`,
      action: {
        label: 'Desfazer',
        onClick: () => mutate((list) => [...removed.filter((r) => !list.some((x) => x.id === r.id)), ...list], { msg: 'Exclusão desfeita.' }),
      },
    })
  }

  function handleFile(file) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const res = parseWorkbook(e.target.result)
        if (!res.rows.length) { toast.error('Nenhum lançamento válido encontrado na planilha.'); return }
        setPreview({ ...res, fileName: file.name, replace: false })
      } catch (err) { console.error(err); toast.error('Erro ao ler a planilha: ' + err.message) }
    }
    reader.readAsArrayBuffer(file)
    if (fileRef.current) fileRef.current.value = ''
  }

  function confirmImport() {
    const { rows: incoming, replace, fileName } = preview
    const r = mergeImport(rows, incoming, { replace, who })
    setPreview(null)
    setSelected(new Set())
    mutate((list) => mergeImport(list, incoming, { replace, who }).rows, {
      extra: { importedAt: new Date().toLocaleString('pt-BR'), importedBy: who, importFile: fileName },
      msg: `Planilha aplicada: ${r.added.length} novo(s), ${r.updated.length} atualizado(s)${replace ? `, ${r.removed.length} removido(s)` : ''}.`,
    })
  }

  const gestores = useMemo(() => [...new Set(combined.parsed.map((r) => r.gestor).filter((g) => g && g !== '0'))].sort(), [combined])
  const classes = useMemo(() => [...new Set(combined.parsed.map((r) => r.classif).filter((c) => c && c !== '0'))].sort(), [combined])

  const filtered = useMemo(() => {
    const qq = norm(q)
    return combined.parsed.filter((r) => {
      if (selMes && r.mesRef !== selMes) return false
      if (fGestor && r.gestor !== fGestor) return false
      if (fClassif && r.classif !== fClassif) return false
      if (fStatus === 'VENCIDO' ? !isOverdue(r) : fStatus && r.status !== fStatus) return false
      if (qq && !norm(r.fundo).includes(qq) && !onlyDigits(r.cnpj).includes(onlyDigits(q) || '\u0000') && !norm(r.gestor).includes(qq)) return false
      return true
    })
  }, [combined, selMes, fGestor, fClassif, fStatus, q])

  const sortedRows = useMemo(() => {
    const out = [...filtered]
    out.sort((a, b) => {
      let va, vb
      if (sortCol === 'val') { va = a.val; vb = b.val }
      else if (sortCol === 'mesRef') { va = sortKey(a.mesRef); vb = sortKey(b.mesRef) }
      else if (sortCol === 'updatedAt') { va = a.updatedAt || 0; vb = b.updatedAt || 0 }
      else { va = (a[sortCol] || '').toString().toLowerCase(); vb = (b[sortCol] || '').toString().toLowerCase() }
      return (va > vb ? 1 : va < vb ? -1 : 0) * (sortAsc ? 1 : -1)
    })
    return out
  }, [filtered, sortCol, sortAsc])

  useEffect(() => { setPage(0) }, [selMes, fGestor, fClassif, fStatus, q, sortCol, sortAsc])
  const pageCount = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE))
  const pageRows = sortedRows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)

  function exportXlsx(list = filtered, name = 'taxa_adm') {
    if (!list.length) { toast.error('Nenhum dado para exportar.'); return }
    const ws = XLSX.utils.json_to_sheet(rowsToSheetData(list), { header: TEMPLATE_HEADERS })
    ws['!cols'] = TEMPLATE_HEADERS.map((h) => ({ wch: h === 'Fundo' ? 48 : h === 'Observação' ? 36 : 16 }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Taxa ADM')
    XLSX.writeFile(wb, `${name}_${todayISO()}.xlsx`)
  }
  function downloadTemplate() {
    const ws = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS, ['FUNDO EXEMPLO FIDC', 'Gestora X', 'FIDC', '00.000.000/0001-00', '12345-6', currentMes(), 1500, 'PENDENTE', '', '', '']])
    ws['!cols'] = TEMPLATE_HEADERS.map(() => ({ wch: 20 }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Modelo')
    XLSX.writeFile(wb, 'modelo_taxa_adm.xlsx')
  }

  const headerActions = (
    <>
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => handleFile(e.target.files[0])} />
      <button onClick={() => fileRef.current?.click()} className="btn"><Upload size={14} /> Importar planilha</button>
      <button onClick={() => exportXlsx()} className="btn"><Download size={14} /> Exportar</button>
      <button onClick={() => setEditing({})} className="btn btn-primary"><Plus size={14} /> Novo lançamento</button>
    </>
  )

  const liveMeta = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-[var(--tx3)]">
      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border ${live === 'ok' ? 'border-id-mid/40 text-id-dark dark:text-id-light bg-id-mid/10' : 'border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/10'}`}>
        <span className="relative flex w-1.5 h-1.5">
          {live === 'ok' && <span className="absolute inset-0 rounded-full bg-id-light live-ping" />}
          <span className={`relative w-1.5 h-1.5 rounded-full ${live === 'ok' ? 'bg-id-light' : 'bg-amber-500'}`} />
        </span>
        {live === 'ok' ? (saving ? 'Salvando…' : 'Ao vivo') : live === 'offline' ? 'Sem conexão — exibindo cópia local' : 'Conectando…'}
      </span>
      {docData?.updatedAt && <span>Última alteração {docData.updatedBy ? `por ${docData.updatedBy} ` : ''}{timeAgo(docData.updatedAt)}</span>}
      {docData?.importedAt && <span>· Planilha importada em {docData.importedAt}{docData.importedBy ? ` por ${docData.importedBy}` : ''}</span>}
    </div>
  )

  const overlays = (
    <>
      {editing && (
        <EditDrawer
          row={editing}
          allRows={rows}
          gestores={gestores}
          classes={classes}
          defaultMes={selMes || combined.lastMes || currentMes()}
          onClose={() => setEditing(null)}
          onSave={(data) => {
            if (editing.id) updateRow(editing.id, data, 'Lançamento atualizado.')
            else addRow(data)
            setEditing(null)
          }}
          onDelete={editing.id ? () => { deleteRows([editing.id]); setEditing(null) } : null}
        />
      )}
      {preview && (
        <ImportPreview
          preview={preview}
          diff={mergeImport(rows, preview.rows, { replace: preview.replace, who })}
          onToggleReplace={() => setPreview((p) => ({ ...p, replace: !p.replace }))}
          onCancel={() => setPreview(null)}
          onConfirm={confirmImport}
        />
      )}
    </>
  )

  if (loading) {
    return (
      <div>
        <PageHeader eyebrow="Operacional" title="Taxa de Administração" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => <Card key={i} className="h-[110px] animate-pulse" />)}
        </div>
      </div>
    )
  }

  if (!rows.length && !fipAdmRows.length) {
    return (
      <div>
        <PageHeader eyebrow="Operacional" title="Taxa de Administração" meta={liveMeta} actions={headerActions} />
        <Card className="p-12 flex flex-col items-center text-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-id-mid/15 text-id-dark dark:text-id-light flex items-center justify-center"><FileSpreadsheet size={22} /></div>
          <div className="font-display font-semibold text-[15px]">Nenhum lançamento ainda</div>
          <p className="text-[12.5px] text-[var(--tx3)] max-w-[420px]">Importe a planilha de cobranças (.xlsx) ou inclua lançamentos manualmente. Tudo o que for alterado aparece na hora para toda a equipe.</p>
          <div className="flex gap-2 mt-1">
            <button onClick={() => fileRef.current?.click()} className="btn btn-primary"><Upload size={14} /> Importar planilha</button>
            <button onClick={downloadTemplate} className="btn"><Download size={14} /> Baixar modelo</button>
          </div>
        </Card>
        {overlays}
      </div>
    )
  }

  // ---- números do período filtrado ----
  const total = filtered.reduce((a, r) => a + r.val, 0)
  const pago = filtered.filter((r) => r.status === 'PAGO').reduce((a, r) => a + r.val, 0)
  const pend = total - pago
  const vencido = filtered.filter(isOverdue).reduce((a, r) => a + r.val, 0)
  const pct = total > 0 ? (pago / total) * 100 : 0
  const mo = combined.monthly
  const refIdx = selMes ? mo.findIndex((m) => m.mes === selMes) : mo.length - 1
  const cur = mo[refIdx]
  const prev = refIdx > 0 ? mo[refIdx - 1] : null
  const growth = cur && prev && prev.total > 0 ? ((cur.total - prev.total) / prev.total) * 100 : null
  const fundosU = new Set(filtered.map((r) => r.fundo)).size
  const gestU = new Set(filtered.map((r) => r.gestor).filter((g) => g && g !== '0')).size
  const countPend = filtered.filter((r) => r.status !== 'PAGO').length

  const agg = (key, pred) => {
    const m = {}
    filtered.filter((r) => !pred || pred(r)).forEach((r) => { const k = r[key] || '—'; m[k] = (m[k] || 0) + r.val })
    return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value }))
  }
  const topDevedores = agg('fundo', (r) => r.status !== 'PAGO').slice(0, 6)
  const topGestores = agg('gestor').filter((g) => g.name !== '—' && g.name !== '0').slice(0, 6)
  const clsAll = agg('classif').filter((c) => c.name !== '—' && c.name !== '0')
  const clsDist = clsAll.length > 7 ? [...clsAll.slice(0, 6), { name: 'Outros', value: clsAll.slice(6).reduce((a, c) => a + c.value, 0) }] : clsAll
  const chartMonths = mo.slice(-14)

  const selectedIds = [...selected]
  const allPageSelectable = pageRows.filter((r) => !r._fromFip)
  const allPageChecked = allPageSelectable.length > 0 && allPageSelectable.every((r) => selected.has(r.id))

  const tip = { contentStyle: { background: ct.tipBg, border: `1px solid ${ct.tipBdr}`, borderRadius: 12, fontSize: 12, color: ct.tipTx }, labelStyle: { color: ct.tipTx }, itemStyle: { color: ct.tipTx } }

  return (
    <div>
      <PageHeader eyebrow="Operacional" title="Taxa de Administração" meta={liveMeta} actions={headerActions} />

      {/* Filtros */}
      <Card className="p-3 mb-4">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 -mb-1">
          <button onClick={() => setSelMes('')} className={`chip shrink-0 ${!selMes ? 'chip-on' : ''}`}>Período completo</button>
          <span className="w-px h-5 bg-[var(--bdr)] mx-1 shrink-0" />
          {[...combined.months].reverse().slice(0, 24).map((m) => (
            <button key={m} onClick={() => setSelMes(selMes === m ? '' : m)} className={`chip shrink-0 font-mono ${selMes === m ? 'chip-on' : ''}`}>{m}</button>
          ))}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-[1fr_1fr_1fr_2fr] gap-2 mt-3">
          <select value={fGestor} onChange={(e) => setFGestor(e.target.value)} className="field">
            <option value="">Todos os gestores</option>{gestores.map((g) => <option key={g}>{g}</option>)}
          </select>
          <select value={fClassif} onChange={(e) => setFClassif(e.target.value)} className="field">
            <option value="">Todas as classificações</option>{classes.map((c) => <option key={c}>{c}</option>)}
          </select>
          <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className="field">
            <option value="">Todos os status</option><option value="PAGO">Pago</option><option value="PENDENTE">Pendente</option><option value="VENCIDO">Vencido</option>
          </select>
          <div className="relative col-span-2 md:col-span-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--tx4)]" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar fundo, gestor ou CNPJ…" className="field pl-9" />
          </div>
        </div>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr_1fr] gap-3 mb-3">
        <Card className="p-5 relative overflow-hidden">
          <div className="absolute -right-10 -top-10 w-40 h-40 rounded-full bg-id-light/10 blur-2xl" />
          <div className="text-[10.5px] font-semibold tracking-widest uppercase text-[var(--tx3)]">Total cobrado · {selMes || 'período completo'}</div>
          <div className="font-display text-[30px] font-semibold tracking-tight mt-1">{fmtFull(total)}</div>
          <div className="mt-3">
            <div className="flex justify-between text-[11px] text-[var(--tx3)] mb-1.5">
              <span>{pct.toFixed(1).replace('.', ',')}% recebido</span>
              {growth !== null && (
                <span className={`inline-flex items-center gap-1 ${growth >= 0 ? 'text-id-dark dark:text-id-light' : 'text-red-500'}`}>
                  {growth >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                  {Math.abs(growth).toFixed(1).replace('.', ',')}% vs {prev.mes}
                </span>
              )}
            </div>
            <div className="h-2 rounded-full bg-[var(--sur2)] overflow-hidden flex">
              <div className="h-full bg-gradient-to-r from-id-mid to-id-light transition-all duration-500" style={{ width: pct + '%' }} />
            </div>
          </div>
        </Card>
        <StatCard icon={CheckCircle2} tone="green" label="Recebido" value={fmtFull(pago)} sub={`${filtered.length - countPend} lançamento(s) pagos`} />
        <StatCard icon={Clock} tone={pend > 0 ? 'amber' : 'neutral'} label="Em aberto" value={fmtFull(pend)} sub={vencido > 0 ? `${fmtShort(vencido)} vencido` : `${countPend} lançamento(s) pendentes`} onClick={() => setFStatus(fStatus === 'PENDENTE' ? '' : 'PENDENTE')} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <MiniStat icon={Building2} label="Fundos" value={fundosU} />
        <MiniStat icon={Users} label="Gestores" value={gestU} />
        <MiniStat icon={Wallet} label="Ticket médio" value={fundosU ? fmtShort(total / fundosU) : '—'} />
        <MiniStat icon={AlertCircle} label="Vencidos" value={filtered.filter(isOverdue).length} tone={vencido > 0 ? 'red' : undefined} onClick={() => setFStatus(fStatus === 'VENCIDO' ? '' : 'VENCIDO')} />
      </div>

      {/* Gráficos */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 mb-4">
        <Card className="p-4 xl:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[12.5px] font-semibold">Evolução mensal</div>
            <div className="flex gap-3 text-[11px] text-[var(--tx3)]">
              <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-[#8FB352]" />Recebido</span>
              <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-[#f59e0b]" />Em aberto</span>
            </div>
          </div>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartMonths} barCategoryGap="22%">
                <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} vertical={false} />
                <XAxis dataKey="mes" tick={{ fontSize: 10.5, fill: ct.axis }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10.5, fill: ct.axis }} tickFormatter={(v) => fmtShort(v).replace("R$ ", "")} axisLine={false} tickLine={false} width={48} />
                <Tooltip formatter={(v, n) => [fmtFull(v), n === 'pago' ? 'Recebido' : 'Em aberto']} cursor={{ fill: ct.grid, opacity: 0.5 }} {...tip} />
                <Bar dataKey="pago" stackId="a" fill="#8FB352" radius={[0, 0, 4, 4]} onClick={(d) => setSelMes(d?.payload?.mes ?? d?.mes ?? "")} className="cursor-pointer" />
                <Bar dataKey="pend" stackId="a" fill="#f59e0b" radius={[4, 4, 0, 0]} onClick={(d) => setSelMes(d?.payload?.mes ?? d?.mes ?? "")} className="cursor-pointer" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-[12.5px] font-semibold mb-2">Por classificação</div>
          <div className="h-[150px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={clsDist} dataKey="value" nameKey="name" innerRadius={44} outerRadius={68} paddingAngle={2} stroke="none">
                  {clsDist.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                </Pie>
                <Tooltip formatter={(v) => fmtFull(v)} {...tip} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-1 mt-2">
            {clsDist.map((c, i) => (
              <button key={c.name} onClick={() => c.name !== 'Outros' && setFClassif(fClassif === c.name ? '' : c.name)} className="w-full flex items-center gap-2 text-[11.5px] hover:bg-[var(--sur2)] rounded-md px-1 py-0.5">
                <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: PALETTE[i % PALETTE.length] }} />
                <span className="truncate flex-1 text-left text-[var(--tx2)]">{c.name}</span>
                <span className="font-mono text-[var(--tx3)]">{total ? ((c.value / total) * 100).toFixed(0) : 0}%</span>
              </button>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <RankCard title="Maiores valores em aberto" tone="amber" items={topDevedores} empty="Nenhum valor em aberto no período 🎉" onPick={(n) => setQ(n)} />
        <RankCard title="Maiores gestores (total cobrado)" tone="green" items={topGestores} empty="Sem gestores no período" onPick={(n) => setFGestor(n)} />
      </div>

      {/* Tabela */}
      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--bdr)] flex flex-wrap items-center gap-2">
          <div className="text-[12.5px] font-semibold mr-auto">
            Lançamentos <span className="text-[var(--tx3)] font-normal">· {sortedRows.length} registro(s)</span>
          </div>
          {selected.size > 0 ? (
            <div className="flex flex-wrap items-center gap-2 animate-fade-up">
              <span className="text-[11.5px] text-[var(--tx3)]">{selected.size} selecionado(s)</span>
              <button onClick={() => { setStatus(selectedIds, 'PAGO'); setSelected(new Set()) }} className="btn btn-sm"><CheckCircle2 size={13} className="text-id-mid" /> Marcar pago</button>
              <button onClick={() => { setStatus(selectedIds, 'PENDENTE'); setSelected(new Set()) }} className="btn btn-sm"><Clock size={13} className="text-amber-500" /> Marcar pendente</button>
              <button onClick={() => exportXlsx(rows.filter((r) => selected.has(r.id)), 'taxa_adm_selecao')} className="btn btn-sm"><Download size={13} /> Exportar</button>
              <button onClick={() => deleteRows(selectedIds)} className="btn btn-sm btn-danger"><Trash2 size={13} /> Excluir</button>
              <button onClick={() => setSelected(new Set())} className="btn btn-sm"><X size={13} /></button>
            </div>
          ) : (
            <button onClick={() => setEditing({})} className="btn btn-sm"><Plus size={13} /> Nova linha</button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left min-w-[980px]">
            <thead>
              <tr className="text-[10.5px] uppercase tracking-wider text-[var(--tx3)] bg-[var(--sur2)]/50">
                <th className="pl-4 pr-1 py-2.5 w-8">
                  <input type="checkbox" checked={allPageChecked} onChange={() => setSelected((s) => { const n = new Set(s); allPageSelectable.forEach((r) => { if (allPageChecked) n.delete(r.id); else n.add(r.id) }); return n })} className="accent-[#6B9A52]" />
                </th>
                {[['fundo', 'Fundo'], ['gestor', 'Gestor'], ['classif', 'Classif.'], ['mesRef', 'Mês'], ['vencimento', 'Vencimento'], ['val', 'Valor', 'text-right'], ['status', 'Status'], ['updatedAt', 'Atualizado']].map(([c, l, cls]) => (
                  <th key={c} className={`px-2 py-2.5 font-semibold cursor-pointer select-none hover:text-[var(--tx)] ${cls || ''}`} onClick={() => { if (sortCol === c) setSortAsc(!sortAsc); else { setSortCol(c); setSortAsc(!['val', 'updatedAt', 'mesRef'].includes(c)) } }}>
                    {l}{sortCol === c ? (sortAsc ? ' ↑' : ' ↓') : ''}
                  </th>
                ))}
                <th className="px-2 py-2.5 w-16" />
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => {
                const fresh = r.updatedAt && Date.now() - r.updatedAt < 6000
                return (
                  <tr key={r.id + (fresh ? ':' + r.updatedAt : '')} className={`group border-t border-[var(--bdr)]/70 text-[12px] hover:bg-[var(--sur2)]/60 ${selected.has(r.id) ? 'bg-id-mid/5' : ''} ${fresh ? 'row-flash' : ''}`}>
                    <td className="pl-4 pr-1 py-2">
                      {r._fromFip
                        ? <span title="Vem da Área FIP — edite lá" className="text-[9px] font-semibold text-id-dark dark:text-id-light border border-id-mid/40 rounded px-1 py-0.5">FIP</span>
                        : <input type="checkbox" checked={selected.has(r.id)} onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n })} className="accent-[#6B9A52]" />}
                    </td>
                    <td className="px-2 py-2 max-w-[320px]">
                      <button disabled={r._fromFip} onClick={() => setEditing(r)} className="text-left w-full disabled:cursor-default">
                        <div className="font-medium truncate" title={r.fundo}>{r.fundo}</div>
                        {(r.cnpj || r.obs) && <div className="text-[10.5px] text-[var(--tx3)] truncate" title={r.obs}>{r.cnpj}{r.cnpj && r.obs ? ' · ' : ''}{r.obs}</div>}
                      </button>
                    </td>
                    <td className="px-2 py-2 text-[var(--tx2)] max-w-[160px] truncate" title={r.gestor}>{r.gestor || '—'}</td>
                    <td className="px-2 py-2 text-[var(--tx2)]">{r.classif || '—'}</td>
                    <td className="px-2 py-2 font-mono text-[11.5px] text-[var(--tx2)]">{r.mesRef}</td>
                    <td className={`px-2 py-2 font-mono text-[11.5px] ${isOverdue(r) ? 'text-red-500 font-medium' : 'text-[var(--tx3)]'}`}>{r.vencimento ? brDate(r.vencimento) : '—'}</td>
                    <td className="px-2 py-2 text-right">
                      {r._fromFip ? <span className="font-mono text-[var(--tx2)]">{fmtFull(r.val)}</span> : (
                        <input
                          key={r.id + ':' + r.val}
                          defaultValue={r.val.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          onFocus={(e) => e.target.select()}
                          onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') { e.target.value = r.val.toLocaleString('pt-BR', { minimumFractionDigits: 2 }); e.target.blur() } }}
                          onBlur={(e) => { const v = Math.round(parseNum(e.target.value) * 100) / 100; if (Math.abs(v - r.val) > 0.004) updateRow(r.id, { val: v }) }}
                          className="w-[120px] text-right font-mono bg-transparent rounded-md px-1.5 py-1 outline-none border border-transparent hover:border-[var(--bdr)] focus:border-id-mid focus:bg-[var(--sur)]"
                          title="Clique para editar o valor"
                        />
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <StatusPill row={r} onToggle={r._fromFip ? null : () => setStatus([r.id], r.status === 'PAGO' ? 'PENDENTE' : 'PAGO')} />
                    </td>
                    <td className="px-2 py-2 text-[10.5px] text-[var(--tx3)] whitespace-nowrap">
                      {r.updatedAt ? <span title={new Date(r.updatedAt).toLocaleString('pt-BR')}>{r.updatedBy ? r.updatedBy.split(' ')[0] + ' · ' : ''}{timeAgo(r.updatedAt)}</span> : '—'}
                    </td>
                    <td className="px-2 py-2">
                      {!r._fromFip && (
                        <div className="flex justify-end gap-0.5 opacity-60 group-hover:opacity-100">
                          <button onClick={() => setEditing(r)} title="Editar" className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--tx3)] hover:text-[var(--tx)] hover:bg-[var(--sur2)]"><Pencil size={13} /></button>
                          <button onClick={() => deleteRows([r.id])} title="Excluir" className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--tx3)] hover:text-red-500 hover:bg-red-500/10"><Trash2 size={13} /></button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
              {!pageRows.length && (
                <tr><td colSpan={10} className="px-4 py-10 text-center text-[12.5px] text-[var(--tx3)]">Nenhum lançamento com esses filtros.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {pageCount > 1 && (
          <div className="px-4 py-2.5 border-t border-[var(--bdr)] flex items-center justify-between text-[11.5px] text-[var(--tx3)]">
            <span>{page * PAGE_SIZE + 1}–{Math.min(sortedRows.length, (page + 1) * PAGE_SIZE)} de {sortedRows.length}</span>
            <div className="flex items-center gap-1">
              <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="btn btn-sm"><ChevronLeft size={13} /></button>
              <span className="px-2">Página {page + 1} de {pageCount}</span>
              <button disabled={page >= pageCount - 1} onClick={() => setPage((p) => p + 1)} className="btn btn-sm"><ChevronRight size={13} /></button>
            </div>
          </div>
        )}
      </Card>

      {overlays}
    </div>
  )
}

const TONES = {
  green: { icon: 'bg-id-mid/15 text-id-dark dark:text-id-light', value: 'text-id-dark dark:text-id-light', bar: 'bg-id-light' },
  amber: { icon: 'bg-amber-500/15 text-amber-600 dark:text-amber-400', value: 'text-amber-600 dark:text-amber-400', bar: 'bg-amber-400' },
  red: { icon: 'bg-red-500/15 text-red-600 dark:text-red-400', value: 'text-red-600 dark:text-red-400', bar: 'bg-red-400' },
  neutral: { icon: 'bg-[var(--sur2)] text-[var(--tx3)]', value: 'text-[var(--tx)]', bar: 'bg-[var(--tx4)]' },
}

function StatCard({ icon: Icon, tone = 'neutral', label, value, sub, onClick }) {
  const t = TONES[tone]
  const Tag = onClick ? 'button' : 'div'
  return (
    <Card className="p-0">
      <Tag onClick={onClick} className="w-full h-full text-left p-5 rounded-2xl transition-colors hover:bg-[var(--sur2)]/40">
        <div className="flex items-center gap-2">
          <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${t.icon}`}><Icon size={15} /></span>
          <span className="text-[10.5px] font-semibold tracking-widest uppercase text-[var(--tx3)]">{label}</span>
        </div>
        <div className={`font-display text-[22px] font-semibold tracking-tight mt-3 ${t.value}`}>{value}</div>
        {sub && <div className="text-[11.5px] text-[var(--tx3)] mt-0.5">{sub}</div>}
      </Tag>
    </Card>
  )
}

function MiniStat({ icon: Icon, label, value, tone, onClick }) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Card className="p-0">
      <Tag onClick={onClick} className="w-full text-left px-4 py-3 rounded-2xl flex items-center gap-3 hover:bg-[var(--sur2)]/40 transition-colors">
        <span className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${TONES[tone || 'neutral'].icon}`}><Icon size={15} /></span>
        <div className="min-w-0">
          <div className="text-[10px] font-semibold tracking-widest uppercase text-[var(--tx3)]">{label}</div>
          <div className={`font-display text-[17px] font-semibold ${tone ? TONES[tone].value : ''}`}>{value}</div>
        </div>
      </Tag>
    </Card>
  )
}

function RankCard({ title, tone, items, empty, onPick }) {
  const max = items[0]?.value || 1
  return (
    <Card className="p-4">
      <div className="text-[12.5px] font-semibold mb-3">{title}</div>
      <div className="space-y-2.5">
        {items.map((f) => (
          <button key={f.name} onClick={() => onPick(f.name)} className="w-full text-left group">
            <div className="flex items-center gap-2 text-[11.5px]">
              <span className="flex-1 truncate text-[var(--tx2)] group-hover:text-[var(--tx)]">{f.name}</span>
              <span className={`font-mono ${TONES[tone].value}`}>{fmtShort(f.value)}</span>
            </div>
            <div className="h-1.5 mt-1 rounded-full bg-[var(--sur2)] overflow-hidden">
              <div className={`h-full rounded-full ${TONES[tone].bar}`} style={{ width: Math.max(3, (f.value / max) * 100) + '%' }} />
            </div>
          </button>
        ))}
        {!items.length && <div className="text-[12px] text-[var(--tx3)]">{empty}</div>}
      </div>
    </Card>
  )
}

function StatusPill({ row, onToggle }) {
  const paid = row.status === 'PAGO'
  const overdue = isOverdue(row)
  const cls = paid
    ? 'bg-id-mid/15 text-id-dark dark:text-id-light border-id-mid/30'
    : overdue ? 'bg-red-500/12 text-red-600 dark:text-red-400 border-red-500/30'
      : 'bg-amber-500/12 text-amber-700 dark:text-amber-400 border-amber-500/30'
  const label = paid ? 'Pago' : overdue ? 'Vencido' : row.status === 'PENDENTE' ? 'Pendente' : row.status
  const Icon = paid ? CheckCircle2 : overdue ? AlertCircle : Clock
  const title = onToggle
    ? (paid ? `Pago${row.dataPagamento ? ' em ' + brDate(row.dataPagamento) : ''} — clique para voltar a pendente` : 'Clique para marcar como pago')
    : undefined
  return (
    <button
      disabled={!onToggle}
      onClick={onToggle}
      title={title}
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-full border text-[10.5px] font-semibold transition-transform enabled:hover:scale-105 enabled:active:scale-95 ${cls}`}
    >
      <Icon size={11} /> {label}
    </button>
  )
}

function Overlay({ children, onClose, side }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className={`fixed inset-0 z-50 flex ${side ? 'justify-end' : 'items-center justify-center p-4'}`}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] animate-fade-up" onClick={onClose} />
      {children}
    </div>
  )
}

function EditDrawer({ row, allRows, gestores, classes, defaultMes, onClose, onSave, onDelete }) {
  const isNew = !row.id
  const [f, setF] = useState(() => ({
    fundo: row.fundo || '', gestor: row.gestor || '', classif: row.classif || '', cnpj: row.cnpj || '', conta: row.conta || '',
    mesRef: row.mesRef || defaultMes, status: row.status || 'PENDENTE',
    val: row.val != null ? row.val.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '',
    vencimento: row.vencimento || '', dataPagamento: row.dataPagamento || '', obs: row.obs || '',
  }))
  const [err, setErr] = useState('')
  const fundos = useMemo(() => [...new Set(allRows.map((r) => r.fundo))].sort(), [allRows])
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))

  // Ao escolher um fundo já conhecido num lançamento novo, puxa gestor,
  // classificação, CNPJ e conta do lançamento mais recente dele.
  function onFundo(e) {
    const v = e.target.value
    setF((x) => {
      const next = { ...x, fundo: v }
      if (isNew) {
        const last = allRows.filter((r) => norm(r.fundo) === norm(v)).sort((a, b) => sortKey(b.mesRef) - sortKey(a.mesRef))[0]
        if (last) ['gestor', 'classif', 'cnpj', 'conta'].forEach((k) => { if (!x[k]) next[k] = last[k] || '' })
      }
      return next
    })
  }

  function submit(e) {
    e.preventDefault()
    const val = Math.round(parseNum(f.val) * 100) / 100
    if (!f.fundo.trim()) return setErr('Informe o fundo.')
    if (!/^\d{2}\.\d{4}$/.test(f.mesRef)) return setErr('Informe o mês de referência.')
    if (val < 0) return setErr('Valor inválido.')
    const dup = allRows.find((r) => r.id !== row.id && norm(r.fundo) === norm(f.fundo) && r.mesRef === f.mesRef)
    if (dup && !confirm(`Já existe um lançamento de ${f.fundo} em ${f.mesRef}. Salvar mesmo assim?`)) return
    onSave({
      fundo: f.fundo.trim(), gestor: f.gestor.trim(), classif: f.classif.trim(), cnpj: f.cnpj.trim(), conta: f.conta.trim(),
      mesRef: f.mesRef, status: f.status, val, vencimento: f.vencimento,
      dataPagamento: f.status === 'PAGO' ? f.dataPagamento || todayISO() : '', obs: f.obs.trim(),
    })
  }

  return (
    <Overlay onClose={onClose} side>
      <form onSubmit={submit} className="relative h-full w-full max-w-[460px] bg-[var(--sur)] border-l border-[var(--bdr)] shadow-[var(--shadow-pop)] flex flex-col animate-slide-in">
        <div className="px-5 py-4 border-b border-[var(--bdr)] flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[10.5px] font-semibold tracking-widest uppercase text-id-dark dark:text-id-light">{isNew ? 'Novo lançamento' : 'Editar lançamento'}</div>
            <div className="font-display font-semibold text-[15px] truncate">{f.fundo || 'Taxa de Administração'}</div>
          </div>
          <button type="button" onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--tx3)] hover:bg-[var(--sur2)] hover:text-[var(--tx)]"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <label className="label">Status</label>
            <div className="grid grid-cols-2 gap-2">
              {['PENDENTE', 'PAGO'].map((s) => (
                <button type="button" key={s} onClick={() => setF((x) => ({ ...x, status: s, dataPagamento: s === 'PAGO' ? x.dataPagamento || todayISO() : '' }))}
                  className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl border text-[12.5px] font-medium transition-colors ${f.status === s
                    ? s === 'PAGO' ? 'bg-id-mid/15 border-id-mid/50 text-id-dark dark:text-id-light' : 'bg-amber-500/12 border-amber-500/50 text-amber-700 dark:text-amber-400'
                    : 'border-[var(--bdr)] text-[var(--tx3)] hover:bg-[var(--sur2)]'}`}>
                  {s === 'PAGO' ? <CheckCircle2 size={14} /> : <Clock size={14} />} {s === 'PAGO' ? 'Pago' : 'Pendente'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label">Fundo *</label>
            <input list="ta-fundos" value={f.fundo} onChange={onFundo} className="field" placeholder="Nome do fundo" autoFocus={isNew} />
            <datalist id="ta-fundos">{fundos.map((x) => <option key={x} value={x} />)}</datalist>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Valor (R$) *</label>
              <input value={f.val} onChange={set('val')} inputMode="decimal" placeholder="0,00" className="field font-mono text-right" />
            </div>
            <div>
              <label className="label">Mês de referência *</label>
              <input type="month" value={mesToInput(f.mesRef)} onChange={(e) => setF((x) => ({ ...x, mesRef: inputToMes(e.target.value) }))} className="field" />
            </div>
            <div>
              <label className="label">Vencimento</label>
              <input type="date" value={f.vencimento} onChange={set('vencimento')} className="field" />
            </div>
            <div>
              <label className="label">Data do pagamento</label>
              <input type="date" value={f.dataPagamento} disabled={f.status !== 'PAGO'} onChange={set('dataPagamento')} className="field disabled:opacity-50" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Gestor</label>
              <input list="ta-gestores" value={f.gestor} onChange={set('gestor')} className="field" />
              <datalist id="ta-gestores">{gestores.map((x) => <option key={x} value={x} />)}</datalist>
            </div>
            <div>
              <label className="label">Classificação</label>
              <input list="ta-classes" value={f.classif} onChange={set('classif')} className="field" />
              <datalist id="ta-classes">{classes.map((x) => <option key={x} value={x} />)}</datalist>
            </div>
            <div>
              <label className="label">CNPJ</label>
              <input value={f.cnpj} onChange={set('cnpj')} className="field font-mono" placeholder="00.000.000/0000-00" />
            </div>
            <div>
              <label className="label">Conta do fundo</label>
              <input value={f.conta} onChange={set('conta')} className="field font-mono" />
            </div>
          </div>

          <div>
            <label className="label">Observação</label>
            <textarea value={f.obs} onChange={set('obs')} rows={3} className="field resize-none" placeholder="Informações gerais, combinados, nº do boleto…" />
          </div>

          {!isNew && row.updatedAt && (
            <div className="text-[11px] text-[var(--tx3)]">Última alteração {row.updatedBy ? `por ${row.updatedBy} ` : ''}em {new Date(row.updatedAt).toLocaleString('pt-BR')}</div>
          )}
          {err && <div className="text-[12px] text-red-500 flex items-center gap-1.5"><AlertCircle size={14} /> {err}</div>}
        </div>

        <div className="px-5 py-3.5 border-t border-[var(--bdr)] flex items-center gap-2">
          {onDelete && <button type="button" onClick={onDelete} className="btn btn-danger"><Trash2 size={14} /> Excluir</button>}
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={onClose} className="btn">Cancelar</button>
            <button type="submit" className="btn btn-primary">{isNew ? 'Incluir' : 'Salvar'}</button>
          </div>
        </div>
      </form>
    </Overlay>
  )
}

function ImportPreview({ preview, diff, onToggleReplace, onCancel, onConfirm }) {
  const [tab, setTab] = useState(diff.updated.length ? 'updated' : 'added')
  const nothing = !diff.added.length && !diff.updated.length && !(preview.replace && diff.removed.length)
  const fmtVal = (k, v) => (k === 'val' ? fmtFull(v) : k === 'vencimento' || k === 'dataPagamento' ? brDate(v) || '—' : v || '—')
  const tabs = [['updated', 'Atualizados', diff.updated.length], ['added', 'Novos', diff.added.length], ...(preview.replace ? [['removed', 'Removidos', diff.removed.length]] : [])]

  return (
    <Overlay onClose={onCancel}>
      <div className="relative w-full max-w-[760px] max-h-[88vh] bg-[var(--sur)] border border-[var(--bdr)] rounded-2xl shadow-[var(--shadow-pop)] flex flex-col animate-fade-up">
        <div className="px-5 py-4 border-b border-[var(--bdr)] flex items-center gap-3">
          <span className="w-9 h-9 rounded-xl bg-id-mid/15 text-id-dark dark:text-id-light flex items-center justify-center"><FileSpreadsheet size={18} /></span>
          <div className="min-w-0 flex-1">
            <div className="font-display font-semibold text-[15px]">Conferir importação</div>
            <div className="text-[11.5px] text-[var(--tx3)] truncate">{preview.fileName} · aba “{preview.sheet}” · {preview.rows.length} linha(s) lidas{preview.skipped ? ` · ${preview.skipped} ignorada(s) sem mês/valor` : ''}</div>
          </div>
          <button onClick={onCancel} className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--tx3)] hover:bg-[var(--sur2)]"><X size={16} /></button>
        </div>

        <div className="p-5 pb-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[['Novos', diff.added.length, 'text-sky-600 dark:text-sky-400'], ['Atualizados', diff.updated.length, 'text-amber-600 dark:text-amber-400'], ['Sem mudança', diff.unchanged, 'text-[var(--tx3)]'], ['Removidos', preview.replace ? diff.removed.length : 0, 'text-red-500']].map(([l, n, c]) => (
            <div key={l} className="rounded-xl border border-[var(--bdr)] px-3 py-2.5">
              <div className="text-[10px] font-semibold tracking-widest uppercase text-[var(--tx3)]">{l}</div>
              <div className={`font-display text-[20px] font-semibold ${c}`}>{n}</div>
            </div>
          ))}
        </div>

        <label className="mx-5 mb-3 flex items-start gap-2.5 rounded-xl border border-[var(--bdr)] px-3 py-2.5 cursor-pointer hover:bg-[var(--sur2)]/50">
          <input type="checkbox" checked={preview.replace} onChange={onToggleReplace} className="mt-0.5 accent-[#6B9A52]" />
          <span className="text-[12px]">
            <span className="font-medium">Substituir a base pela planilha</span>
            <span className="block text-[var(--tx3)] text-[11.5px]">Remove os lançamentos que não estão no arquivo. Deixe desmarcado para só atualizar os existentes e incluir os novos.</span>
          </span>
        </label>

        <div className="px-5 flex gap-1 border-b border-[var(--bdr)]">
          {tabs.map(([k, l, n]) => (
            <button key={k} onClick={() => setTab(k)} className={`px-3 py-2 text-[12px] border-b-2 -mb-px ${tab === k ? 'border-id-mid text-[var(--tx)] font-medium' : 'border-transparent text-[var(--tx3)]'}`}>{l} <span className="text-[var(--tx4)]">{n}</span></button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3 min-h-[160px]">
          {tab === 'updated' && diff.updated.slice(0, 200).map(({ row, changes }) => (
            <div key={row.id} className="py-2 border-b border-[var(--bdr)]/60 last:border-0">
              <div className="text-[12px] font-medium truncate">{row.fundo} <span className="font-mono text-[var(--tx3)] font-normal">· {row.mesRef}</span></div>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {changes.map((c) => (
                  <span key={c.field} className="text-[11px] rounded-md bg-[var(--sur2)] px-1.5 py-0.5">
                    <span className="text-[var(--tx3)]">{FIELD_LABEL[c.field]}:</span> <span className="line-through text-[var(--tx4)]">{fmtVal(c.field, c.from)}</span> → <span className="font-medium">{fmtVal(c.field, c.to)}</span>
                  </span>
                ))}
              </div>
            </div>
          ))}
          {tab === 'added' && diff.added.slice(0, 200).map((r) => (
            <div key={r.id} className="py-1.5 border-b border-[var(--bdr)]/60 last:border-0 flex items-center gap-2 text-[12px]">
              <span className="flex-1 truncate">{r.fundo}</span>
              <span className="font-mono text-[var(--tx3)]">{r.mesRef}</span>
              <span className="font-mono w-[120px] text-right">{fmtFull(r.val)}</span>
              <span className={`text-[10.5px] font-semibold w-[70px] text-right ${r.status === 'PAGO' ? 'text-id-dark dark:text-id-light' : 'text-amber-600 dark:text-amber-400'}`}>{r.status}</span>
            </div>
          ))}
          {tab === 'removed' && diff.removed.slice(0, 200).map((r) => (
            <div key={r.id} className="py-1.5 border-b border-[var(--bdr)]/60 last:border-0 flex items-center gap-2 text-[12px] text-red-500/90">
              <span className="flex-1 truncate">{r.fundo}</span>
              <span className="font-mono">{r.mesRef}</span>
              <span className="font-mono w-[120px] text-right">{fmtFull(r.val)}</span>
            </div>
          ))}
          {((tab === 'updated' && !diff.updated.length) || (tab === 'added' && !diff.added.length) || (tab === 'removed' && !diff.removed.length)) && (
            <div className="py-8 text-center text-[12px] text-[var(--tx3)]">Nada aqui.</div>
          )}
        </div>

        <div className="px-5 py-3.5 border-t border-[var(--bdr)] flex items-center gap-2">
          <span className="text-[11.5px] text-[var(--tx3)] mr-auto">{nothing ? 'A planilha não traz nenhuma mudança.' : 'A alteração aparece na hora para toda a equipe.'}</span>
          <button onClick={onCancel} className="btn">Cancelar</button>
          <button onClick={onConfirm} disabled={nothing} className="btn btn-primary"><CheckCircle2 size={14} /> Aplicar planilha</button>
        </div>
      </div>
    </Overlay>
  )
}
