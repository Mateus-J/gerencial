import { useEffect, useMemo, useRef, useState } from 'react'
import { doc, onSnapshot, runTransaction } from 'firebase/firestore'
import * as XLSX from 'xlsx'
import {
  Upload, Download, Trash2, Plus, X, Link2, ExternalLink, Settings2, CheckCircle2, Clock, AlertCircle, Search,
  FileSpreadsheet, TrendingUp, TrendingDown, Building2, Users, Wallet,
} from 'lucide-react'
import { db } from '../lib/firebase'
import { PageHeader, Card } from '../components/PageShell'
import { useToast } from '../components/Toast'
import { useOptionalAuth } from '../context/AuthContext'
import { useChartTheme, STATUS_COLORS } from '../components/charts/theme'
import { StackedTimeChart, DonutChart, Sparkline } from '../components/charts/Charts'
import AnimatedNumber from '../components/AnimatedNumber'
import BaseTable from '../components/taxa/BaseTable'
import SlackNotify from '../components/taxa/SlackNotify'
import ShareLinks from '../components/taxa/ShareLinks'
import { StatCard, MiniStat, RankCard, Overlay } from '../components/taxa/Cards'
import { SHARE_REF, consultaUrl } from '../lib/share'
import {
  ensureIds, cleanRow, recalc, parseWorkbook, mergeImport, newId, parseNum, onlyDigits, norm, sortKey,
  fmtShort, fmtFull, brDate, todayISO, rowsToSheetData, TEMPLATE_HEADERS, TAXAS, TAXA_KEYS, sumTaxas,
  SHARD_PREFIX, shardOf, partition, isOverdue,
} from '../lib/taxaAdm'

const DOC_REF = () => doc(db, 'controle', 'taxa_adm')
const SHARD_REF = (id) => doc(db, 'controle', SHARD_PREFIX + id)
const FIP_DOC_REF = () => doc(db, 'controle', 'fip_taxas')
const FIP_CADASTRO_REF = () => doc(db, 'controle', 'fip_cadastro')
const FIELD_LABEL = {
  fundo: 'Fundo', gestor: 'Gestor', classif: 'Classificação', cnpj: 'CNPJ', conta: 'Conta', mesRef: 'Mês',
  status: 'Status', val: 'Valor total', vencimento: 'Vencimento', dataPagamento: 'Pagamento', obs: 'Observação',
  ajuste: 'Ajuste', dataReceita: 'Data da receita', saldo: 'Saldo',
  ...Object.fromEntries(TAXAS.map((t) => [t.key, t.label])),
}
const MONEY_FIELDS = ['val', 'saldo', ...TAXA_KEYS]
const DATE_FIELDS = ['vencimento', 'dataPagamento', 'dataReceita']

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

// readOnly = página pública de consulta (link para a diretoria): mesmos
// números e gráficos ao vivo, sem editar, importar nem notificar.
// search/onSearch: busca da barra do topo (a mesma do campo da tela)
export default function TaxaAdministracao({ readOnly = false, search, onSearch }) {
  const toast = useToast()
  const currentUser = useOptionalAuth()?.currentUser
  const who = currentUser?.name || currentUser?.username || ''
  const chart = useChartTheme()
  const TX = TAXAS.map((t, i) => ({ ...t, color: chart.series[i] }))

  const [meta, setMeta] = useState(null) // controle/taxa_adm (lista de meses, quem alterou…)
  const [shardRows, setShardRows] = useState({}) // { 'AAAA_MM': [lançamentos] }
  const [loadedShards, setLoadedShards] = useState(() => new Set())
  const [metaLoaded, setMetaLoaded] = useState(false)
  const shardUnsubs = useRef({})
  const [live, setLive] = useState('connecting') // connecting | ok | offline
  const [saving, setSaving] = useState(0)
  const [fipParsed, setFipParsed] = useState([])
  const [fipCadastro, setFipCadastro] = useState({})

  const [selMes, setSelMes] = useState('') // '' = período completo
  const [fGestor, setFGestor] = useState('')
  const [fClassif, setFClassif] = useState('')
  const [fStatus, setFStatus] = useState('')
  const [qLocal, setQLocal] = useState('')
  const q = onSearch ? search || '' : qLocal
  const setQ = onSearch || setQLocal
  const [dragging, setDragging] = useState(false)
  const [sharing, setSharing] = useState(false)
  // Link de consulta mais recente ainda ativo — o botão abre ele numa nova guia
  const [shareToken, setShareToken] = useState(null)
  useEffect(() => {
    if (readOnly) return undefined
    return onSnapshot(SHARE_REF(), (snap) => {
      const links = snap.exists() ? snap.data().links || {} : {}
      const last = Object.entries(links).filter(([, l]) => l.active).sort((a, b) => b[1].createdAt - a[1].createdAt)[0]
      setShareToken(last ? last[0] : null)
    }, () => setShareToken(null))
  }, [readOnly])
  const [editing, setEditing] = useState(null) // linha em edição, ou {} pra novo lançamento
  const [preview, setPreview] = useState(null) // { rows, skipped, fileName }
  const [view, setView] = useState('geral') // geral | taxas | slack
  const [fTaxa, setFTaxa] = useState('')
  const fileRef = useRef(null)
  const [, tick] = useState(0)

  // Tudo em tempo real: qualquer pessoa que marcar um pagamento, mudar um
  // valor ou importar a planilha atualiza a tela de todos na hora. O índice
  // diz quais meses existem; cada mês tem o próprio documento/listener.
  useEffect(() => {
    const unsub = onSnapshot(DOC_REF(), { includeMetadataChanges: true }, (snap) => {
      setLive(snap.metadata.fromCache ? 'offline' : 'ok')
      setMeta(snap.exists() ? snap.data() : null)
      setMetaLoaded(true)
    }, (e) => { console.warn('taLoad err', e); setLive('offline'); setMetaLoaded(true) })
    // FIPs administrados pela própria ID CTVM entram aqui (somente leitura —
    // a edição acontece na Área FIP).
    const unsubFip = onSnapshot(FIP_DOC_REF(), (snap) => setFipParsed(snap.exists() ? snap.data().parsed || [] : []), (e) => console.warn('taFipLoad err', e))
    const unsubCad = onSnapshot(FIP_CADASTRO_REF(), (snap) => setFipCadastro(snap.exists() ? snap.data().map || {} : {}), (e) => console.warn('taFipCadastroLoad err', e))
    const t = setInterval(() => tick((x) => x + 1), 30000)
    const subs = shardUnsubs.current
    return () => { unsub(); unsubFip(); unsubCad(); clearInterval(t); Object.values(subs).forEach((u) => u()) }
  }, [])

  const shardIds = useMemo(() => meta?.shards || [], [meta])
  useEffect(() => {
    const subs = shardUnsubs.current
    shardIds.forEach((id) => {
      if (subs[id]) return
      subs[id] = onSnapshot(SHARD_REF(id), (snap) => {
        setShardRows((prev) => ({ ...prev, [id]: snap.exists() ? snap.data().rows || [] : [] }))
        setLoadedShards((prev) => (prev.has(id) ? prev : new Set(prev).add(id)))
      }, (e) => { console.warn('taShardLoad err', id, e); setLoadedShards((prev) => new Set(prev).add(id)) })
    })
    Object.keys(subs).forEach((id) => {
      if (shardIds.includes(id)) return
      subs[id](); delete subs[id]
      setShardRows((prev) => { const n = { ...prev }; delete n[id]; return n })
    })
  }, [shardIds])

  // Só a primeira carga mostra o esqueleto; meses novos chegando depois (ex.:
  // após importar) entram sem piscar a tela.
  const [ready, setReady] = useState(false)
  const allLoaded = metaLoaded && shardIds.every((id) => loadedShards.has(id))
  useEffect(() => { if (allLoaded) setReady(true) }, [allLoaded])
  const loading = !ready
  const legacyRows = Array.isArray(meta?.parsed) ? meta.parsed : null
  const rows = useMemo(() => {
    const fromShards = Object.keys(shardRows).sort().flatMap((id) => shardRows[id])
    return legacyRows ? [...ensureIds(legacyRows), ...fromShards] : fromShards
  }, [shardRows, legacyRows])

  const fipAdmRows = useMemo(() => fipParsed
    .filter((r) => norm(fipCadastro[onlyDigits(r.cnpj)]?.administrador).includes('ID CTVM'))
    .map((r) => ({
      id: 'fip-' + onlyDigits(r.cnpj) + '-' + r.mesRef, fundo: r.fundo, gestor: r.gestor, classif: r.classificacao,
      cnpj: r.cnpj, conta: r.conta, mesRef: r.mesRef, status: r.status, val: Number(r.valorAdm) || 0, adm: Number(r.valorAdm) || 0, _fromFip: true,
    })), [fipParsed, fipCadastro])

  const combined = useMemo(() => recalc([...rows, ...fipAdmRows]), [rows, fipAdmRows])

  // Toda gravação passa por aqui: aplica na tela na hora (otimista) e grava
  // numa transação em cima da versão MAIS RECENTE do servidor — assim duas
  // pessoas editando ao mesmo tempo não apagam a alteração uma da outra.
  // `scope` = meses envolvidos (só esses documentos são lidos/gravados);
  // sem scope, a base inteira. `fn` precisa ser pura (a transação pode repetir).
  async function mutate(fn, { msg, extra, action, scope } = {}) {
    setShardRows(partition(fn(rows)))
    if (legacyRows) setMeta((m) => ({ ...(m || {}), parsed: undefined }))
    setSaving((s) => s + 1)
    try {
      await runTransaction(db, async (tx) => {
        const idxSnap = await tx.get(DOC_REF())
        const idx = idxSnap.exists() ? idxSnap.data() : {}
        const legacy = Array.isArray(idx.parsed) ? ensureIds(idx.parsed) : null
        const known = new Set(idx.shards || [])
        const before = {}
        const readShards = async (ids) => {
          const todo = ids.filter((id) => known.has(id) && !(id in before))
          const snaps = await Promise.all(todo.map((id) => tx.get(SHARD_REF(id))))
          snaps.forEach((sn, i) => { before[todo[i]] = sn.exists() ? sn.data().rows || [] : [] })
        }
        await readShards(legacy || !scope ? [...known] : [...new Set(scope)])
        let parts
        // Se a alteração jogou um lançamento pra um mês que ainda não foi lido,
        // lê esse mês também e refaz — nunca grava um mês sem conhecer o conteúdo.
        for (let round = 0; round < 3; round++) {
          const cur = [...(legacy || []), ...Object.values(before).flat()]
          parts = partition(fn(cur).map(cleanRow))
          const missing = Object.keys(parts).filter((id) => known.has(id) && !(id in before))
          if (!missing.length) break
          await readShards(missing)
        }
        const shards = new Set(known)
        new Set([...Object.keys(before), ...Object.keys(parts)]).forEach((id) => {
          const nextRows = parts[id] || []
          if (!legacy && JSON.stringify(nextRows) === JSON.stringify(before[id] || [])) return
          if (nextRows.length) { tx.set(SHARD_REF(id), { mes: id, rows: nextRows }); shards.add(id) }
          else { if (known.has(id)) tx.delete(SHARD_REF(id)); shards.delete(id) }
        })
        tx.set(DOC_REF(), {
          schema: 2,
          shards: [...shards].sort(),
          importedAt: idx.importedAt ?? null,
          importedBy: idx.importedBy ?? null,
          importFile: idx.importFile ?? null,
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

  const scopeOf = (list, ...mesRefs) => [...new Set([...list.map((r) => shardOf(r.mesRef)), ...mesRefs.filter(Boolean).map(shardOf)])]

  const stamp = () => ({ updatedAt: Date.now(), updatedBy: who })

  function updateRow(id, patch, msg) {
    const st = stamp()
    const row = rows.find((r) => r.id === id)
    if (!row) return
    mutate((list) => list.map((r) => (r.id === id ? { ...r, ...patch, ...st } : r)), { msg, scope: scopeOf([row], patch.mesRef) })
  }
  // Editar uma taxa: se o total batia com a soma das taxas, o total acompanha.
  function updateTaxa(row, key, value) {
    const next = { ...row, [key]: value }
    const patch = { [key]: value }
    if (Math.abs(sumTaxas(row) - (Number(row.val) || 0)) < 0.01) patch.val = sumTaxas(next)
    updateRow(row.id, patch)
  }
  function setStatus(ids, status) {
    const set = new Set(ids)
    const st = stamp()
    const today = todayISO()
    mutate((list) => list.map((r) => (set.has(r.id)
      ? { ...r, status, dataPagamento: status === 'PAGO' ? r.dataPagamento || today : '', ...st }
      : r)), { msg: ids.length > 1 ? `${ids.length} lançamentos marcados como ${status.toLowerCase()}.` : undefined, scope: scopeOf(rows.filter((r) => set.has(r.id))) })
  }
  function addRow(row) {
    const full = { ...row, id: newId(), ...stamp() }
    mutate((list) => [full, ...list], { msg: 'Lançamento incluído.', scope: scopeOf([], full.mesRef) })
  }
  function deleteRows(ids) {
    const set = new Set(ids)
    const removed = rows.filter((r) => set.has(r.id))
    if (!removed.length) return
    setSelected(new Set())
    const scope = scopeOf(removed)
    mutate((list) => list.filter((r) => !set.has(r.id)), {
      msg: `${removed.length} lançamento(s) excluído(s).`,
      scope,
      action: {
        label: 'Desfazer',
        onClick: () => mutate((list) => [...removed.filter((r) => !list.some((x) => x.id === r.id)), ...list], { msg: 'Exclusão desfeita.', scope }),
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
      msg: `Planilha aplicada: ${r.added.length} novo(s), ${r.updated.length} atualizado(s), ${r.unchanged} sem mudança${replace ? `, ${r.removed.length} removido(s)` : ''}.`,
    })
  }

  const gestores = useMemo(() => [...new Set(combined.parsed.map((r) => r.gestor).filter((g) => g && g !== '0'))].sort(), [combined])
  const classes = useMemo(() => [...new Set(combined.parsed.map((r) => r.classif).filter((c) => c && c !== '0'))].sort(), [combined])

  // `filtered` = tudo que passa nos filtros; `filteredAllMes` ignora só o mês
  // (alimenta os gráficos de evolução).
  const { filtered, filteredAllMes } = useMemo(() => {
    const qq = norm(q)
    const qd = /^[\d./\-\s]+$/.test(q) ? onlyDigits(q) : '' // só quando parece CNPJ
    const all = combined.parsed.filter((r) => {
      if (fGestor && r.gestor !== fGestor) return false
      if (fClassif && r.classif !== fClassif) return false
      if (fStatus === 'VENCIDO' ? !isOverdue(r) : fStatus && r.status !== fStatus) return false
      if (fTaxa && !(Number(r[fTaxa]) > 0)) return false
      if (qq && !norm(r.fundo).includes(qq) && !(qd && onlyDigits(r.cnpj).includes(qd)) && !norm(r.gestor).includes(qq) && !norm(r.ajuste).includes(qq)) return false
      return true
    })
    return { filteredAllMes: all, filtered: selMes ? all.filter((r) => r.mesRef === selMes) : all }
  }, [combined, selMes, fGestor, fClassif, fStatus, fTaxa, q])

  const previewDiff = useMemo(() => (preview ? mergeImport(rows, preview.rows, { replace: preview.replace, who }) : null), [preview, rows, who])
  // Exporta no mesmo layout da planilha de controle, do mais recente para o
  // mais antigo. Sem lista = base completa.
  function exportXlsx(list, name = 'base_taxas') {
    list = list || [...combined.parsed].sort((a, b) => sortKey(b.mesRef) - sortKey(a.mesRef) || String(b.dataReceita || '').localeCompare(String(a.dataReceita || '')))
    if (!list.length) { toast.error('Nenhum dado para exportar.'); return }
    const ws = XLSX.utils.json_to_sheet(rowsToSheetData(list), { header: TEMPLATE_HEADERS })
    ws['!cols'] = TEMPLATE_HEADERS.map((h) => ({ wch: h === 'Fundo' ? 48 : h === 'Observação' ? 36 : 16 }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Taxa ADM')
    XLSX.writeFile(wb, `${name}_${todayISO()}.xlsx`)
  }
  function downloadTemplate() {
    const ws = XLSX.utils.json_to_sheet(rowsToSheetData([{ fundo: 'FUNDO EXEMPLO FIDC', gestor: 'Gestora X', classif: 'FIDC', cnpj: '00.000.000/0001-00', conta: '12345', mesRef: currentMes(), status: 'PENDENTE', val: 1500, adm: 1000, custodia: 500 }]), { header: TEMPLATE_HEADERS })
    ws['!cols'] = TEMPLATE_HEADERS.map(() => ({ wch: 20 }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Modelo')
    XLSX.writeFile(wb, 'modelo_taxa_adm.xlsx')
  }

  const headerActions = readOnly ? (
    <button onClick={() => exportXlsx(null, 'base_taxas_completa')} className="btn"><Download size={14} /> Exportar base</button>
  ) : (
    <>
      <div className="inline-flex">
        {shareToken
          ? <a href={consultaUrl(shareToken)} target="_blank" rel="noreferrer" className="btn rounded-r-none" title="Abrir a tela de consulta (só leitura) numa nova guia"><ExternalLink size={14} /> Link de consulta</a>
          : <button onClick={() => setSharing(true)} className="btn rounded-r-none" title="Criar um link só de leitura desta tela"><Link2 size={14} /> Link de consulta</button>}
        <button onClick={() => setSharing(true)} className="btn rounded-l-none border-l-0 px-2.5" title="Gerenciar links (criar, copiar, revogar)" aria-label="Gerenciar links de consulta"><Settings2 size={14} /></button>
      </div>
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => handleFile(e.target.files[0])} />
      <button onClick={() => fileRef.current?.click()} className="btn" title="Escolha a planilha de controle (.xlsx) — ou arraste o arquivo para a página"><Upload size={14} /> Atualizar base (planilha)</button>
      <button onClick={() => exportXlsx(null, 'base_taxas_completa')} className="btn"><Download size={14} /> Exportar base</button>
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
      {meta?.updatedAt && <span>Última alteração {meta.updatedBy ? `por ${meta.updatedBy} ` : ''}{timeAgo(meta.updatedAt)}</span>}
      {meta?.importedAt && <span>· Planilha importada em {meta.importedAt}{meta.importedBy ? ` por ${meta.importedBy}` : ''}</span>}
    </div>
  )

  const overlays = readOnly ? null : (
    <>
      {sharing && <ShareLinks who={who} toast={toast} onClose={() => setSharing(false)} />}
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
          diff={previewDiff}
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
        <PageHeader eyebrow={readOnly ? "Consulta · somente leitura" : "Operacional"} title="Taxa de Administração" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => <Card key={i} className="h-[110px] animate-pulse" />)}
        </div>
      </div>
    )
  }

  if (!rows.length && !fipAdmRows.length) {
    return (
      <div>
        <PageHeader eyebrow={readOnly ? "Consulta · somente leitura" : "Operacional"} title="Taxa de Administração" meta={liveMeta} actions={headerActions} />
        <Card className="p-12 flex flex-col items-center text-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-id-mid/15 text-id-dark dark:text-id-light flex items-center justify-center"><FileSpreadsheet size={22} /></div>
          <div className="font-display font-semibold text-[15px]">Nenhum lançamento ainda</div>
          <p className="text-[12.5px] text-[var(--tx3)] max-w-[420px]">Importe a planilha de cobranças (.xlsx) ou inclua lançamentos manualmente. Tudo o que for alterado aparece na hora para toda a equipe.</p>
          {!readOnly && <div className="flex gap-2 mt-1">
            <button onClick={() => fileRef.current?.click()} className="btn btn-primary"><Upload size={14} /> Importar planilha</button>
            <button onClick={downloadTemplate} className="btn"><Download size={14} /> Baixar modelo</button>
          </div>}
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
  // Rosca: até 5 classificações com cor própria, o resto vira "Outros" (cinza)
  const clsDist = clsAll.length > 6 ? [...clsAll.slice(0, 5), { name: 'Outros', value: clsAll.slice(5).reduce((a, c) => a + c.value, 0) }] : clsAll
  // Fluxo mensal respeitando os filtros (exceto o mês, que vira o destaque)
  const flowMonthly = (() => {
    const m = {}
    filteredAllMes.forEach((r) => {
      const e = (m[r.mesRef] ||= { mes: r.mesRef, pago: 0, pend: 0 })
      if (r.status === 'PAGO') e.pago += r.val; else e.pend += r.val
    })
    return Object.values(m).sort((a, b) => sortKey(a.mes) - sortKey(b.mes))
  })()
  const spark = flowMonthly.slice(-12).map((m) => ({ mes: m.mes, v: m.pago + m.pend }))

  // ---- base segregada por taxa ----
  const taxTotals = TX.map((t) => ({ ...t, value: filtered.reduce((a, r) => a + (Number(r[t.key]) || 0), 0) }))
  const taxSum = taxTotals.reduce((a, t) => a + t.value, 0)
  const taxMonthly = (() => {
    const m = {}
    filteredAllMes.forEach((r) => {
      const e = (m[r.mesRef] ||= { mes: r.mesRef })
      TAXA_KEYS.forEach((k) => { e[k] = (e[k] || 0) + (Number(r[k]) || 0) })
    })
    return Object.values(m).sort((a, b) => sortKey(a.mes) - sortKey(b.mes))
  })()

  const money = (v) => fmtFull(v)
  const activeChips = [
    selMes && [`Mês ${selMes}`, () => setSelMes('')],
    fGestor && [`Gestor: ${fGestor}`, () => setFGestor('')],
    fClassif && [`Classificação: ${fClassif}`, () => setFClassif('')],
    fStatus && [`Status: ${fStatus.toLowerCase()}`, () => setFStatus('')],
    fTaxa && [`Com ${TAXAS.find((t) => t.key === fTaxa)?.label}`, () => setFTaxa('')],
    q && [`Busca: “${q}”`, () => setQ('')],
  ].filter(Boolean)
  const clearAll = () => { setSelMes(''); setFGestor(''); setFClassif(''); setFStatus(''); setFTaxa(''); setQ('') }

  const dropProps = readOnly ? {} : {
    onDragOver: (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); setDragging(true) } },
    onDragLeave: (e) => { if (e.currentTarget === e.target) setDragging(false) },
    onDrop: (e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer?.files?.[0]; if (f) handleFile(f) },
  }

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
      <PageHeader eyebrow={readOnly ? "Consulta · somente leitura" : "Operacional"} title="Taxa de Administração" meta={liveMeta} actions={headerActions} />

      <div className="inline-flex p-1 mb-3 rounded-xl glass">
        {[['geral', 'Visão geral'], ['taxas', 'Base segregada por taxa'], ...(readOnly ? [] : [['slack', 'Notificações Slack']])].map(([k, l]) => (
          <button key={k} onClick={() => setView(k)} className={`px-3.5 py-1.5 rounded-lg text-[12px] font-medium transition-all ${view === k ? 'bg-gradient-to-r from-id-light/25 to-id-mid/10 text-[var(--tx)] shadow-[inset_0_0_0_1px_rgba(143,179,82,.35),0_0_16px_-4px_rgba(143,179,82,.5)]' : 'text-[var(--tx3)] hover:text-[var(--tx)]'}`}>{l}</button>
        ))}
      </div>

      {/* Filtros */}
      {view !== 'slack' && <Card className="p-3 mb-4">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1.5 -mb-1 scroll-thin">
          <button onClick={() => setSelMes('')} className={`chip shrink-0 ${!selMes ? 'chip-on' : ''}`}>Período completo</button>
          <span className="w-px h-5 bg-[var(--bdr)] mx-1 shrink-0" />
          {[...combined.months].reverse().map((m) => (
            <button key={m} onClick={() => setSelMes(selMes === m ? '' : m)} className={`chip shrink-0 font-mono ${selMes === m ? 'chip-on' : ''}`}>{m}</button>
          ))}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-[1fr_1fr_1fr_1fr_2fr] gap-2 mt-3">
          <select value={fGestor} onChange={(e) => setFGestor(e.target.value)} className="field">
            <option value="">Todos os gestores</option>{gestores.map((g) => <option key={g}>{g}</option>)}
          </select>
          <select value={fClassif} onChange={(e) => setFClassif(e.target.value)} className="field">
            <option value="">Todas as classificações</option>{classes.map((c) => <option key={c}>{c}</option>)}
          </select>
          <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className="field">
            <option value="">Todos os status</option><option value="PAGO">Pago</option><option value="PENDENTE">Pendente</option><option value="VENCIDO">Vencido</option>
          </select>
          <select value={fTaxa} onChange={(e) => setFTaxa(e.target.value)} className="field">
            <option value="">Todas as taxas</option>{TAXAS.map((t) => <option key={t.key} value={t.key}>Com {t.label}</option>)}
          </select>
          <div className="relative col-span-2 md:col-span-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--tx4)]" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar fundo, gestor ou CNPJ…" className="field pl-9" />
          </div>
        </div>
      </Card>}

      {view === 'taxas' && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-3">
            {taxTotals.map((t) => (
              <Card key={t.key} className="p-0">
                <button onClick={() => setFTaxa(fTaxa === t.key ? '' : t.key)} className={`w-full h-full text-left px-4 py-3.5 rounded-2xl transition-all hover:bg-[var(--sur2)]/40 ${fTaxa === t.key ? 'ring-1 ring-id-light/60 shadow-[0_0_24px_-6px_rgba(143,179,82,.6)]' : ''}`}>
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-[3px]" style={{ background: t.color, boxShadow: `0 0 10px ${t.color}` }} />
                    <span className="text-[10px] font-mono font-medium tracking-[.16em] uppercase text-[var(--tx3)]">{t.label}</span>
                  </div>
                  <div className="font-display text-[20px] font-semibold tracking-tight mt-2"><AnimatedNumber value={t.value} format={fmtShort} /></div>
                  <div className="text-[11px] text-[var(--tx3)]">{taxSum ? ((t.value / taxSum) * 100).toFixed(1).replace('.', ',') : '0'}% das taxas</div>
                  <div className="h-1 mt-2 rounded-full bg-[var(--sur2)] overflow-hidden"><div className="h-full rounded-full grow-x transition-[width] duration-700 ease-out" style={{ width: (taxSum ? (t.value / taxSum) * 100 : 0) + '%', background: t.color, boxShadow: `0 0 10px ${t.color}` }} /></div>
                </button>
              </Card>
            ))}
            <Card className="px-4 py-3.5">
              <div className="text-[10px] font-mono font-medium tracking-[.16em] uppercase text-[var(--tx3)]">Soma das taxas</div>
              <div className="font-display text-[20px] font-semibold tracking-tight mt-2"><AnimatedNumber value={taxSum} format={fmtShort} /></div>
              <div className="text-[11px] text-[var(--tx3)]">Total cobrado {fmtShort(total)}</div>
            </Card>
          </div>
          <Card className="p-4 mb-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
              <div className="text-[13px] font-semibold font-display">Taxas por mês</div>
              <div className="text-[11px] text-[var(--tx3)]">Clique numa barra para filtrar o mês · arraste a barra de baixo para navegar</div>
            </div>
            <StackedTimeChart id="tx" kind="bar" data={taxMonthly} series={TX} format={money} height={300} selected={selMes} onSelect={(m) => setSelMes(selMes === m ? '' : m)} />
          </Card>
        </>
      )}

      {view === 'geral' && (<>
      {/* KPIs */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr_1fr] gap-3 mb-3">
        <Card className="p-5 relative overflow-hidden">
          <div className="absolute -right-10 -top-10 w-40 h-40 rounded-full bg-id-light/10 blur-2xl" />
          <div className="text-[10px] font-mono font-medium tracking-[.16em] uppercase text-[var(--tx3)]">Total cobrado · {selMes || 'período completo'}</div>
          <div className="font-display text-[30px] leading-tight font-semibold tracking-tight mt-1 whitespace-nowrap"><AnimatedNumber value={total} format={fmtFull} /></div>
          {spark.length > 2 && <div className="mt-1 -mx-1"><Sparkline id="sp-total" data={spark} height={40} /></div>}
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
              <div className="h-full bg-gradient-to-r from-id-mid to-id-light transition-all duration-700 sweep shadow-[0_0_12px_rgba(143,179,82,.8)]" style={{ width: pct + '%' }} />
            </div>
          </div>
        </Card>
        <StatCard icon={CheckCircle2} tone="green" label="Recebido" value={<AnimatedNumber value={pago} format={fmtFull} />} share={pct}
          details={[['Lançamentos pagos', (filtered.length - countPend).toLocaleString('pt-BR')], ['Média por lançamento', filtered.length - countPend ? fmtShort(pago / (filtered.length - countPend)) : '—']]} />
        <StatCard icon={Clock} tone={pend > 0 ? 'amber' : 'neutral'} label="Em aberto" value={<AnimatedNumber value={pend} format={fmtFull} />} share={total > 0 ? 100 - pct : 0}
          details={[['Lançamentos pendentes', countPend.toLocaleString('pt-BR')], ['Vencido', vencido > 0 ? fmtShort(vencido) : 'R$ 0', vencido > 0 ? 'text-red-500' : '']]}
          onClick={() => setFStatus(fStatus === 'PENDENTE' ? '' : 'PENDENTE')} hint="Clique para ver só os pendentes" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <MiniStat icon={Building2} label="Fundos" value={<AnimatedNumber value={fundosU} />} />
        <MiniStat icon={Users} label="Gestores" value={<AnimatedNumber value={gestU} />} />
        <MiniStat icon={Wallet} label="Ticket médio" value={fundosU ? <AnimatedNumber value={total / fundosU} format={fmtShort} /> : '—'} />
        <MiniStat icon={AlertCircle} label="Vencidos" value={<AnimatedNumber value={filtered.filter(isOverdue).length} />} tone={vencido > 0 ? 'red' : undefined} onClick={() => setFStatus(fStatus === 'VENCIDO' ? '' : 'VENCIDO')} />
      </div>

      {/* Gráficos */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 mb-4">
        <Card className="p-4 xl:col-span-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
            <div className="text-[13px] font-semibold font-display">Evolução mensal</div>
            <div className="text-[11px] text-[var(--tx3)]">Clique no gráfico para filtrar o mês · arraste a barra de baixo para navegar</div>
          </div>
          <StackedTimeChart
            id="flow"
            data={flowMonthly}
            series={[
              { key: 'pago', label: 'Recebido', color: STATUS_COLORS.good, icon: CheckCircle2 },
              { key: 'pend', label: 'Em aberto', color: STATUS_COLORS.warning, icon: Clock },
            ]}
            format={money}
            height={300}
            selected={selMes}
            onSelect={(m) => setSelMes(selMes === m ? '' : m)}
          />
        </Card>
        <Card className="p-4 flex flex-col">
          <div className="text-[13px] font-semibold font-display mb-1">Por classificação</div>
          <div className="flex-1 min-h-0"><DonutChart data={clsDist} colors={chart.series} format={fmtShort} onPick={(n) => n !== 'Outros' && setFClassif(fClassif === n ? '' : n)} /></div>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <RankCard title="Maiores valores em aberto" tone="amber" items={topDevedores} empty="Nenhum valor em aberto no período 🎉" onPick={(n) => setQ(n)} />
        <RankCard title="Maiores gestores (total cobrado)" tone="green" items={topGestores} empty="Sem gestores no período" onPick={(n) => setFGestor(n)} />
      </div>
      </>)}

      {view !== 'slack' && (<>
      {/* Filtros ativos — deixa claro quando a tabela não mostra a base inteira */}
      {activeChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-3 px-4 py-2.5 rounded-xl border border-amber-500/30 bg-amber-500/8 text-[12px] animate-fade-up">
          <AlertCircle size={14} className="text-amber-500" />
          <span className="text-[var(--tx2)]">Mostrando <b>{filtered.length.toLocaleString('pt-BR')}</b> de <b>{combined.parsed.length.toLocaleString('pt-BR')}</b> lançamentos. Filtros ativos:</span>
          {activeChips.map(([label, clear]) => (
            <button key={label} onClick={clear} className="inline-flex items-center gap-1 rounded-full border border-[var(--bdr)] bg-[var(--sur)] px-2 py-0.5 text-[11.5px] hover:border-red-400/50">{label} <X size={11} /></button>
          ))}
          <button onClick={clearAll} className="ml-auto text-[11.5px] font-semibold text-id-dark dark:text-id-light hover:underline">Limpar todos</button>
        </div>
      )}
      <BaseTable
        rows={filtered}
        totalBase={combined.parsed.length}
        onEdit={(r) => setEditing(r)}
        onNew={() => setEditing({})}
        onUpdate={(id, patch) => updateRow(id, patch)}
        onUpdateTaxa={updateTaxa}
        onSetStatus={setStatus}
        onDelete={deleteRows}
        onExport={(list, name) => exportXlsx(list, name)}
        readOnly={readOnly}
      />
      </>)}

      {view === 'slack' && !readOnly && <SlackNotify rows={rows} who={who} toast={toast} />}

      {overlays}
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
    dataReceita: row.dataReceita || '', ajuste: row.ajuste || '',
    ...Object.fromEntries(TAXA_KEYS.map((k) => [k, row[k] ? Number(row[k]).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''])),
  }))
  const somaTaxas = TAXA_KEYS.reduce((a, k) => a + parseNum(f[k]), 0)
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
    const val = Math.round((String(f.val).trim() ? parseNum(f.val) : somaTaxas) * 100) / 100
    if (!f.fundo.trim()) return setErr('Informe o fundo.')
    if (!/^\d{2}\.\d{4}$/.test(f.mesRef)) return setErr('Informe o mês de referência.')
    if (val < 0) return setErr('Valor inválido.')
    // Nunca duplicar: mesmo fundo + mês (+ mesmo ajuste) já existente bloqueia.
    const dup = allRows.find((r) => r.id !== row.id && norm(r.fundo) === norm(f.fundo) && r.mesRef === f.mesRef && norm(r.ajuste) === norm(f.ajuste))
    if (dup) return setErr(`Já existe um lançamento de ${dup.fundo} em ${f.mesRef}${f.ajuste ? ' (' + f.ajuste + ')' : ''}. Edite o existente ou informe um ajuste diferente.`)
    onSave({
      fundo: f.fundo.trim(), gestor: f.gestor.trim(), classif: f.classif.trim(), cnpj: f.cnpj.trim(), conta: f.conta.trim(),
      mesRef: f.mesRef, ajuste: f.ajuste.trim(), status: f.status, val, vencimento: f.vencimento, dataReceita: f.dataReceita,
      dataPagamento: f.status === 'PAGO' ? f.dataPagamento || todayISO() : '', obs: f.obs.trim(),
      ...Object.fromEntries(TAXA_KEYS.map((k) => [k, Math.round(parseNum(f[k]) * 100) / 100])),
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

          <div className="rounded-xl border border-[var(--bdr)] p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="label mb-0">Taxas segregadas (R$)</span>
              <button type="button" disabled={!somaTaxas} onClick={() => setF((x) => ({ ...x, val: somaTaxas.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }))} className="text-[11px] text-id-dark dark:text-id-light hover:underline disabled:opacity-40">Usar soma ({fmtFull(somaTaxas)}) como total</button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {TAXAS.map((t) => (
                <div key={t.key}>
                  <div className="text-[10.5px] text-[var(--tx3)] mb-1 flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{ background: t.color }} />{t.label}</div>
                  <input value={f[t.key]} onChange={set(t.key)} inputMode="decimal" placeholder="0,00" className="field font-mono text-right py-1.5" />
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Valor total (R$) *</label>
              <input value={f.val} onChange={set('val')} inputMode="decimal" placeholder="0,00" className="field font-mono text-right" />
            </div>
            <div>
              <label className="label">Mês de referência *</label>
              <input type="month" value={mesToInput(f.mesRef)} onChange={(e) => setF((x) => ({ ...x, mesRef: inputToMes(e.target.value) }))} className="field" />
            </div>
            <div>
              <label className="label">Data da receita</label>
              <input type="date" value={f.dataReceita} onChange={set('dataReceita')} className="field" />
            </div>
            <div>
              <label className="label">Ajuste / correção</label>
              <input value={f.ajuste} onChange={set('ajuste')} className="field" placeholder="Ex.: CORREÇÃO REGULAMENTO" />
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
  const fmtVal = (k, v) => (MONEY_FIELDS.includes(k) ? fmtFull(v) : DATE_FIELDS.includes(k) ? brDate(v) || '—' : v || '—')
  const tabs = [['updated', 'Atualizados', diff.updated.length], ['added', 'Novos', diff.added.length], ...(preview.replace ? [['removed', 'Removidos', diff.removed.length]] : [])]

  return (
    <Overlay onClose={onCancel}>
      <div className="relative w-full max-w-[760px] max-h-[88vh] bg-[var(--sur)] border border-[var(--bdr)] rounded-2xl shadow-[var(--shadow-pop)] flex flex-col animate-fade-up">
        <div className="px-5 py-4 border-b border-[var(--bdr)] flex items-center gap-3">
          <span className="w-9 h-9 rounded-xl bg-id-mid/15 text-id-dark dark:text-id-light flex items-center justify-center"><FileSpreadsheet size={18} /></span>
          <div className="min-w-0 flex-1">
            <div className="font-display font-semibold text-[15px]">Conferir importação</div>
            <div className="text-[11.5px] text-[var(--tx3)] truncate">{preview.fileName} · aba “{preview.sheet}” · {preview.rows.length.toLocaleString('pt-BR')} lançamento(s) lidos{preview.skipped ? ` · ${preview.skipped.toLocaleString('pt-BR')} linha(s) sem mês ou sem nenhum valor ignoradas` : ''}</div>
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
              <div className="text-[12px] font-medium truncate">{row.fundo} <span className="font-mono text-[var(--tx3)] font-normal">· {row.mesRef}{row.ajuste ? ' · ' + row.ajuste : ''}</span></div>
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
          <span className="text-[11.5px] text-[var(--tx3)] mr-auto">{nothing ? 'A planilha não traz nenhuma mudança — a base já está igual.' : 'Nada é duplicado: o que já existe e está igual fica como está, o que mudou é atualizado.'}</span>
          <button onClick={onCancel} className="btn">Cancelar</button>
          <button onClick={onConfirm} disabled={nothing} className="btn btn-primary"><CheckCircle2 size={14} /> Aplicar planilha</button>
        </div>
      </div>
    </Overlay>
  )
}
