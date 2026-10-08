// Taxa Anbima: títulos (boletos) da ANBIMA por fundo — mesmo raciocínio da
// Taxa de Administração: base ao vivo para toda a equipe, atualização pela
// planilha (sem duplicar: o nº do título é a chave), status Pago/Pendente,
// gráficos por bimestre, filtros, tabela com filtro por coluna e exportação.
import { useEffect, useMemo, useRef, useState } from 'react'
import { doc, onSnapshot, runTransaction } from 'firebase/firestore'
import * as XLSX from 'xlsx'
import { Upload, Download, Plus, X, CheckCircle2, Clock, AlertCircle, Search, FileSpreadsheet, Building2, Receipt, Wallet } from 'lucide-react'
import { db } from '../lib/firebase'
import { PageHeader, Card } from '../components/PageShell'
import { useToast } from '../components/Toast'
import { useOptionalAuth } from '../context/AuthContext'
import { STATUS_COLORS, useChartTheme } from '../components/charts/theme'
import { StackedTimeChart, DonutChart } from '../components/charts/Charts'
import AnimatedNumber from '../components/AnimatedNumber'
import BaseTable from '../components/taxa/BaseTable'
import { StatCard, MiniStat, RankCard, Overlay } from '../components/taxa/Cards'
import { norm, onlyDigits, fmtFull, fmtShort, todayISO, brDate } from '../lib/taxaCore'
import {
  SHARD_PREFIX, parseWorkbook, mergeImport, cleanRow, partition, refLabel, parseRef, isOverdue, EXPORT_HEADERS, toSheetRow,
} from '../lib/anbima'

const DOC_REF = () => doc(db, 'controle', 'taxa_anbima')
const SHARD_REF = (id) => doc(db, 'controle', SHARD_PREFIX + id)

const COLS = [
  { key: 'vencimento', label: 'Vencimento', type: 'date' },
  { key: 'ref', label: 'Referência', type: 'label', text: (r) => refLabel(r.ref), title: (r) => r.refRaw || '', desc: true },
  { key: 'fundo', label: 'Razão social', type: 'fundo' },
  { key: 'cnpj', label: 'CNPJ', type: 'text' },
  { key: 'titulo', label: 'Nº título', type: 'mono', sortValue: (r) => Number(r.titulo) || 0 },
  { key: 'val', label: 'Valor do título', type: 'total' },
  { key: 'status', label: 'Status', type: 'status' },
  { key: 'situacao', label: 'Status no sistema', type: 'text' },
  { key: 'dataPagamento', label: 'Data de pgto', type: 'date' },
]
const TIEBREAK = [['ref', false], ['vencimento', false], ['fundo', true], ['titulo', true]]
const DEFAULT_SORT = { key: 'ref', asc: false }

function timeAgo(ts) {
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 45) return 'agora há pouco'
  if (s < 3600) return `há ${Math.round(s / 60)} min`
  if (s < 86400) return `há ${Math.round(s / 3600)} h`
  return new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function TaxaAnbima({ search, onSearch }) {
  const toast = useToast()
  const currentUser = useOptionalAuth()?.currentUser
  const who = currentUser?.name || currentUser?.username || ''
  const chart = useChartTheme()

  const [meta, setMeta] = useState(null)
  const [shardRows, setShardRows] = useState({})
  const [loadedShards, setLoadedShards] = useState(() => new Set())
  const [metaLoaded, setMetaLoaded] = useState(false)
  const shardUnsubs = useRef({})
  const [live, setLive] = useState('connecting')
  const [saving, setSaving] = useState(0)

  const [selRef, setSelRef] = useState('') // '' = período completo
  const [fStatus, setFStatus] = useState('')
  const [fSit, setFSit] = useState('')
  const [qLocal, setQLocal] = useState('')
  const q = onSearch ? search || '' : qLocal
  const setQ = onSearch || setQLocal
  const [dragging, setDragging] = useState(false)
  const [editing, setEditing] = useState(null) // título em edição, ou {} pra novo
  const [preview, setPreview] = useState(null)
  const fileRef = useRef(null)
  const [, tick] = useState(0)

  // Tudo ao vivo: o índice diz quais anos existem; cada ano tem o próprio documento
  useEffect(() => {
    const unsub = onSnapshot(DOC_REF(), { includeMetadataChanges: true }, (snap) => {
      setLive(snap.metadata.fromCache ? 'offline' : 'ok')
      setMeta(snap.exists() ? snap.data() : null)
      setMetaLoaded(true)
    }, (e) => { console.warn('anbLoad err', e); setLive('offline'); setMetaLoaded(true) })
    const t = setInterval(() => tick((x) => x + 1), 30000)
    const subs = shardUnsubs.current
    return () => { unsub(); clearInterval(t); Object.values(subs).forEach((u) => u()) }
  }, [])

  const shardIds = useMemo(() => meta?.shards || [], [meta])
  useEffect(() => {
    const subs = shardUnsubs.current
    shardIds.forEach((id) => {
      if (subs[id]) return
      subs[id] = onSnapshot(SHARD_REF(id), (snap) => {
        setShardRows((prev) => ({ ...prev, [id]: snap.exists() ? snap.data().rows || [] : [] }))
        setLoadedShards((prev) => (prev.has(id) ? prev : new Set(prev).add(id)))
      }, (e) => { console.warn('anbShard err', id, e); setLoadedShards((prev) => new Set(prev).add(id)) })
    })
    Object.keys(subs).forEach((id) => {
      if (shardIds.includes(id)) return
      subs[id](); delete subs[id]
      setShardRows((prev) => { const n = { ...prev }; delete n[id]; return n })
    })
  }, [shardIds])

  const [ready, setReady] = useState(false)
  const allLoaded = metaLoaded && shardIds.every((id) => loadedShards.has(id))
  useEffect(() => { if (allLoaded) setReady(true) }, [allLoaded])

  const rows = useMemo(() => Object.keys(shardRows).sort().flatMap((id) => shardRows[id]), [shardRows])

  // Gravação: aplica na tela na hora e grava numa transação sobre a versão mais
  // recente do servidor (duas pessoas editando ao mesmo tempo não se apagam).
  async function mutate(fn, { msg, extra, action } = {}) {
    setShardRows(partition(fn(rows)))
    setSaving((s) => s + 1)
    try {
      await runTransaction(db, async (tx) => {
        const idxSnap = await tx.get(DOC_REF())
        const idx = idxSnap.exists() ? idxSnap.data() : {}
        const known = new Set(idx.shards || [])
        const ids = [...known]
        const snaps = await Promise.all(ids.map((id) => tx.get(SHARD_REF(id))))
        const before = {}
        snaps.forEach((sn, i) => { before[ids[i]] = sn.exists() ? sn.data().rows || [] : [] })
        const parts = partition(fn(Object.values(before).flat()).map(cleanRow))
        const shards = new Set(known)
        new Set([...Object.keys(before), ...Object.keys(parts)]).forEach((id) => {
          const next = parts[id] || []
          if (JSON.stringify(next) === JSON.stringify(before[id] || [])) return
          if (next.length) { tx.set(SHARD_REF(id), { ano: id, rows: next }); shards.add(id) }
          else { if (known.has(id)) tx.delete(SHARD_REF(id)); shards.delete(id) }
        })
        tx.set(DOC_REF(), {
          shards: [...shards].sort(),
          importedAt: idx.importedAt ?? null, importedBy: idx.importedBy ?? null, importFile: idx.importFile ?? null,
          ...(extra || {}),
          updatedAt: Date.now(), updatedBy: who,
        })
      })
      if (msg) toast.success(msg, action)
    } catch (e) {
      console.warn('anbSave err', e)
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
    mutate((list) => list.map((r) => (set.has(r.id) ? { ...r, status, dataPagamento: status === 'PAGO' ? r.dataPagamento || today : '', ...st } : r)),
      { msg: ids.length > 1 ? `${ids.length} títulos marcados como ${status === 'PAGO' ? 'pago' : 'pendente'}.` : undefined })
  }
  function deleteRows(ids) {
    const set = new Set(ids)
    const removed = rows.filter((r) => set.has(r.id))
    if (!removed.length) return
    mutate((list) => list.filter((r) => !set.has(r.id)), {
      msg: `${removed.length} título(s) excluído(s).`,
      action: { label: 'Desfazer', onClick: () => mutate((list) => [...removed.filter((r) => !list.some((x) => x.id === r.id)), ...list], { msg: 'Exclusão desfeita.' }) },
    })
  }
  function saveRow(row) {
    const isNew = !row.id
    const full = { ...row, id: row.id || 'anb-' + row.titulo, ...stamp() }
    if (isNew && rows.some((r) => r.titulo === full.titulo)) { toast.error(`O título ${full.titulo} já existe na base.`); return false }
    mutate((list) => (isNew ? [full, ...list] : list.map((r) => (r.id === full.id ? full : r))), { msg: isNew ? 'Título incluído.' : 'Título atualizado.' })
    return true
  }

  function handleFile(file) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const res = parseWorkbook(e.target.result)
        if (!res.rows.length) { toast.error('Nenhum título encontrado. A planilha precisa da coluna "Nº Título".'); return }
        setPreview({ ...res, fileName: file.name, replace: false })
      } catch (err) { console.error(err); toast.error('Erro ao ler a planilha: ' + err.message) }
    }
    reader.readAsArrayBuffer(file)
    if (fileRef.current) fileRef.current.value = ''
  }
  const previewDiff = useMemo(() => (preview ? mergeImport(rows, preview.rows, { replace: preview.replace, who }) : null), [preview, rows, who])
  function confirmImport() {
    const { rows: incoming, replace, fileName } = preview
    const r = previewDiff
    setPreview(null)
    mutate((list) => mergeImport(list, incoming, { replace, who }).rows, {
      extra: { importedAt: new Date().toLocaleString('pt-BR'), importedBy: who, importFile: fileName },
      msg: `Planilha aplicada: ${r.added.length} novo(s), ${r.updated.length} atualizado(s), ${r.unchanged} sem mudança${replace ? `, ${r.removed.length} removido(s)` : ''}.`,
    })
  }

  function exportXlsx(list, name = 'base_anbima') {
    list = list || [...rows].sort((a, b) => String(b.ref).localeCompare(String(a.ref)) || String(b.vencimento).localeCompare(String(a.vencimento)) || a.fundo.localeCompare(b.fundo))
    if (!list.length) { toast.error('Nenhum dado para exportar.'); return }
    const ws = XLSX.utils.aoa_to_sheet([EXPORT_HEADERS, ...list.map(toSheetRow)])
    ws['!cols'] = EXPORT_HEADERS.map((h) => ({ wch: h === 'Razão Social' ? 60 : h === 'Referência' ? 30 : 18 }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Taxa Anbima')
    XLSX.writeFile(wb, `${name}_${todayISO()}.xlsx`)
  }

  // ---- filtros ----
  const refs = useMemo(() => [...new Set(rows.map((r) => r.ref).filter(Boolean))].sort().reverse(), [rows])
  const situacoes = useMemo(() => [...new Set(rows.map((r) => r.situacao).filter(Boolean))].sort(), [rows])
  const { filtered, filteredAllRef } = useMemo(() => {
    const qq = norm(q)
    const qd = /^[\d./\-\s]+$/.test(q) ? onlyDigits(q) : ''
    const all = rows.filter((r) => {
      if (fStatus === 'VENCIDO' ? !isOverdue(r) : fStatus && r.status !== fStatus) return false
      if (fSit && r.situacao !== fSit) return false
      if (qq && !norm(r.fundo).includes(qq) && !(qd && (onlyDigits(r.cnpj).includes(qd) || r.titulo.includes(qd)))) return false
      return true
    })
    return { filteredAllRef: all, filtered: selRef ? all.filter((r) => r.ref === selRef) : all }
  }, [rows, selRef, fStatus, fSit, q])

  const header = (
    <>
      <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => handleFile(e.target.files[0])} />
      <button onClick={() => fileRef.current?.click()} className="btn" title="Escolha a planilha de levantamento (.xlsx) — ou arraste o arquivo para a página"><Upload size={14} /> Atualizar base (planilha)</button>
      <button onClick={() => exportXlsx(null, 'base_anbima_completa')} className="btn"><Download size={14} /> Exportar base</button>
      <button onClick={() => setEditing({})} className="btn btn-primary"><Plus size={14} /> Novo título</button>
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
      {meta?.updatedAt && <span>Última alteração {meta.updatedBy ? `por ${meta.updatedBy} ` : ''}{timeAgo(meta.updatedAt)}</span>}
      {meta?.importedAt && <span>· Planilha importada em {meta.importedAt}{meta.importedBy ? ` por ${meta.importedBy}` : ''}</span>}
    </div>
  )
  const overlays = (
    <>
      {editing && <EditDrawer row={editing} refs={refs} onClose={() => setEditing(null)} onSave={(r) => { if (saveRow(r)) setEditing(null) }} onDelete={editing.id ? () => { deleteRows([editing.id]); setEditing(null) } : null} />}
      {preview && <ImportPreview preview={preview} diff={previewDiff} onToggleReplace={() => setPreview((p) => ({ ...p, replace: !p.replace }))} onCancel={() => setPreview(null)} onConfirm={confirmImport} />}
    </>
  )
  const dropProps = {
    onDragOver: (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); setDragging(true) } },
    onDragLeave: (e) => { if (e.currentTarget === e.target) setDragging(false) },
    onDrop: (e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer?.files?.[0]; if (f) handleFile(f) },
  }

  if (!ready) {
    return (
      <div>
        <PageHeader eyebrow="Operacional" title="Taxa Anbima" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-3">{[0, 1, 2].map((i) => <Card key={i} className="h-[150px] animate-pulse" />)}</div>
        <Card className="h-[320px] animate-pulse" />
      </div>
    )
  }
  if (!rows.length) {
    return (
      <div {...dropProps}>
        <PageHeader eyebrow="Operacional" title="Taxa Anbima" meta={liveMeta} actions={header} />
        <Card className="p-12 flex flex-col items-center text-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-id-mid/15 text-id-dark dark:text-id-light flex items-center justify-center"><FileSpreadsheet size={22} /></div>
          <div className="font-display font-semibold text-[15px]">Nenhum título ainda</div>
          <p className="text-[12.5px] text-[var(--tx3)] max-w-[440px]">Importe a planilha de levantamento da ANBIMA (.xlsx, abas "Pagos" e "Não Pagos") ou inclua títulos manualmente. Tudo o que for alterado aparece na hora para toda a equipe.</p>
          <button onClick={() => fileRef.current?.click()} className="btn btn-primary mt-1"><Upload size={14} /> Importar planilha</button>
        </Card>
        {overlays}
      </div>
    )
  }

  // ---- números do período filtrado ----
  const sum = (list) => list.reduce((a, r) => a + (Number(r.val) || 0), 0)
  const total = sum(filtered)
  const pagos = filtered.filter((r) => r.status === 'PAGO')
  const pends = filtered.filter((r) => r.status !== 'PAGO')
  const pago = sum(pagos), pend = total - pago
  const vencidos = filtered.filter(isOverdue)
  const vencido = sum(vencidos)
  const pct = total > 0 ? (pago / total) * 100 : 0
  const fundosU = new Set(filtered.map((r) => onlyDigits(r.cnpj) || r.fundo)).size
  const fundosPend = new Set(pends.map((r) => onlyDigits(r.cnpj) || r.fundo)).size

  // Agrupa por fundo (CNPJ), com o nome mais frequente
  const byFund = (list) => {
    const m = new Map()
    list.forEach((r) => {
      const k = onlyDigits(r.cnpj) || norm(r.fundo)
      const e = m.get(k) || { value: 0, names: {} }
      e.value += Number(r.val) || 0
      e.names[r.fundo] = (e.names[r.fundo] || 0) + 1
      m.set(k, e)
    })
    return [...m.values()].map((e) => ({ name: Object.entries(e.names).sort((a, b) => b[1] - a[1])[0][0], value: e.value })).sort((a, b) => b.value - a.value)
  }
  const topPend = byFund(pends).slice(0, 6)
  const topPago = byFund(pagos).slice(0, 6)
  const flow = (() => {
    const m = {}
    filteredAllRef.forEach((r) => {
      const e = (m[r.ref] ||= { key: r.ref, bim: refLabel(r.ref), pago: 0, pend: 0 })
      if (r.status === 'PAGO') e.pago += Number(r.val) || 0; else e.pend += Number(r.val) || 0
    })
    return Object.values(m).sort((a, b) => a.key.localeCompare(b.key))
  })()
  const sitDist = (() => {
    const m = {}
    filtered.forEach((r) => { const k = r.situacao || '—'; m[k] = (m[k] || 0) + (Number(r.val) || 0) })
    return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([name, value]) => ({ name, value }))
  })()

  const activeChips = [
    selRef && [`Referência ${refLabel(selRef)}`, () => setSelRef('')],
    fStatus && [`Status: ${{ PAGO: 'pago', PENDENTE: 'pendente', VENCIDO: 'vencido' }[fStatus]}`, () => setFStatus('')],
    fSit && [`No sistema: ${fSit}`, () => setFSit('')],
    q && [`Busca: “${q}”`, () => setQ('')],
  ].filter(Boolean)

  return (
    <div {...dropProps} className="relative">
      {dragging && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm pointer-events-none">
          <div className="glass rounded-3xl px-10 py-8 text-center border-2 border-dashed border-id-light/60 shadow-[0_0_60px_-10px_rgba(143,179,82,.7)]">
            <FileSpreadsheet size={32} className="mx-auto text-id-light mb-2" />
            <div className="font-display font-semibold text-[16px]">Solte a planilha para atualizar a base</div>
            <div className="text-[12px] text-[var(--tx3)] mt-1">Você confere o que muda antes de aplicar</div>
          </div>
        </div>
      )}
      <PageHeader eyebrow="Operacional" title="Taxa Anbima" meta={liveMeta} actions={header} />

      {/* Filtros */}
      <Card className="p-3 mb-4">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1.5 -mb-1 scroll-thin">
          <button onClick={() => setSelRef('')} className={`chip shrink-0 ${!selRef ? 'chip-on' : ''}`}>Período completo</button>
          <span className="w-px h-5 bg-[var(--bdr)] mx-1 shrink-0" />
          {refs.map((k) => (
            <button key={k} onClick={() => setSelRef(selRef === k ? '' : k)} className={`chip shrink-0 font-mono ${selRef === k ? 'chip-on' : ''}`}>{refLabel(k)}</button>
          ))}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-[1fr_1fr_2fr] gap-2 mt-3">
          <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className="field">
            <option value="">Todos os status</option><option value="PAGO">Pago</option><option value="PENDENTE">Pendente</option><option value="VENCIDO">Vencido</option>
          </select>
          <select value={fSit} onChange={(e) => setFSit(e.target.value)} className="field">
            <option value="">Todos no sistema</option>{situacoes.map((s) => <option key={s}>{s}</option>)}
          </select>
          <div className="relative col-span-2 md:col-span-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--tx4)]" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar fundo, CNPJ ou nº do título…" className="field pl-9" />
          </div>
        </div>
        {activeChips.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 mt-3 animate-fade-up">
            {activeChips.map(([label, clear]) => (
              <button key={label} onClick={clear} className="inline-flex items-center gap-1 text-[11px] rounded-full pl-2.5 pr-1.5 py-0.5 bg-id-mid/15 text-id-dark dark:text-id-light border border-id-mid/30 hover:bg-id-mid/25">{label} <X size={11} /></button>
            ))}
            <button onClick={() => { setSelRef(''); setFStatus(''); setFSit(''); setQ('') }} className="text-[11px] text-[var(--tx3)] hover:text-[var(--tx)] ml-1">Limpar tudo</button>
          </div>
        )}
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr_1fr] gap-3 mb-3">
        <Card className="p-5 relative overflow-hidden">
          <div className="absolute -right-10 -top-10 w-40 h-40 rounded-full bg-id-light/10 blur-2xl" />
          <div className="text-[10px] font-mono font-medium tracking-[.16em] uppercase text-[var(--tx3)]">Total cobrado · {selRef ? refLabel(selRef) : 'período completo'}</div>
          <div className="font-display text-[30px] leading-tight font-semibold tracking-tight mt-1 whitespace-nowrap"><AnimatedNumber value={total} format={fmtFull} /></div>
          <div className="text-[12px] text-[var(--tx3)] mt-1"><AnimatedNumber value={filtered.length} /> títulos · <AnimatedNumber value={fundosU} /> fundos</div>
          <div className="mt-4">
            <div className="flex justify-between text-[11px] text-[var(--tx3)] mb-1.5"><span>{pct.toFixed(1).replace('.', ',')}% pago</span></div>
            <div className="h-2 rounded-full bg-[var(--sur2)] overflow-hidden flex">
              <div className="h-full bg-gradient-to-r from-id-mid to-id-light transition-all duration-700 sweep shadow-[0_0_12px_rgba(143,179,82,.8)]" style={{ width: pct + '%' }} />
            </div>
          </div>
        </Card>
        <StatCard icon={CheckCircle2} tone="green" label="Pago" value={<AnimatedNumber value={pago} format={fmtFull} />} share={pct}
          details={[['Títulos pagos', pagos.length.toLocaleString('pt-BR')], ['Média por título', pagos.length ? fmtShort(pago / pagos.length) : '—']]}
          onClick={() => setFStatus(fStatus === 'PAGO' ? '' : 'PAGO')} hint="Clique para ver só os pagos" />
        <StatCard icon={Clock} tone={pend > 0 ? 'amber' : 'neutral'} label="Pendente" value={<AnimatedNumber value={pend} format={fmtFull} />} share={total > 0 ? 100 - pct : 0}
          details={[['Títulos pendentes', pends.length.toLocaleString('pt-BR')], ['Vencido', vencido > 0 ? fmtShort(vencido) : 'R$ 0', vencido > 0 ? 'text-red-500' : '']]}
          onClick={() => setFStatus(fStatus === 'PENDENTE' ? '' : 'PENDENTE')} hint="Clique para ver só os pendentes" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <MiniStat icon={Building2} label="Fundos" value={<AnimatedNumber value={fundosU} />} />
        <MiniStat icon={Receipt} label="Fundos com pendência" value={<AnimatedNumber value={fundosPend} />} tone={fundosPend ? 'amber' : undefined} onClick={() => setFStatus(fStatus === 'PENDENTE' ? '' : 'PENDENTE')} />
        <MiniStat icon={Wallet} label="Média por fundo" value={fundosU ? <AnimatedNumber value={total / fundosU} format={fmtShort} /> : '—'} />
        <MiniStat icon={AlertCircle} label="Títulos vencidos" value={<AnimatedNumber value={vencidos.length} />} tone={vencidos.length ? 'red' : undefined} onClick={() => setFStatus(fStatus === 'VENCIDO' ? '' : 'VENCIDO')} />
      </div>

      {/* Gráficos */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 mb-4">
        <Card className="p-4 xl:col-span-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
            <div className="text-[13px] font-semibold font-display">Por bimestre de referência</div>
            <div className="text-[11px] text-[var(--tx3)]">Clique numa barra para filtrar o bimestre · arraste a barra de baixo para navegar</div>
          </div>
          <StackedTimeChart id="anb" kind="bar" xKey="bim" data={flow} format={fmtFull} height={300} keep={12}
            series={[{ key: 'pago', label: 'Pago', color: STATUS_COLORS.good, icon: CheckCircle2 }, { key: 'pend', label: 'Pendente', color: STATUS_COLORS.warning, icon: Clock }]}
            selected={selRef ? refLabel(selRef) : ''} onSelect={(lbl) => { const k = flow.find((f) => f.bim === lbl)?.key; if (k) setSelRef(selRef === k ? '' : k) }} />
        </Card>
        <Card className="p-4 flex flex-col">
          <div className="text-[13px] font-semibold font-display mb-1">Status no sistema</div>
          <div className="flex-1 min-h-0"><DonutChart data={sitDist} colors={chart.series} format={fmtShort} onPick={(n) => n !== '—' && setFSit(fSit === n ? '' : n)} /></div>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <RankCard title="Maiores valores pendentes" tone="amber" items={topPend} empty="Nenhum título pendente no período 🎉" onPick={(n) => setQ(n)} />
        <RankCard title="Maiores valores pagos" tone="green" items={topPago} empty="Nenhum título pago no período" onPick={(n) => setQ(n)} />
      </div>

      <BaseTable
        rows={filtered}
        totalBase={rows.length}
        cols={COLS}
        title="Base de títulos"
        noun="título(s)"
        exportPrefix="anbima"
        defaultSort={DEFAULT_SORT}
        tiebreak={TIEBREAK}
        minWidth="min-w-[1300px]"
        newLabel="Novo título"
        onEdit={(r) => setEditing(r)}
        onNew={() => setEditing({})}
        onUpdate={(id, patch) => updateRow(id, patch)}
        onUpdateTaxa={() => {}}
        onSetStatus={setStatus}
        onDelete={deleteRows}
        onExport={exportXlsx}
      />
      {overlays}
    </div>
  )
}

function EditDrawer({ row, refs, onClose, onSave, onDelete }) {
  const isNew = !row.id
  const [f, setF] = useState(() => ({
    fundo: row.fundo || '', cnpj: row.cnpj || '', titulo: row.titulo || '', val: row.val ?? '', vencimento: row.vencimento || '',
    ref: row.ref || refs[0] || '', status: row.status || 'PENDENTE', situacao: row.situacao || '', dataPagamento: row.dataPagamento || '', obs: row.obs || '',
  }))
  const [err, setErr] = useState('')
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))
  function save() {
    const titulo = String(f.titulo).trim()
    if (!f.fundo.trim() || !titulo) { setErr('Preencha a razão social e o nº do título.'); return }
    const val = Number(String(f.val).replace(/\./g, '').replace(',', '.')) || 0
    onSave({
      ...row, ...f, titulo, val, fundo: f.fundo.trim(), cnpj: f.cnpj.trim(),
      ref: f.ref || parseRef('', f.vencimento),
      dataPagamento: f.status === 'PAGO' ? f.dataPagamento || todayISO() : '',
    })
  }
  return (
    <Overlay onClose={onClose} side>
      <div className="relative h-full w-full max-w-[460px] bg-[var(--sur)] border-l border-[var(--bdr)] shadow-[var(--shadow-pop)] flex flex-col animate-slide-in">
        <div className="px-5 py-4 border-b border-[var(--bdr)] flex items-center gap-3">
          <div className="flex-1">
            <div className="font-display font-semibold text-[15px]">{isNew ? 'Novo título' : `Título ${row.titulo}`}</div>
            {!isNew && row.updatedBy && <div className="text-[11px] text-[var(--tx3)]">Última alteração por {row.updatedBy}</div>}
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--tx3)] hover:bg-[var(--sur2)]"><X size={16} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          <div><div className="label">Razão social</div><input value={f.fundo} onChange={set('fundo')} className="field" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><div className="label">CNPJ</div><input value={f.cnpj} onChange={set('cnpj')} className="field font-mono" placeholder="00.000.000/0001-00" /></div>
            <div><div className="label">Nº título</div><input value={f.titulo} onChange={set('titulo')} disabled={!isNew} className="field font-mono disabled:opacity-60" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><div className="label">Valor (R$)</div><input value={f.val} onChange={set('val')} inputMode="decimal" className="field text-right font-mono" /></div>
            <div><div className="label">Vencimento</div><input type="date" value={f.vencimento} onChange={set('vencimento')} className="field" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><div className="label">Referência (bimestre)</div>
              <input type="month" value={f.ref} onChange={set('ref')} className="field" />
              <div className="text-[10.5px] text-[var(--tx3)] mt-1">{f.ref ? refLabel(f.ref) : 'mês inicial do bimestre'}</div>
            </div>
            <div><div className="label">Status</div>
              <div className="grid grid-cols-2 gap-1">
                {[['PAGO', 'Pago'], ['PENDENTE', 'Pendente']].map(([k, l]) => (
                  <button key={k} onClick={() => setF((s) => ({ ...s, status: k }))} className={`btn btn-sm justify-center ${f.status === k ? (k === 'PAGO' ? 'border-id-mid/60 text-id-dark dark:text-id-light bg-id-mid/10' : 'border-amber-500/60 text-amber-600 dark:text-amber-400 bg-amber-500/10') : ''}`}>{l}</button>
                ))}
              </div>
            </div>
          </div>
          {f.status === 'PAGO' && <div><div className="label">Data de pagamento</div><input type="date" value={f.dataPagamento} onChange={set('dataPagamento')} className="field" /></div>}
          <div><div className="label">Status no sistema</div><input value={f.situacao} onChange={set('situacao')} className="field" placeholder="Ex.: Comprovante disponível" /></div>
          <div><div className="label">Observação</div><textarea value={f.obs} onChange={set('obs')} rows={3} className="field resize-none" /></div>
          {err && <p className="text-[12px] text-red-500">{err}</p>}
        </div>
        <div className="px-5 py-3 border-t border-[var(--bdr)] flex items-center gap-2">
          {onDelete && <button onClick={() => { if (confirm(`Excluir o título ${row.titulo}?`)) onDelete() }} className="btn btn-sm btn-danger">Excluir</button>}
          <div className="flex-1" />
          <button onClick={onClose} className="btn btn-sm">Cancelar</button>
          <button onClick={save} className="btn btn-sm btn-primary">Salvar</button>
        </div>
      </div>
    </Overlay>
  )
}

const FIELD_LABEL = { fundo: 'Razão social', cnpj: 'CNPJ', val: 'Valor', vencimento: 'Vencimento', ref: 'Referência', refRaw: 'Referência (texto)', status: 'Status', situacao: 'Status no sistema' }
const showVal = (field, v) => (field === 'val' ? fmtFull(v) : field === 'vencimento' ? brDate(v) : field === 'ref' ? refLabel(v) : field === 'status' ? (v === 'PAGO' ? 'Pago' : 'Pendente') : String(v || '—'))

function ImportPreview({ preview, diff, onToggleReplace, onCancel, onConfirm }) {
  const [tab, setTab] = useState(diff.updated.length ? 'updated' : 'added')
  const pagos = preview.rows.filter((r) => r.status === 'PAGO')
  const list = tab === 'added' ? diff.added : tab === 'updated' ? diff.updated : diff.removed
  return (
    <Overlay onClose={onCancel}>
      <div className="relative w-full max-w-[760px] max-h-[88vh] bg-[var(--sur)] border border-[var(--bdr)] rounded-2xl shadow-[var(--shadow-pop)] flex flex-col animate-fade-up">
        <div className="px-5 py-4 border-b border-[var(--bdr)]">
          <div className="font-display font-semibold text-[15px]">Conferir a planilha antes de aplicar</div>
          <div className="text-[11.5px] text-[var(--tx3)] mt-0.5">
            {preview.fileName} · {preview.rows.length.toLocaleString('pt-BR')} títulos ({pagos.length} pagos, {preview.rows.length - pagos.length} pendentes) · {fmtFull(preview.rows.reduce((a, r) => a + r.val, 0))}
            {preview.skipped > 0 && <> · {preview.skipped} linha(s) de total/sem nº ignorada(s)</>}
          </div>
        </div>
        <div className="px-5 pt-3 flex flex-wrap gap-2">
          {[['added', 'Novos', diff.added.length], ['updated', 'Atualizados', diff.updated.length], ['removed', 'Removidos', diff.removed.length]].map(([k, l, n]) => (
            (k !== 'removed' || preview.replace) && <button key={k} onClick={() => setTab(k)} className={`chip ${tab === k ? 'chip-on' : ''}`}>{l} ({n})</button>
          ))}
          <span className="chip opacity-70">Sem mudança ({diff.unchanged})</span>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-1.5 min-h-[160px]">
          {!list.length && <div className="text-center text-[12.5px] text-[var(--tx3)] py-8">Nada aqui.</div>}
          {list.slice(0, 200).map((it) => {
            const r = it.row || it
            return (
              <div key={r.id} className="rounded-xl border border-[var(--bdr)] px-3 py-2 text-[12px]">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] text-[var(--tx3)]">{r.titulo}</span>
                  <span className="flex-1 truncate font-medium">{r.fundo}</span>
                  <span className="font-mono">{fmtFull(r.val)}</span>
                  <span className="font-mono text-[11px] text-[var(--tx3)]">{refLabel(r.ref)}</span>
                </div>
                {it.changes && <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[var(--tx3)]">
                  {it.changes.map((c) => <span key={c.field}>{FIELD_LABEL[c.field] || c.field}: <s>{showVal(c.field, c.from)}</s> → <b className="text-[var(--tx)]">{showVal(c.field, c.to)}</b></span>)}
                </div>}
              </div>
            )
          })}
          {list.length > 200 && <div className="text-center text-[11px] text-[var(--tx3)]">… e mais {list.length - 200}</div>}
        </div>
        <div className="px-5 py-3 border-t border-[var(--bdr)] flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-[12px] text-[var(--tx2)] mr-auto cursor-pointer">
            <input type="checkbox" checked={preview.replace} onChange={onToggleReplace} className="accent-[#6B9A52]" />
            Remover da base os títulos que não estão nesta planilha
          </label>
          <button onClick={onCancel} className="btn btn-sm">Cancelar</button>
          <button onClick={onConfirm} className="btn btn-sm btn-primary">Aplicar planilha</button>
        </div>
      </div>
    </Overlay>
  )
}
