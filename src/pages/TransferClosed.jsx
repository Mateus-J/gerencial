// Transfer / Closed: controle dos fundos que saem (transferência de
// administração), encerram ou são incorporados. Base ao vivo para toda a equipe
// (controle/transfer_closed). Todos veem; só edita quem tem permissão ou o código.
import { useEffect, useMemo, useRef, useState } from 'react'
import { doc, onSnapshot, runTransaction, setDoc } from 'firebase/firestore'
import * as XLSX from 'xlsx'
import {
  Plus, Upload, Download, X, Landmark, Wallet, CheckCircle2, Clock, Trash2, RefreshCw, Loader2, Lock, Unlock,
  KeyRound, FileText, Paperclip, Link2, ExternalLink, Ban, Users, LayoutDashboard, Table2, Archive, CheckSquare, Square, ChevronDown,
} from 'lucide-react'
import { db } from '../lib/firebase'
import { PageHeader, Card } from '../components/PageShell'
import { useToast } from '../components/Toast'
import { useOptionalAuth } from '../context/AuthContext'
import AnimatedNumber from '../components/AnimatedNumber'
import { StatCard, RankCard, Overlay } from '../components/taxa/Cards'
import { DonutChart } from '../components/charts/Charts'
import { useChartTheme } from '../components/charts/theme'
import { norm, onlyDigits, fmtFull, fmtShort, todayISO, brDate } from '../lib/taxaCore'
import {
  CONTA_NOME, ATIVIDADES, CATEGORIAS, CONTROLES, ITENS, ITEM_LABEL, resumoGeral, PEND, LIQ, EXC, CONC, parseValor, novoId, itensDe, resumo,
  novoProcesso, carregarBases, fundoPorCnpj, pendenciasDoSistema, enviarArquivo, baixarArquivo, apagarArquivo, MAX_ARQUIVO,
  ACESSO_REF, sha256, salvarCodigo, parsePlanilha, mergePlanilha, statusTxt, EXPORT_HEADERS, toSheetRow, folhaConclusao,
} from '../lib/transfer'

const DOC_REF = () => doc(db, 'controle', 'transfer_closed')
const USERS_REF = () => doc(db, 'controle', 'users')
const OWNER_EMAIL = 'mateus.jesus@idsf.com.br'
const UNLOCK_KEY = 'tc_desbloqueio'
const VIEW_KEY = 'tc_view'
const TH = 'px-3 py-2.5 font-medium whitespace-nowrap bg-[var(--sur-solid)] border-b border-[var(--bdr)]'
const TD = 'px-3 py-2 bg-[var(--sur-solid)] group-hover:bg-[var(--sur2)] border-b border-[var(--bdr)]/60'

// Célula de item na base: ✓ liquidado · valor pendente em amarelo · excluído riscado
function CelulaItem({ x, canEdit, onToggle }) {
  const v = parseValor(x?.valor)
  if (x?.status === EXC) return <span className="text-[10.5px] text-[var(--tx4)] line-through" title="Excluído">{v ? fmtShort(v) : 'excl.'}</span>
  const liq = x?.status === LIQ
  const Icon = liq ? CheckSquare : Square
  const Tag = canEdit ? 'button' : 'span'
  return (
    <Tag onClick={canEdit ? onToggle : undefined} title={liq ? 'Liquidado' + (x.data ? ' em ' + brDate(x.data) : '') : v ? 'Pendente' : 'Nada lançado'} className={`inline-flex flex-col items-center leading-tight ${canEdit ? 'cursor-pointer hover:scale-110 transition-transform' : ''}`}>
      <Icon size={15} className={liq ? 'text-id-dark dark:text-id-light' : 'text-[var(--tx4)]'} />
      {v ? <span className={`text-[10px] font-mono tabular-nums ${liq ? 'text-[var(--tx3)]' : 'text-amber-600 dark:text-amber-400'}`}>{fmtShort(v)}</span> : null}
    </Tag>
  )
}
const fmtInput = (v) => (v === '' || v == null ? '' : typeof v === 'number' ? (v ? v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '') : v)

function StatusPill({ v, onClick, disabled }) {
  const ok = v === CONC
  const Tag = onClick && !disabled ? 'button' : 'span'
  return (
    <Tag onClick={onClick} className={`inline-flex items-center gap-1 text-[10.5px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${ok ? 'bg-id-mid/15 text-id-dark dark:text-id-light border-id-mid/30' : 'bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-500/30'}`}>
      {ok ? <CheckCircle2 size={11} /> : <Clock size={11} />}{statusTxt(v)}
    </Tag>
  )
}
function AtividadeBadge({ a }) {
  const cls = a === 'TRANSF_ADM' ? 'bg-sky-500/10 text-sky-600 dark:text-sky-300' : a === 'INCORPORADO' ? 'bg-purple-500/10 text-purple-600 dark:text-purple-300' : 'bg-red-500/10 text-red-600 dark:text-red-300'
  return <span className={`inline-flex text-[10.5px] font-semibold px-2 py-0.5 rounded-md whitespace-nowrap ${cls}`}>{ATIVIDADES[a] || a}</span>
}

export default function TransferClosed({ search }) {
  const toast = useToast()
  const currentUser = useOptionalAuth()?.currentUser
  const who = currentUser?.name || currentUser?.username || ''
  const isOwner = currentUser?.username === 'admin' || (currentUser?.email || '').toLowerCase() === OWNER_EMAIL
  const [data, setData] = useState(null)
  const [acesso, setAcesso] = useState(null)
  const [loaded, setLoaded] = useState(false)
  const [live, setLive] = useState('connecting')
  const [saving, setSaving] = useState(0)
  const [desbloqueio, setDesbloqueio] = useState(() => { try { return sessionStorage.getItem(UNLOCK_KEY) || '' } catch { return '' } })
  const [fSit, setFSit] = useState(PEND)
  const [fAtiv, setFAtiv] = useState('')
  const [qLocal, setQLocal] = useState('')
  const q = search || qLocal
  const [aberto, setAberto] = useState(null)
  const [modal, setModal] = useState(null) // 'codigo' | 'acesso' | 'saldo' | 'pdfFundo'
  const [menuPdf, setMenuPdf] = useState(false)
  const [view, setViewState] = useState(() => { try { return localStorage.getItem(VIEW_KEY) || 'dash' } catch { return 'dash' } })
  const setView = (v) => { setViewState(v); try { localStorage.setItem(VIEW_KEY, v) } catch { /* sem storage */ } }
  const chart = useChartTheme()
  const fileRef = useRef(null)

  useEffect(() => onSnapshot(DOC_REF(), { includeMetadataChanges: true }, (snap) => {
    setLive(snap.metadata.fromCache ? 'offline' : 'ok')
    setData(snap.exists() ? snap.data() : null)
    setLoaded(true)
  }, (e) => { console.warn('tcLoad err', e); setLive('offline'); setLoaded(true) }), [])
  useEffect(() => onSnapshot(ACESSO_REF(), (s) => setAcesso(s.exists() ? s.data() : {}), () => setAcesso({})), [])

  // quem pode editar: o dono, quem recebeu permissão ou quem digitou o código nesta sessão
  const porPermissao = !!currentUser?.username && (acesso?.editores || []).includes(currentUser.username)
  const porCodigo = !!acesso?.hash && desbloqueio === acesso.hash
  const canEdit = isOwner || porPermissao || porCodigo

  const processos = useMemo(() => data?.processos || [], [data])
  const conta = data?.conta || {}

  async function mutate(fn, { msg, contaPatch } = {}) {
    if (!canEdit) { toast.error('Somente leitura — desbloqueie para editar.'); return }
    setData((d) => ({ ...(d || {}), processos: fn(d?.processos || []), conta: { ...(d?.conta || {}), ...(contaPatch || {}) } }))
    setSaving((s) => s + 1)
    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(DOC_REF())
        const cur = snap.exists() ? snap.data() : {}
        tx.set(DOC_REF(), JSON.parse(JSON.stringify({ processos: fn(cur.processos || []), conta: { ...(cur.conta || {}), ...(contaPatch || {}) }, updatedAt: Date.now(), updatedBy: who })))
      })
      if (msg) toast.success(msg)
    } catch (e) {
      console.warn('tcSave err', e)
      toast.error('Não foi possível salvar: ' + e.message)
    } finally { setSaving((s) => s - 1) }
  }
  const salvarProcesso = (p, msg) => mutate((list) => (list.some((x) => x.id === p.id) ? list.map((x) => (x.id === p.id ? p : x)) : [p, ...list]), { msg })
  async function excluirProcesso(p) {
    await mutate((list) => list.filter((x) => x.id !== p.id), { msg: `${p.fundo || 'Fundo'} excluído.` })
    ;(p.arquivos || []).forEach((a) => apagarArquivo(a))
  }

  // edição direto na base
  function alternarItem(p, k) {
    const cur = p.itens?.[k] || {}
    const liq = cur.status === LIQ
    const now = Date.now()
    const novo = { ...p, itens: { ...(p.itens || {}), [k]: { ...cur, status: liq ? PEND : LIQ, data: liq ? cur.data : cur.data || todayISO() } }, updatedAt: now, updatedBy: who,
      historico: [...(p.historico || []), { ts: now, quem: who, texto: `${ITEM_LABEL[k]} ${liq ? 'voltou para pendente' : 'liquidado'}` }] }
    salvarProcesso(novo)
  }
  function alternarControle(p, k) {
    const v = p[k] === CONC ? PEND : CONC
    const now = Date.now()
    const label = CONTROLES.find(([c]) => c === k)?.[1] || k
    salvarProcesso({ ...p, [k]: v, updatedAt: now, updatedBy: who, historico: [...(p.historico || []), { ts: now, quem: who, texto: `${label}: ${statusTxt(v)}` }] })
  }

  async function desbloquear(codigo) {
    if (!acesso?.hash) { toast.error('Nenhum código definido ainda. Peça para o responsável liberar o acesso.'); return false }
    const h = await sha256(acesso.salt + ':' + codigo)
    if (h !== acesso.hash) { toast.error('Código incorreto.'); return false }
    try { sessionStorage.setItem(UNLOCK_KEY, h) } catch { /* sem storage */ }
    setDesbloqueio(h); toast.success('Edição liberada nesta sessão.')
    return true
  }
  function bloquear() { try { sessionStorage.removeItem(UNLOCK_KEY) } catch { /* sem storage */ } setDesbloqueio('') }

  function handleFile(file) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const linhas = parsePlanilha(e.target.result)
        if (!linhas.length) { toast.error('Não encontrei fundos na planilha. Ela precisa das colunas "Fundo" e "CNPJ".'); return }
        const prev = mergePlanilha(processos, linhas, who)
        if (!prev.novos && !prev.atualizados) { toast.success('Planilha conferida: nada novo para atualizar.'); return }
        if (!confirm(`Aplicar a planilha? ${prev.novos} fundo(s) novo(s) e ${prev.atualizados} atualizado(s). Itens já liquidados ou excluídos não mudam.`)) return
        mutate((list) => mergePlanilha(list, linhas, who).processos, { msg: `Planilha aplicada: ${prev.novos} novo(s), ${prev.atualizados} atualizado(s).` })
      } catch (err) { console.error(err); toast.error('Erro ao ler a planilha: ' + err.message) }
    }
    reader.readAsArrayBuffer(file)
    if (fileRef.current) fileRef.current.value = ''
  }
  function exportar() {
    if (!processos.length) { toast.error('Nenhum fundo para exportar.'); return }
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([EXPORT_HEADERS, ...processos.map(toSheetRow)])
    ws['!cols'] = EXPORT_HEADERS.map((h) => ({ wch: h === 'Fundo' ? 50 : h.length > 12 ? 20 : 13 }))
    XLSX.utils.book_append_sheet(wb, ws, 'Transfer Closed')
    const det = [['Fundo', 'CNPJ', 'Item', 'Valor', 'Status', 'Liquidado em', 'Observação']]
    processos.forEach((p) => itensDe(p).filter((x) => x.v).forEach((x) => det.push([p.fundo, p.cnpj, x.label, x.v, x.status === LIQ ? 'Liquidado' : x.status === EXC ? 'Excluído' : 'Pendente', brDate(x.data), x.obs || ''])))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(det), 'Itens')
    XLSX.writeFile(wb, `transfer_closed_${todayISO()}.xlsx`)
  }

  // ---- números ----
  const comResumo = useMemo(() => processos.map((p) => ({ p, r: resumo(p) })), [processos])
  const pendentes = comResumo.filter((x) => !x.r.concluido)
  const total = pendentes.reduce((a, x) => a + x.r.total, 0)
  const liquidado = pendentes.reduce((a, x) => a + x.r.liquidado, 0)
  const saldoConta = pendentes.reduce((a, x) => a + x.r.saldo, 0)
  const informado = conta.saldoInformado
  const lista = useMemo(() => {
    const qq = norm(q), qd = /^[\d./\-\s]+$/.test(q) ? onlyDigits(q) : ''
    return comResumo
      .filter(({ p }) => (!fSit || (fSit === CONC ? p.situacao === CONC : p.situacao !== CONC)) && (!fAtiv || p.atividade === fAtiv)
        && (!qq || norm(p.fundo).includes(qq) || (qd && onlyDigits(p.cnpj).includes(qd))))
      .sort((a, b) => (a.r.concluido - b.r.concluido) || (b.r.pendente - a.r.pendente) || a.p.fundo.localeCompare(b.p.fundo))
  }, [comResumo, fSit, fAtiv, q])

  function gerarGeral() {
    if (!lista.length) { toast.error('Nenhum fundo no filtro atual.'); return }
    const partes = [fSit === CONC ? 'Concluídos' : fSit === PEND ? 'Pendentes' : 'Todos os fundos', fAtiv && ATIVIDADES[fAtiv], q && `busca “${q}”`].filter(Boolean)
    resumoGeral(lista.map((x) => x.p), { filtro: partes.join(' · '), who }).catch((e) => toast.error('Erro no PDF: ' + e.message))
  }
  const irBase = (patch = {}) => { if ('sit' in patch) setFSit(patch.sit); if ('ativ' in patch) setFAtiv(patch.ativ); setView('base') }
  const caixaRetido = comResumo.reduce((a, x) => a + parseValor(x.p.caixaRetido), 0)
  const porAtividade = Object.keys(ATIVIDADES).map((k) => ({ name: ATIVIDADES[k], key: k, value: pendentes.filter((x) => x.p.atividade === k).reduce((a, x) => a + x.r.total, 0), n: comResumo.filter((x) => x.p.atividade === k).length }))
  const porItem = ITENS.map(([k, label]) => {
    let pend = 0, liq = 0
    pendentes.forEach(({ p }) => { const x = p.itens?.[k]; if (!x || x.status === EXC) return; const v = parseValor(x.valor); if (x.status === LIQ) liq += v; else pend += v })
    return { label, pend, liq, total: pend + liq }
  }).filter((x) => x.total).sort((a, b) => b.total - a.total)
  const maxItem = porItem[0]?.total || 1
  const controles = CONTROLES.map(([k, l]) => ({ k, l, conc: pendentes.filter((x) => x.p[k] === CONC).length }))
  const recentes = processos.flatMap((p) => (p.historico || []).map((h) => ({ ...h, fundo: p.fundo, id: p.id }))).sort((a, b) => b.ts - a.ts).slice(0, 8)

  const lockBtn = canEdit
    ? <button onClick={porCodigo && !isOwner && !porPermissao ? bloquear : undefined} className="btn" title={isOwner ? 'Você é o responsável pela aba' : porPermissao ? 'Você tem permissão para editar' : 'Clique para bloquear de novo'}><Unlock size={14} className="text-id-dark dark:text-id-light" /> Edição liberada</button>
    : <button onClick={() => setModal('codigo')} className="btn"><Lock size={14} className="text-amber-500" /> Somente leitura · desbloquear</button>
  const header = (
    <>
      {lockBtn}
      {isOwner && <button onClick={() => setModal('acesso')} className="btn" title="Código e quem pode editar"><KeyRound size={14} /> Acesso</button>}
      <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => handleFile(e.target.files[0])} />
      {canEdit && <button onClick={() => fileRef.current?.click()} className="btn" title="Planilha com Fundo, CNPJ, Categoria, Situação, Atividade, Data e uma coluna por item (Tarifa, ADM, Custódia…)"><Upload size={14} /> Importar planilha</button>}
      <div className="relative">
        <button onClick={() => setMenuPdf((v) => !v)} className="btn"><FileText size={14} /> Resumo PDF <ChevronDown size={13} /></button>
        {menuPdf && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMenuPdf(false)} />
            <div className="absolute right-0 top-full mt-1 z-50 w-[260px] rounded-xl border border-[var(--bdr)] bg-[var(--sur-solid)] shadow-[var(--shadow-pop)] p-1.5">
              <button onClick={() => { setMenuPdf(false); gerarGeral() }} className="w-full text-left px-3 py-2 rounded-lg hover:bg-[var(--sur2)]">
                <div className="text-[12.5px] font-medium">Geral</div><div className="text-[11px] text-[var(--tx3)]">Todos os fundos do filtro da base, no formato da planilha</div>
              </button>
              <button onClick={() => { setMenuPdf(false); setModal('pdfFundo') }} className="w-full text-left px-3 py-2 rounded-lg hover:bg-[var(--sur2)]">
                <div className="text-[12.5px] font-medium">De um fundo</div><div className="text-[11px] text-[var(--tx3)]">Escolha o fundo · folha de conclusão</div>
              </button>
            </div>
          </>
        )}
      </div>
      <button onClick={exportar} className="btn"><Download size={14} /> Exportar</button>
      {canEdit && <button onClick={() => setAberto('novo')} className="btn btn-primary"><Plus size={14} /> Novo fundo</button>}
    </>
  )
  const liveMeta = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-[var(--tx3)]">
      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border ${live === 'ok' ? 'border-id-mid/40 text-id-dark dark:text-id-light bg-id-mid/10' : 'border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/10'}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${live === 'ok' ? 'bg-id-light' : 'bg-amber-500'}`} />
        {live === 'ok' ? (saving ? 'Salvando…' : 'Ao vivo') : live === 'offline' ? 'Sem conexão — exibindo cópia local' : 'Conectando…'}
      </span>
      {data?.updatedAt && <span>Última alteração {data.updatedBy ? `por ${data.updatedBy} ` : ''}em {new Date(data.updatedAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>}
    </div>
  )

  if (!loaded) return <div><PageHeader eyebrow="Operacional" title="Transfer / Closed" /><Card className="h-[320px] animate-pulse" /></div>
  const procAberto = aberto === 'novo' ? null : processos.find((p) => p.id === aberto)

  return (
    <div>
      <PageHeader eyebrow="Operacional" title="Transfer / Closed" description="Transferência de administração, encerramento e incorporação de fundos" meta={liveMeta} actions={header} />

      <div className="flex items-center gap-1 mb-3 p-1 rounded-xl border border-[var(--bdr)] bg-[var(--sur2)]/40 w-fit">
        {[['dash', 'Dash', LayoutDashboard], ['base', 'Base', Table2]].map(([id, l, Icon]) => (
          <button key={id} onClick={() => setView(id)} className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[12.5px] transition-colors ${view === id ? 'bg-[var(--sur)] text-[var(--tx)] font-semibold shadow-sm' : 'text-[var(--tx3)] hover:text-[var(--tx2)]'}`}>
            <Icon size={14} />{l}{id === 'base' && <span className="font-mono text-[11px] text-[var(--tx3)]">{processos.length}</span>}
          </button>
        ))}
      </div>

      {view === 'dash' && (
        <div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 mb-3">
            <StatCard icon={Wallet} tone="neutral" label="Total dos fundos pendentes" value={<AnimatedNumber value={total} format={fmtFull} />}
              details={[['Fundos pendentes', String(pendentes.length)], ['Concluídos', String(comResumo.length - pendentes.length)]]} onClick={() => irBase({ sit: PEND })} />
            <StatCard icon={CheckCircle2} tone="green" label="Liquidado" value={<AnimatedNumber value={liquidado} format={fmtFull} />} share={total > 0 ? (liquidado / total) * 100 : null}
              details={[['Itens liquidados', String(pendentes.reduce((a, x) => a + x.r.qtd - x.r.qtdPend, 0))]]} />
            <StatCard icon={Clock} tone={total - liquidado > 0 ? 'amber' : 'green'} label="Pendente" value={<AnimatedNumber value={total - liquidado} format={fmtFull} />}
              details={[['Itens pendentes', String(pendentes.reduce((a, x) => a + x.r.qtdPend, 0))], ['Despesas pendentes', `${pendentes.filter((x) => x.p.statusDespesas !== CONC).length} fundo(s)`]]} />
            <StatCard icon={Landmark} tone="green" label="Saldo da conta" value={<AnimatedNumber value={saldoConta} format={fmtFull} />}
              details={[['Caixa retido', fmtFull(comResumo.reduce((a, x) => a + parseValor(x.p.caixaRetido), 0))], ['Extrato informado', informado != null ? fmtFull(informado) : canEdit ? '— clique para informar' : '—', informado != null && Math.abs(informado - saldoConta) > 0.005 ? 'text-red-500' : '']]}
              onClick={canEdit ? () => setModal('saldo') : undefined} hint="Soma do saldo informado em cada fundo pendente" />
          </div>


          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-3">
            <Card className="p-4 flex flex-col">
              <div className="text-[12.5px] font-semibold mb-1">Pendente por atividade</div>
              <div className="text-[11px] text-[var(--tx3)] mb-2">Total dos fundos pendentes · clique para abrir na base</div>
              <div className="flex-1 min-h-[220px]">
                {porAtividade.some((x) => x.value) ? <DonutChart data={porAtividade.filter((x) => x.value)} colors={chart.series} format={fmtShort} onPick={(n) => { const x = porAtividade.find((y) => y.name === n); if (x) irBase({ ativ: x.key, sit: PEND }) }} /> : <div className="h-full flex items-center justify-center text-[12px] text-[var(--tx3)]">Sem valores pendentes.</div>}
              </div>
              <div className="grid grid-cols-3 gap-2 mt-2">
                {porAtividade.map((x) => (
                  <button key={x.key} onClick={() => irBase({ ativ: x.key, sit: '' })} className="text-left rounded-lg px-2 py-1.5 hover:bg-[var(--sur2)]">
                    <div className="text-[10px] uppercase tracking-wider text-[var(--tx3)] truncate">{x.name}</div>
                    <div className="text-[13px] font-semibold">{x.n} <span className="text-[10.5px] font-normal text-[var(--tx3)]">fundo(s)</span></div>
                  </button>
                ))}
              </div>
            </Card>
            <Card className="p-4 lg:col-span-2">
              <div className="flex items-center mb-3"><div className="text-[12.5px] font-semibold flex-1">Valor por item</div>
                <span className="flex items-center gap-3 text-[10.5px] text-[var(--tx3)]"><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-id-light" />Liquidado</span><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-amber-400" />Pendente</span></span></div>
              <div className="space-y-1.5">
                {porItem.map((x) => (
                  <div key={x.label} className="grid grid-cols-[110px_1fr_auto] items-center gap-3 text-[11.5px]">
                    <span className="truncate text-[var(--tx2)]">{x.label}</span>
                    <div className="h-2.5 rounded-full bg-[var(--sur2)] overflow-hidden flex" title={`Liquidado ${fmtFull(x.liq)} · Pendente ${fmtFull(x.pend)}`}>
                      <div className="h-full bg-id-light transition-[width] duration-700" style={{ width: (x.liq / maxItem) * 100 + '%' }} />
                      <div className="h-full bg-amber-400 transition-[width] duration-700" style={{ width: (x.pend / maxItem) * 100 + '%' }} />
                    </div>
                    <span className="font-mono tabular-nums text-[var(--tx2)] w-[96px] text-right">{fmtShort(x.total)}</span>
                  </div>
                ))}
                {!porItem.length && <div className="text-[12px] text-[var(--tx3)] py-6 text-center">Nenhum valor lançado nos fundos pendentes.</div>}
              </div>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-3">
            <Card className="p-4">
              <div className="text-[12.5px] font-semibold mb-3">Andamento dos fundos pendentes</div>
              <div className="space-y-3">
                {controles.map((c) => (
                  <div key={c.k}>
                    <div className="flex text-[11.5px] mb-1"><span className="flex-1 text-[var(--tx2)]">{c.l}</span><span className="font-mono text-[var(--tx3)]">{c.conc}/{pendentes.length} concluído(s)</span></div>
                    <div className="h-2 rounded-full bg-[var(--sur2)] overflow-hidden"><div className="h-full rounded-full bg-id-light transition-[width] duration-700" style={{ width: (pendentes.length ? (c.conc / pendentes.length) * 100 : 0) + '%' }} /></div>
                  </div>
                ))}
                <div className="flex items-center gap-2 pt-1 text-[11.5px] text-[var(--tx3)]"><Archive size={13} /> Caixa retido total: <span className="font-semibold text-[var(--tx)]">{fmtFull(caixaRetido)}</span></div>
              </div>
            </Card>
                  <RankCard title="Maior valor pendente" tone="amber" items={pendentes.filter((x) => x.r.pendente > 0).map((x) => ({ name: x.p.fundo, value: x.r.pendente })).sort((a, b) => b.value - a.value).slice(0, 6)} empty="Nada pendente." onPick={(n) => { const x = pendentes.find((y) => y.p.fundo === n); if (x) setAberto(x.p.id) }} />
            <RankCard title="Fundos na conta" tone="green" items={pendentes.filter((x) => x.r.saldo > 0).map((x) => ({ name: x.p.fundo, value: x.r.saldo })).sort((a, b) => b.value - a.value).slice(0, 6)} empty="Nenhum saldo informado." onPick={(n) => { const x = pendentes.find((y) => y.p.fundo === n); if (x) setAberto(x.p.id) }} />

          </div>

          <Card className="p-4">
            <div className="text-[12.5px] font-semibold mb-3">Últimas movimentações</div>
            <div className="space-y-2">
              {recentes.map((h, i) => (
                <button key={i} onClick={() => setAberto(h.id)} className="w-full text-left flex gap-2.5 text-[12px] rounded-lg px-2 py-1 hover:bg-[var(--sur2)]">
                  <Clock size={13} className="text-[var(--tx4)] mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1"><div className="truncate"><span className="font-medium">{h.fundo}</span> <span className="text-[var(--tx2)]">— {h.texto}</span></div>
                    <div className="text-[10.5px] text-[var(--tx3)]">{h.quem || '—'} · {new Date(h.ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</div></div>
                </button>
              ))}
              {!recentes.length && <div className="text-[12px] text-[var(--tx3)]">Nada registrado ainda.</div>}
            </div>
          </Card>
        </div>
      )}

      {view === 'base' && (
        <div>
          <Card className="p-3 mb-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {[[PEND, 'Pendentes', pendentes.length], [CONC, 'Concluídos', comResumo.length - pendentes.length], ['', 'Todos', comResumo.length]].map(([id, l, n]) => (
                <button key={l} onClick={() => setFSit(id)} className={`px-3 py-1.5 rounded-xl border text-[12px] ${fSit === id ? 'border-id-mid/60 bg-id-mid/10 text-[var(--tx)]' : 'border-[var(--bdr)] text-[var(--tx2)] hover:bg-[var(--sur2)]'}`}>{l} <span className="font-mono text-[11px] text-[var(--tx3)]">{n}</span></button>
              ))}
              <span className="w-px h-6 bg-[var(--bdr)] mx-1" />
              {[['', 'Todas as atividades'], ...Object.entries(ATIVIDADES)].map(([id, l]) => (
                <button key={l} onClick={() => setFAtiv(id)} className={`px-3 py-1.5 rounded-xl border text-[12px] ${fAtiv === id ? 'border-id-mid/60 bg-id-mid/10 text-[var(--tx)]' : 'border-[var(--bdr)] text-[var(--tx2)] hover:bg-[var(--sur2)]'}`}>{l}</button>
              ))}
              <div className="flex-1" />
              {!search && <input value={qLocal} onChange={(e) => setQLocal(e.target.value)} placeholder="Buscar fundo ou CNPJ…" className="field !w-[220px] !py-1.5 text-[12px]" />}
            </div>
          </Card>

          <Card className="overflow-hidden mb-3">
            <div className="overflow-auto max-h-[72vh]">
              <table className="text-left border-separate border-spacing-0 text-[12px]">
                <thead className="sticky top-0 z-20">
                  <tr className="text-[10px] uppercase tracking-wider text-[var(--tx3)]">
                    <th className={`${TH} sticky left-0 z-30 min-w-[260px] max-w-[260px]`}>Fundo</th>
                    <th className={`${TH} sticky left-[260px] z-30 min-w-[140px] border-r border-r-[var(--bdr)]`}>CNPJ</th>
                    <th className={TH}>Categoria</th><th className={TH}>Situação</th><th className={TH}>Atividade</th><th className={TH}>Data</th>
                    {ITENS.map(([k, l]) => <th key={k} className={`${TH} text-center min-w-[74px]`}>{l}</th>)}
                    <th className={`${TH} text-right`}>Total</th><th className={`${TH} text-right`}>Pendente</th><th className={`${TH} text-right`}>Caixa retido</th>
                    <th className={TH}>Status despesas</th><th className={TH}>Transferido / encerrado</th><th className={TH}>Evidência looping</th><th className={TH} />
                  </tr>
                </thead>
                <tbody>
                  {lista.map(({ p, r }) => (
                    <tr key={p.id} className="group">
                      <td className={`${TD} sticky left-0 z-10 min-w-[260px] max-w-[260px] cursor-pointer`} onClick={() => setAberto(p.id)} title={p.fundo}>
                        <div className="font-medium truncate group-hover:text-id-dark dark:group-hover:text-id-light">{p.fundo || '—'}</div>
                        {p.atividade === 'INCORPORADO' && p.incorporadoPara && <div className="text-[10.5px] text-[var(--tx3)] truncate">→ {p.incorporadoPara}</div>}
                      </td>
                      <td className={`${TD} sticky left-[260px] z-10 font-mono text-[11px] whitespace-nowrap border-r border-r-[var(--bdr)] cursor-pointer`} onClick={() => setAberto(p.id)}>{p.cnpj || '—'}</td>
                      <td className={`${TD} text-[var(--tx2)]`}>{p.categoria || '—'}</td>
                      <td className={TD}><StatusPill v={p.situacao} onClick={canEdit ? () => alternarControle(p, 'situacao') : undefined} /></td>
                      <td className={TD}><AtividadeBadge a={p.atividade} /></td>
                      <td className={`${TD} whitespace-nowrap text-[var(--tx2)]`}>{brDate(p.data) || '—'}</td>
                      {ITENS.map(([k]) => <td key={k} className={`${TD} text-center`}><CelulaItem x={p.itens?.[k]} canEdit={canEdit} onToggle={() => alternarItem(p, k)} /></td>)}
                      <td className={`${TD} text-right tabular-nums whitespace-nowrap font-medium`}>{fmtFull(r.total)}</td>
                      <td className={`${TD} text-right tabular-nums whitespace-nowrap ${r.pendente ? 'text-amber-600 dark:text-amber-400' : 'text-[var(--tx3)]'}`}>{fmtFull(r.pendente)}</td>
                      <td className={`${TD} text-right tabular-nums whitespace-nowrap`} title={p.caixaRetidoObs || ''}>{r.caixaRetido ? fmtFull(r.caixaRetido) : <span className="text-[var(--tx4)]">—</span>}</td>
                      <td className={TD}><StatusPill v={p.statusDespesas} onClick={canEdit ? () => alternarControle(p, 'statusDespesas') : undefined} /></td>
                      <td className={TD}><StatusPill v={p.transferido} onClick={canEdit ? () => alternarControle(p, 'transferido') : undefined} /></td>
                      <td className={`${TD} max-w-[200px]`}>{p.evidencia ? <a href={p.evidencia} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11.5px] text-sky-600 dark:text-sky-300 hover:underline truncate max-w-[190px]" title={p.evidencia}><Link2 size={12} className="shrink-0" /> {p.evidencia.replace(/^https?:\/\//, '').slice(0, 26)}…</a> : <span className="text-[var(--tx4)]">—</span>}</td>
                      <td className={`${TD} whitespace-nowrap`}>
                        {(p.arquivos || []).length > 0 && <span className="inline-flex items-center gap-0.5 text-[11px] text-[var(--tx3)] mr-2" title={p.arquivos.map((a) => a.nome).join('\n')}><Paperclip size={12} />{p.arquivos.length}</span>}
                        <button onClick={() => folhaConclusao(p, who).catch((e) => toast.error('Erro no PDF: ' + e.message))} className="w-7 h-7 inline-flex items-center justify-center rounded-md border border-[var(--bdr)] text-[var(--tx3)] hover:text-[var(--tx)] hover:bg-[var(--sur2)]" title="Resumo do fundo (PDF)"><FileText size={13} /></button>
                      </td>
                    </tr>
                  ))}
                  {!lista.length && (
                    <tr><td colSpan={ITENS.length + 14} className="text-center py-12 text-[12.5px] text-[var(--tx3)]">
                      {processos.length ? 'Nenhum fundo para esse filtro.' : canEdit ? <>Nenhum fundo ainda.<br /><button onClick={() => setAberto('novo')} className="btn btn-primary btn-sm mt-3"><Plus size={13} /> Incluir o primeiro</button></> : 'Nenhum fundo ainda.'}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2.5 text-[11px] text-[var(--tx3)] border-t border-[var(--bdr)] flex flex-wrap gap-x-4 gap-y-1">
              <span>{lista.length} de {processos.length} fundos{!canEdit && ' · somente leitura'}</span>
              <span className="inline-flex items-center gap-1"><CheckSquare size={12} className="text-id-dark dark:text-id-light" /> liquidado</span>
              <span className="inline-flex items-center gap-1"><Square size={12} /> pendente{canEdit ? ' (clique para marcar)' : ''}</span>
              <span>valor em amarelo = lançado e pendente · clique no fundo para abrir a ficha</span>
            </div>
          </Card>

        </div>
      )}

      {aberto && (
        <ProcessoDrawer key={aberto} proc={procAberto} who={who} toast={toast} existentes={processos} canEdit={canEdit}
          onClose={() => setAberto(null)}
          onSave={(p, fechar = true) => { salvarProcesso(p, fechar ? (procAberto ? 'Fundo atualizado.' : 'Fundo incluído.') : undefined); if (fechar) setAberto(null) }}
          onDelete={procAberto ? () => { excluirProcesso(procAberto); setAberto(null) } : null} />
      )}
      {modal === 'codigo' && <CodigoModal onClose={() => setModal(null)} onOk={async (c) => { if (await desbloquear(c)) setModal(null) }} semCodigo={!acesso?.hash} />}
      {modal === 'pdfFundo' && <FundoPdfModal processos={processos} onClose={() => setModal(null)} onPick={(p) => { setModal(null); folhaConclusao(p, who).catch((e) => toast.error('Erro no PDF: ' + e.message)) }} />}
      {modal === 'acesso' && <AcessoModal acesso={acesso} who={who} toast={toast} onClose={() => setModal(null)} />}
      {modal === 'saldo' && <SaldoContaModal atual={informado} soma={saldoConta} onClose={() => setModal(null)} onSave={(v) => { mutate((l) => l, { contaPatch: { saldoInformado: v, informadoEm: Date.now(), informadoPor: who }, msg: 'Saldo da conta atualizado.' }); setModal(null) }} />}
    </div>
  )
}

function FundoPdfModal({ processos, onClose, onPick }) {
  const [q, setQ] = useState('')
  const qq = norm(q), qd = onlyDigits(q)
  const l = processos.filter((p) => !q || norm(p.fundo).includes(qq) || (qd && onlyDigits(p.cnpj).includes(qd))).sort((a, b) => a.fundo.localeCompare(b.fundo))
  return (
    <Overlay onClose={onClose}>
      <Card className="relative w-full max-w-[520px] max-h-[80vh] flex flex-col animate-fade-up">
        <div className="px-5 py-4 border-b border-[var(--bdr)]">
          <div className="flex items-center mb-3"><div className="font-display font-semibold text-[15px] flex-1">Resumo de um fundo (PDF)</div><button onClick={onClose} className="text-[var(--tx3)]"><X size={16} /></button></div>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} className="field" placeholder="Buscar fundo ou CNPJ…" />
        </div>
        <div className="overflow-y-auto p-2">
          {l.map((p) => (
            <button key={p.id} onClick={() => onPick(p)} className="w-full text-left flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-[var(--sur2)]">
              <div className="flex-1 min-w-0"><div className="text-[12.5px] font-medium truncate">{p.fundo}</div><div className="text-[11px] text-[var(--tx3)] font-mono">{p.cnpj}</div></div>
              <StatusPill v={p.situacao} /><FileText size={14} className="text-[var(--tx3)]" />
            </button>
          ))}
          {!l.length && <div className="text-center text-[12px] text-[var(--tx3)] py-6">Nenhum fundo encontrado.</div>}
        </div>
      </Card>
    </Overlay>
  )
}

function CodigoModal({ onClose, onOk, semCodigo }) {
  const [c, setC] = useState('')
  return (
    <Overlay onClose={onClose}>
      <Card className="relative w-full max-w-[360px] p-5 animate-fade-up">
        <div className="font-display font-semibold text-[15px] mb-1 flex items-center gap-2"><Lock size={15} /> Desbloquear edição</div>
        <div className="text-[12px] text-[var(--tx3)] mb-3">{semCodigo ? 'O código ainda não foi definido. Peça ao responsável pela aba para liberar seu acesso.' : 'Digite o código de edição. Fica liberado até você fechar o navegador.'}</div>
        <input autoFocus type="password" value={c} onChange={(e) => setC(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && c && onOk(c)} className="field font-mono" placeholder="Código" disabled={semCodigo} />
        <div className="flex justify-end gap-2 mt-4"><button onClick={onClose} className="btn btn-sm">Cancelar</button><button onClick={() => onOk(c)} disabled={!c || semCodigo} className="btn btn-sm btn-primary">Desbloquear</button></div>
      </Card>
    </Overlay>
  )
}

function AcessoModal({ acesso, who, toast, onClose }) {
  const [codigo, setCodigo] = useState('')
  const [users, setUsers] = useState([])
  const [editores, setEditores] = useState(acesso?.editores || [])
  useEffect(() => onSnapshot(USERS_REF(), (s) => {
    const u = s.exists() ? s.data().users || {} : {}
    setUsers(Object.entries(u).filter(([, p]) => p.role && p.role !== 'pending').map(([username, p]) => ({ username, name: p.name || username, role: p.role })).sort((a, b) => a.name.localeCompare(b.name)))
  }, () => setUsers([])), [])
  async function salvar() {
    try {
      if (codigo) {
        if (codigo.length < 4) { toast.error('Código muito curto (mínimo 4 caracteres).'); return }
        await salvarCodigo(codigo, { ...(acesso || {}), editores }, who)
      } else {
        await setDoc(ACESSO_REF(), { ...(acesso || {}), editores, updatedAt: Date.now(), updatedBy: who })
      }
      toast.success('Acesso atualizado.'); onClose()
    } catch (e) { toast.error('Não foi possível salvar: ' + e.message) }
  }
  return (
    <Overlay onClose={onClose}>
      <Card className="relative w-full max-w-[460px] max-h-[85vh] flex flex-col animate-fade-up">
        <div className="px-5 py-4 border-b border-[var(--bdr)] flex items-center"><div className="font-display font-semibold text-[15px] flex-1 flex items-center gap-2"><KeyRound size={15} /> Acesso à aba</div><button onClick={onClose} className="text-[var(--tx3)]"><X size={16} /></button></div>
        <div className="p-5 overflow-y-auto space-y-4">
          <p className="text-[12px] text-[var(--tx3)]">Todos veem a aba. Editam você, quem estiver marcado abaixo e quem digitar o código.</p>
          <div>
            <div className="label">{acesso?.hash ? 'Trocar código de edição' : 'Definir código de edição'}</div>
            <input type="password" value={codigo} onChange={(e) => setCodigo(e.target.value)} className="field font-mono" placeholder={acesso?.hash ? 'Deixe em branco para manter o atual' : 'Mínimo 4 caracteres'} />
          </div>
          <div>
            <div className="label flex items-center gap-1.5"><Users size={12} /> Podem editar sem código</div>
            <div className="space-y-1 max-h-[260px] overflow-y-auto">
              {users.map((u) => (
                <label key={u.username} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-[var(--sur2)] text-[12.5px] cursor-pointer">
                  <input type="checkbox" checked={editores.includes(u.username)} onChange={(e) => setEditores((s) => (e.target.checked ? [...s, u.username] : s.filter((x) => x !== u.username)))} />
                  <span className="flex-1">{u.name}</span><span className="text-[11px] text-[var(--tx3)]">{u.username} · {u.role}</span>
                </label>
              ))}
              {!users.length && <div className="text-[12px] text-[var(--tx3)]">Carregando usuários…</div>}
            </div>
          </div>
        </div>
        <div className="px-5 py-3 border-t border-[var(--bdr)] flex justify-end gap-2"><button onClick={onClose} className="btn btn-sm">Cancelar</button><button onClick={salvar} className="btn btn-sm btn-primary">Salvar</button></div>
      </Card>
    </Overlay>
  )
}

function SaldoContaModal({ atual, soma, onClose, onSave }) {
  const [v, setV] = useState(fmtInput(atual))
  return (
    <Overlay onClose={onClose}>
      <Card className="relative w-full max-w-[400px] p-5 animate-fade-up">
        <div className="font-display font-semibold text-[15px] mb-1">Saldo da conta</div>
        <div className="text-[12px] text-[var(--tx3)] mb-3">{CONTA_NOME} — informe o saldo do extrato para conferir com a soma dos fundos ({fmtFull(soma)}).</div>
        <input autoFocus value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onSave(parseValor(v))} inputMode="decimal" className="field text-right font-mono" />
        <div className="flex justify-end gap-2 mt-4"><button onClick={onClose} className="btn btn-sm">Cancelar</button><button onClick={() => onSave(parseValor(v))} className="btn btn-sm btn-primary">Salvar</button></div>
      </Card>
    </Overlay>
  )
}

function ProcessoDrawer({ proc, who, toast, existentes, canEdit, onClose, onSave, onDelete }) {
  const isNew = !proc
  const [f, setF] = useState(() => (proc ? JSON.parse(JSON.stringify(proc)) : novoProcesso({ responsavel: who }, who)))
  const [aba, setAba] = useState('dados')
  const [buscando, setBuscando] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [comentario, setComentario] = useState('')
  const [err, setErr] = useState('')
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))
  const ro = !canEdit
  const r = resumo(f)
  const itens = itensDe(f)

  const setItem = (x, patch) => setF((s) => (x.extra
    ? { ...s, extras: s.extras.map((e) => (e.id === x.key ? { ...e, ...patch } : e)) }
    : { ...s, itens: { ...(s.itens || {}), [x.key]: { ...(s.itens?.[x.key] || {}), ...patch } } }))
  const statusItem = (x, st) => setItem(x, { status: x.status === st ? PEND : st, data: st === LIQ && x.status !== LIQ ? x.data || todayISO() : x.data })
  const addExtra = () => setF((s) => ({ ...s, extras: [...(s.extras || []), { id: novoId(), label: '', valor: '', status: PEND }] }))
  const delExtra = (x) => setF((s) => ({ ...s, extras: s.extras.filter((e) => e.id !== x.key) }))

  async function completarPorCnpj() {
    if (ro || onlyDigits(f.cnpj).length < 14 || (f.fundo && f.categoria)) return
    try { const a = fundoPorCnpj(await carregarBases(), f.cnpj); if (a) setF((s) => ({ ...s, fundo: s.fundo || a.fundo, categoria: s.categoria || a.categoria })) } catch (e) { console.warn(e) }
  }
  async function puxar() {
    if (!onlyDigits(f.cnpj)) { toast.error('Informe o CNPJ para buscar as pendências.'); return }
    setBuscando(true)
    try {
      const s = pendenciasDoSistema(await carregarBases(), f.cnpj)
      const ks = Object.keys(s)
      if (!ks.length) { toast.success('Nenhuma pendência de Taxa ADM ou ANBIMA para esse CNPJ.'); return }
      setF((cur) => {
        const it = { ...(cur.itens || {}) }
        ks.forEach((k) => { if (!it[k] || (it[k].status || PEND) === PEND) it[k] = { ...(it[k] || {}), valor: s[k].valor, obs: s[k].obs, status: PEND } })
        return { ...cur, itens: it }
      })
      toast.success('Trazido do sistema: ' + ks.map((k) => `${k === 'adm' ? 'ADM' : 'ANBIMA'} ${fmtFull(s[k].valor)}`).join(' · '))
    } catch (e) { toast.error('Não consegui ler as bases: ' + e.message) } finally { setBuscando(false) }
  }
  async function anexar(files) {
    if (!files.length) return
    if (isNew) { toast.error('Salve o fundo antes de anexar arquivos.'); return }
    setEnviando(true)
    try {
      const novos = []
      for (const file of files) {
        if (file.size > MAX_ARQUIVO) { toast.error(`${file.name} passa de 8 MB.`); continue }
        novos.push(await enviarArquivo(file, who))
      }
      if (!novos.length) return
      const hist = { ts: Date.now(), quem: who, texto: 'Anexado: ' + novos.map((a) => a.nome).join(', ') }
      // grava na hora (o arquivo já está guardado), sem esperar o "Salvar"
      const base = { ...proc, arquivos: [...(proc.arquivos || []), ...novos], historico: [...(proc.historico || []), hist], updatedAt: Date.now(), updatedBy: who }
      onSave(base, false)
      setF((s) => ({ ...s, arquivos: [...(s.arquivos || []), ...novos], historico: [...(s.historico || []), hist] }))
      toast.success(`${novos.length} arquivo(s) anexado(s).`)
    } catch (e) { toast.error('Falha no envio: ' + e.message) } finally { setEnviando(false) }
  }
  function removerArquivo(a) {
    if (!confirm(`Remover o arquivo ${a.nome}?`)) return
    const hist = { ts: Date.now(), quem: who, texto: 'Arquivo removido: ' + a.nome }
    onSave({ ...proc, arquivos: (proc.arquivos || []).filter((x) => x.id !== a.id), historico: [...(proc.historico || []), hist], updatedAt: Date.now(), updatedBy: who }, false)
    setF((s) => ({ ...s, arquivos: s.arquivos.filter((x) => x.id !== a.id), historico: [...(s.historico || []), hist] }))
    apagarArquivo(a)
  }

  function montar() {
    const p = { ...f, saldoConta: parseValor(f.saldoConta) || '', caixaRetido: parseValor(f.caixaRetido) || '' }
    p.itens = Object.fromEntries(Object.entries(p.itens || {}).map(([k, x]) => [k, { ...x, valor: parseValor(x.valor) }]).filter(([, x]) => x.valor || x.obs))
    p.extras = (p.extras || []).filter((x) => x.label || parseValor(x.valor)).map((x) => ({ ...x, valor: parseValor(x.valor) }))
    if (p.atividade !== 'INCORPORADO') p.incorporadoPara = ''
    return p
  }
  function salvar() {
    const p = montar()
    if (!p.fundo.trim()) { setErr('Informe o nome do fundo.'); setAba('dados'); return }
    const dup = existentes.find((x) => x.id !== p.id && onlyDigits(x.cnpj) && onlyDigits(x.cnpj) === onlyDigits(p.cnpj))
    if (dup) { setErr(`Já existe um fundo com esse CNPJ na lista (${dup.fundo}).`); return }
    const now = Date.now(), hist = [...(p.historico || [])]
    if (proc) {
      const mud = []
      CONTROLES.forEach(([k, l]) => { if ((proc[k] || PEND) !== (p[k] || PEND)) mud.push(`${l}: ${statusTxt(p[k])}`) })
      if (proc.atividade !== p.atividade) mud.push(`atividade ${ATIVIDADES[p.atividade]}`)
      const a = resumo(proc)
      if (a.total !== r.total || a.liquidado !== r.liquidado) mud.push(`total ${fmtFull(r.total)} (liquidado ${fmtFull(r.liquidado)})`)
      const antes = Object.fromEntries(itensDe(proc).map((x) => [x.key, x.status]))
      itensDe(p).forEach((x) => { if (x.v && antes[x.key] !== x.status && x.status !== PEND) mud.push(`${x.label} ${x.status === LIQ ? 'liquidado' : 'excluído'}`) })
      if (mud.length) hist.push({ ts: now, quem: who, texto: mud.join(' · ') })
    }
    if (comentario.trim()) hist.push({ ts: now, quem: who, texto: comentario.trim(), comentario: true })
    onSave({ ...p, historico: hist, updatedAt: now, updatedBy: who })
  }

  const tabs = [['dados', 'Dados'], ['valores', `Valores · ${fmtShort(r.total)}`], ['arquivos', `Arquivos${(f.arquivos || []).length ? ` (${f.arquivos.length})` : ''}`], ['historico', 'Histórico']]
  return (
    <Overlay onClose={onClose} side>
      <div className="relative h-full w-full max-w-[720px] bg-[var(--sur)] border-l border-[var(--bdr)] shadow-[var(--shadow-pop)] flex flex-col animate-slide-in">
        <div className="px-5 pt-4 pb-3 border-b border-[var(--bdr)]">
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="font-display font-semibold text-[15px] truncate">{isNew ? 'Novo fundo — Transfer / Closed' : f.fundo}</div>
              <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px] text-[var(--tx3)]">
                {f.cnpj && <span className="font-mono">{f.cnpj}</span>}<AtividadeBadge a={f.atividade} /><StatusPill v={f.situacao} />
                {ro && <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400"><Lock size={11} /> somente leitura</span>}
              </div>
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--tx3)] hover:bg-[var(--sur2)]"><X size={16} /></button>
          </div>
          <div className="flex gap-1 mt-3">
            {tabs.map(([id, l]) => <button key={id} onClick={() => setAba(id)} className={`text-[12px] px-3 py-1.5 rounded-lg ${aba === id ? 'bg-[var(--sur2)] text-[var(--tx)] font-medium' : 'text-[var(--tx3)] hover:text-[var(--tx2)]'}`}>{l}</button>)}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <fieldset disabled={ro} className="contents">
            {aba === 'dados' && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div><div className="label">CNPJ</div><input value={f.cnpj} onChange={set('cnpj')} onBlur={completarPorCnpj} className="field font-mono" placeholder="00.000.000/0001-00" /></div>
                  <div><div className="label">Categoria</div><input list="tc-cat" value={f.categoria} onChange={set('categoria')} className="field" /><datalist id="tc-cat">{CATEGORIAS.map((c) => <option key={c} value={c} />)}</datalist></div>
                </div>
                <div><div className="label">Fundo</div><input value={f.fundo} onChange={set('fundo')} className="field" placeholder="Razão social (preenche pelo CNPJ se o fundo estiver na Taxa ADM)" /></div>
                <div><div className="label">Atividade</div>
                  <div className="grid grid-cols-3 gap-1">
                    {Object.entries(ATIVIDADES).map(([k, l]) => <button key={k} onClick={() => setF((s) => ({ ...s, atividade: k }))} className={`btn btn-sm justify-center ${f.atividade === k ? 'border-id-mid/60 bg-id-mid/10 text-[var(--tx)]' : ''}`}>{l}</button>)}
                  </div>
                </div>
                {f.atividade === 'INCORPORADO' && <div><div className="label">Incorporado para (nome / CNPJ / conta)</div><input value={f.incorporadoPara} onChange={set('incorporadoPara')} className="field" placeholder="Ex.: FUNDO XYZ FIDC · 00.000.000/0001-00 · CC 12345-6" /></div>}
                <div className="grid grid-cols-3 gap-3">
                  <div><div className="label">Data</div><input type="date" value={f.data} onChange={set('data')} className="field" /></div>
                  <div><div className="label">Previsão</div><input type="date" value={f.dataPrevista} onChange={set('dataPrevista')} className="field" /></div>
                  <div><div className="label">Responsável</div><input value={f.responsavel} onChange={set('responsavel')} className="field" /></div>
                </div>
                <div className="rounded-xl border border-[var(--bdr)] p-3 space-y-2">
                  {CONTROLES.map(([k, l]) => (
                    <div key={k} className="flex items-center gap-3">
                      <span className="text-[12.5px] flex-1">{l}</span>
                      <div className="grid grid-cols-2 gap-1 w-[210px]">
                        {[[PEND, 'Pendente'], [CONC, 'Concluído']].map(([v, lab]) => (
                          <button key={v} onClick={() => setF((s) => ({ ...s, [k]: v }))} className={`btn btn-sm justify-center ${(f[k] || PEND) === v ? (v === CONC ? 'border-id-mid/60 text-id-dark dark:text-id-light bg-id-mid/10' : 'border-amber-500/60 text-amber-600 dark:text-amber-400 bg-amber-500/10') : ''}`}>{lab}</button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <div><div className="label">Evidência do looping (link do Slack)</div>
                  <div className="flex gap-2"><input value={f.evidencia} onChange={set('evidencia')} className="field" placeholder="https://….slack.com/archives/…" />
                    {/^https?:\/\//.test(f.evidencia) && <a href={f.evidencia} target="_blank" rel="noreferrer" className="btn btn-sm shrink-0"><ExternalLink size={12} /> Abrir</a>}</div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><div className="label">Caixa retido após {f.atividade === 'ENCERRAMENTO' ? 'o encerramento' : 'a transferência'} (R$)</div><input value={fmtInput(f.caixaRetido)} onChange={set('caixaRetido')} onBlur={(e) => setF((s) => ({ ...s, caixaRetido: e.target.value === '' ? '' : parseValor(e.target.value) }))} inputMode="decimal" className="field text-right font-mono" placeholder="0,00" /></div>
                  <div><div className="label">Detalhe do caixa retido</div><input value={f.caixaRetidoObs || ''} onChange={set('caixaRetidoObs')} className="field" placeholder="Ex.: provisão de auditoria" /></div>
                </div>
                <div><div className="label">Saldo na conta {CONTA_NOME} (R$)</div><input value={fmtInput(f.saldoConta)} onChange={set('saldoConta')} onBlur={(e) => setF((s) => ({ ...s, saldoConta: e.target.value === '' ? '' : parseValor(e.target.value) }))} inputMode="decimal" className="field text-right font-mono" placeholder="opcional" /></div>
                <div><div className="label">Observações</div><textarea value={f.obs} onChange={set('obs')} rows={3} className="field resize-none" /></div>
              </div>
            )}

            {aba === 'valores' && (
              <div>
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <div className="text-[12px] text-[var(--tx3)] flex-1 min-w-[200px]">Todos somam. Marque <b>Liquidado</b> quando concluir; <b>Excluir</b> tira o item da conta e da folha de conclusão.</div>
                  {!ro && <button onClick={puxar} disabled={buscando} className="btn btn-sm" title="ADM e ANBIMA pendentes desse CNPJ nas outras telas">{buscando ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Puxar ADM / ANBIMA do sistema</button>}
                </div>
                <div className="rounded-xl border border-[var(--bdr)] overflow-hidden">
                  <table className="w-full text-[12px]">
                    <thead><tr className="text-[10px] uppercase tracking-wider text-[var(--tx3)] bg-[var(--sur2)]/60">
                      <th className="text-left px-3 py-2 font-medium">Item</th><th className="text-right px-2 py-2 font-medium w-[130px]">Valor (R$)</th><th className="px-2 py-2 font-medium w-[200px]">Status</th><th className="px-2 py-2 font-medium w-[124px]">Liquidado em</th>
                    </tr></thead>
                    <tbody>
                      {itens.map((x) => (
                        <tr key={x.key} className={`border-t border-[var(--bdr)]/60 align-top ${x.status === EXC ? 'opacity-45' : ''}`}>
                          <td className="px-3 py-1.5">
                            {x.extra
                              ? <div className="flex gap-1"><input value={x.label} onChange={(e) => setItem(x, { label: e.target.value })} className="field !py-1 text-[12px]" placeholder="Nome do item" />{!ro && <button onClick={() => delExtra(x)} className="w-7 h-7 shrink-0 rounded-md flex items-center justify-center text-[var(--tx3)] hover:text-red-500"><Trash2 size={12} /></button>}</div>
                              : <div className={`font-medium pt-1 ${x.status === EXC ? 'line-through' : ''}`}>{x.label}</div>}
                            {(x.obs || (!ro && x.v)) ? <input value={x.obs || ''} onChange={(e) => setItem(x, { obs: e.target.value })} className="field !py-0.5 text-[11px] mt-1 text-[var(--tx3)]" placeholder="Observação" /> : null}
                          </td>
                          <td className="px-2 py-1.5"><input value={fmtInput(x.valor)} onChange={(e) => setItem(x, { valor: e.target.value })} onBlur={(e) => setItem(x, { valor: e.target.value === '' ? '' : parseValor(e.target.value) })} inputMode="decimal" className="field !py-1 text-right font-mono text-[12px]" placeholder="0,00" /></td>
                          <td className="px-2 py-1.5">
                            <div className="grid grid-cols-3 gap-1">
                              <span className={`text-[10.5px] font-semibold py-1 rounded-md border text-center ${x.status === PEND ? 'border-amber-500/50 text-amber-600 dark:text-amber-400 bg-amber-500/10' : 'border-[var(--bdr)] text-[var(--tx4)]'}`}>Pendente</span>
                              <button onClick={() => statusItem(x, LIQ)} className={`text-[10.5px] font-semibold py-1 rounded-md border ${x.status === LIQ ? 'border-id-mid/60 text-id-dark dark:text-id-light bg-id-mid/10' : 'border-[var(--bdr)] text-[var(--tx3)] hover:bg-[var(--sur2)]'}`}>Liquidado</button>
                              <button onClick={() => statusItem(x, EXC)} className={`text-[10.5px] font-semibold py-1 rounded-md border inline-flex items-center justify-center gap-0.5 ${x.status === EXC ? 'border-red-500/50 text-red-600 dark:text-red-400 bg-red-500/10' : 'border-[var(--bdr)] text-[var(--tx3)] hover:bg-[var(--sur2)]'}`}><Ban size={10} />Excluir</button>
                            </div>
                          </td>
                          <td className="px-2 py-1.5">{x.status === LIQ && <input type="date" value={x.data || ''} onChange={(e) => setItem(x, { data: e.target.value })} className="field !py-1 text-[11.5px]" />}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-[var(--bdr)] bg-[var(--sur2)]/40 font-semibold">
                        <td className="px-3 py-2">Total</td><td className="px-2 py-2 text-right tabular-nums">{fmtFull(r.total)}</td>
                        <td colSpan={2} className="px-2 py-2 text-[11px] font-normal text-[var(--tx3)]">liquidado <span className="text-id-dark dark:text-id-light">{fmtFull(r.liquidado)}</span> · pendente <span className="text-amber-600 dark:text-amber-400">{fmtFull(r.pendente)}</span></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                {!ro && <button onClick={addExtra} className="btn btn-sm mt-2"><Plus size={12} /> Outro item</button>}
              </div>
            )}

            {aba === 'historico' && (
              <div>
                {!ro && <><div className="label">Novo comentário</div><textarea value={comentario} onChange={(e) => setComentario(e.target.value)} rows={2} className="field resize-none mb-3" placeholder="Fica registrado com seu nome ao salvar" /></>}
                <div className="space-y-2">
                  {[...(f.historico || [])].reverse().map((h, i) => (
                    <div key={i} className="flex gap-2.5 text-[12px]">
                      <Clock size={13} className="text-[var(--tx4)] mt-0.5 shrink-0" />
                      <div className="min-w-0"><div className={h.comentario ? 'text-[var(--tx)]' : 'text-[var(--tx2)]'}>{h.texto}</div>
                        <div className="text-[10.5px] text-[var(--tx3)]">{h.quem || '—'} · {new Date(h.ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}</div></div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </fieldset>
          {aba === 'arquivos' && (
            <div>
              {!ro && (
                <label className={`flex flex-col items-center justify-center gap-1 border-2 border-dashed border-[var(--bdr)] rounded-xl py-8 cursor-pointer hover:bg-[var(--sur2)]/50 ${enviando ? 'opacity-60 pointer-events-none' : ''}`}
                  onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); anexar([...e.dataTransfer.files]) }}>
                  {enviando ? <Loader2 size={20} className="animate-spin text-[var(--tx3)]" /> : <Paperclip size={20} className="text-[var(--tx3)]" />}
                  <span className="text-[12.5px] font-medium">{enviando ? 'Enviando…' : 'Clique ou arraste PDF / Excel aqui'}</span>
                  <span className="text-[11px] text-[var(--tx3)]">até 8 MB por arquivo{isNew ? ' · salve o fundo antes de anexar' : ''}</span>
                  <input type="file" multiple accept=".pdf,.xls,.xlsx,.xlsm,.csv" className="hidden" onChange={(e) => { anexar([...e.target.files]); e.target.value = '' }} />
                </label>
              )}
              <div className="space-y-1.5 mt-3">
                {(f.arquivos || []).map((a) => (
                  <div key={a.id} className="flex items-center gap-3 px-3 py-2 rounded-xl border border-[var(--bdr)]">
                    <FileText size={16} className={/pdf/i.test(a.tipo + a.nome) ? 'text-red-500' : 'text-id-dark dark:text-id-light'} />
                    <div className="flex-1 min-w-0"><div className="text-[12.5px] truncate">{a.nome}</div><div className="text-[10.5px] text-[var(--tx3)]">{(a.tamanho / 1024).toFixed(0)} KB · {a.por || '—'} · {new Date(a.em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</div></div>
                    <button onClick={() => baixarArquivo(a).catch((e) => toast.error('Não consegui baixar: ' + e.message))} className="btn btn-sm"><Download size={12} /> Baixar</button>
                    {!ro && <button onClick={() => removerArquivo(a)} className="w-7 h-7 rounded-md flex items-center justify-center text-[var(--tx3)] hover:text-red-500 hover:bg-red-500/10"><Trash2 size={13} /></button>}
                  </div>
                ))}
                {!(f.arquivos || []).length && <div className="text-center text-[12px] text-[var(--tx3)] py-4">Nenhum arquivo anexado.</div>}
              </div>
            </div>
          )}

          {err && <p className="text-[12px] text-red-500 mt-3">{err}</p>}
        </div>

        <div className="px-5 py-3 border-t border-[var(--bdr)] flex items-center gap-2">
          {onDelete && !ro && <button onClick={() => { if (confirm(`Excluir ${proc.fundo} da lista? Apaga valores, arquivos e histórico.`)) onDelete() }} className="btn btn-sm btn-danger">Excluir</button>}
          <div className="flex-1" />
          <button onClick={() => folhaConclusao(montar(), who).catch((e) => toast.error('Erro no PDF: ' + e.message))} className="btn btn-sm" title="PDF com os itens lançados; liquidados aparecem como Liquidado, excluídos não aparecem"><FileText size={13} /> Folha de conclusão</button>
          <button onClick={onClose} className="btn btn-sm">{ro ? 'Fechar' : 'Cancelar'}</button>
          {!ro && <button onClick={salvar} className="btn btn-sm btn-primary">Salvar</button>}
        </div>
      </div>
    </Overlay>
  )
}
