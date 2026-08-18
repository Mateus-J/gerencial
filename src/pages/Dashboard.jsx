import { useEffect, useMemo, useState } from 'react'
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore'
import { Plus, X, Building2, AlertTriangle, History as HistoryIcon, Info } from 'lucide-react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell } from 'recharts'
import { db } from '../lib/firebase'
import { PageHeader, Card } from '../components/PageShell'
import KpiCard from '../components/KpiCard'
import StatusBadge from '../components/StatusBadge'
import PriorityBadge from '../components/PriorityBadge'
import SlackIcon from '../components/SlackIcon'
import { useAuth } from '../context/AuthContext'
import { useFundos } from '../hooks/useFundos'

const PEND_DOC = () => doc(db, 'controle', 'pendencias')
const HIST_DOC = () => doc(db, 'controle', 'pendencias_historico')

const OCORRENCIAS_DEFAULT = [
  'Pagamento de Nota', 'Devolução e Reembolso', 'Escrow', 'Operações', 'Ativos',
  'Aportes', 'Resgates', 'Slack', 'Taxa de Administração', 'Comprovantes', 'Extratos',
]
const PRIORIDADES = ['Baixa', 'Média', 'Alta']

function timeAgo(ts) {
  if (!ts) return '—'
  const diff = Date.now() - ts
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return min + 'min'
  const h = Math.floor(min / 60)
  if (h < 24) return h + 'h'
  const d = Math.floor(h / 24)
  if (d < 30) return d + 'd'
  const mo = Math.floor(d / 30)
  return mo + 'mo'
}

function fmtDuration(ms) {
  if (!ms || ms <= 0) return '—'
  const min = ms / 60000
  if (min < 60) return Math.round(min) + 'min'
  const h = min / 60
  if (h < 24) return h.toFixed(1).replace('.0', '') + 'h'
  const d = h / 24
  return d.toFixed(1).replace('.0', '') + 'd'
}

// Agrupa as pendências concluídas por semana (segunda-feira como início) —
// últimas 8 semanas, pra ver se o ritmo de resolução está subindo ou caindo.
function buildWeeklyData(histItems) {
  const weeks = []
  const now = new Date()
  const monday = new Date(now)
  monday.setHours(0, 0, 0, 0)
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
  for (let i = 7; i >= 0; i--) {
    const start = new Date(monday); start.setDate(monday.getDate() - i * 7)
    const end = new Date(start); end.setDate(start.getDate() + 7)
    const label = start.getDate().toString().padStart(2, '0') + '/' + (start.getMonth() + 1).toString().padStart(2, '0')
    const count = histItems.filter((h) => h.concluidoEm >= start.getTime() && h.concluidoEm < end.getTime()).length
    weeks.push({ semana: label, concluidas: count })
  }
  return weeks
}

export default function Dashboard() {
  const { currentUser } = useAuth()
  const { all: fundosAll } = useFundos()
  const [items, setItems] = useState([])
  const [responsaveis, setResponsaveis] = useState([])
  const [ocorrencias, setOcorrencias] = useState(OCORRENCIAS_DEFAULT)
  const [alertaDias, setAlertaDias] = useState(3)
  const [concluidasCount, setConcluidasCount] = useState(0)
  const [tempoMedioMs, setTempoMedioMs] = useState(null)
  const [weeklyData, setWeeklyData] = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [detailItem, setDetailItem] = useState(null)
  const [, forceTick] = useState(0)

  useEffect(() => {
    let mounted = true
    // onSnapshot em vez de getDoc: qualquer pessoa concluindo/criando uma
    // pendência atualiza a tela de todo mundo que estiver com ela aberta,
    // sem precisar dar refresh — é o que o indicador "Tempo real ativo" promete.
    const unsubPend = onSnapshot(PEND_DOC(), (snap) => {
      if (!mounted) return
      if (snap.exists()) {
        setItems(snap.data().items || [])
        setResponsaveis(snap.data().responsaveis || [])
        setOcorrencias(snap.data().ocorrencias?.length ? snap.data().ocorrencias : OCORRENCIAS_DEFAULT)
        if (snap.data().alertaDias) setAlertaDias(snap.data().alertaDias)
      }
      setLoading(false)
    }, (e) => { console.warn('pendLoad err', e); mounted && setLoading(false) })
    // Total de concluídas, tempo médio de retorno e gráfico semanal vêm do Histórico
    const unsubHist = onSnapshot(HIST_DOC(), (snap) => {
      if (!mounted || !snap.exists()) return
      const histItems = snap.data().items || []
      setConcluidasCount(histItems.length)
      const durations = histItems.filter((h) => h.createdAt && h.concluidoEm).map((h) => h.concluidoEm - h.createdAt)
      setTempoMedioMs(durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null)
      setWeeklyData(buildWeeklyData(histItems))
    }, (e) => console.warn('histCountLoad err', e))
    // Atualiza a coluna "Tempo" a cada minuto
    const t = setInterval(() => forceTick((x) => x + 1), 60000)
    return () => { mounted = false; unsubPend(); unsubHist(); clearInterval(t) }
  }, [])

  function persist(nextItems, nextResp) {
    setItems(nextItems)
    if (nextResp) setResponsaveis(nextResp)
    // Lê o doc mais recente antes de gravar, pra não sobrescrever listas
    // de ocorrências/responsáveis editadas em paralelo (ex: em Configurações)
    getDoc(PEND_DOC()).then((snap) => {
      const current = snap.exists() ? snap.data() : {}
      setDoc(PEND_DOC(), { ...current, items: nextItems, responsaveis: nextResp || current.responsaveis || responsaveis }, { merge: false }).catch((e) => console.warn('pendSave err', e))
    }).catch(() => {
      setDoc(PEND_DOC(), { items: nextItems, responsaveis: nextResp || responsaveis, ocorrencias }, { merge: false }).catch((e) => console.warn('pendSave err', e))
    })
  }

  async function addPendencia(data) {
    const item = { id: 'pd' + Date.now(), status: 'Pendente', createdAt: Date.now(), createdBy: currentUser?.name || currentUser?.username, ...data }
    const nextResp = data.responsavel && !responsaveis.includes(data.responsavel) ? [...responsaveis, data.responsavel] : responsaveis
    persist([item, ...items], nextResp)
    setShowModal(false)
  }

  function updateObservacao(id, value) {
    const next = items.map((i) => (i.id === id ? { ...i, observacao: value } : i))
    persist(next)
  }

  async function concluir(item) {
    const remaining = items.filter((i) => i.id !== item.id)
    persist(remaining)
    const concluded = { ...item, status: 'Concluída', concluidoPor: currentUser?.name || currentUser?.username, concluidoEm: Date.now(), dataFinalizacao: item.dataFinalizacao || new Date().toISOString().slice(0, 10) }
    try {
      const snap = await getDoc(HIST_DOC())
      const hist = snap.exists() ? snap.data().items || [] : []
      const nextHist = [concluded, ...hist]
      await setDoc(HIST_DOC(), { items: nextHist }, { merge: false })
      setConcluidasCount(nextHist.length)
      const durations = nextHist.filter((h) => h.createdAt && h.concluidoEm).map((h) => h.concluidoEm - h.createdAt)
      if (durations.length) setTempoMedioMs(durations.reduce((a, b) => a + b, 0) / durations.length)
      setWeeklyData(buildWeeklyData(nextHist))
    } catch (e) { console.warn('histSave err', e) }
  }

  const rows = useMemo(() => items.filter((r) => (r.fundo || '').toLowerCase().includes(q.toLowerCase()) || (r.detalhamento || '').toLowerCase().includes(q.toLowerCase()) || (r.observacao || '').toLowerCase().includes(q.toLowerCase())), [items, q])
  const pendentes = items.filter((r) => r.status === 'Pendente').length
  const totalGeral = pendentes + concluidasCount
  const pctConcluidas = totalGeral > 0 ? Math.round((concluidasCount / totalGeral) * 100) : 0
  const alertaMs = alertaDias * 86400000
  const isAtrasada = (r) => r.createdAt && (Date.now() - r.createdAt) > alertaMs
  const atrasadasCount = items.filter((r) => r.status === 'Pendente' && isAtrasada(r)).length
  const maisAntiga = items.filter((r) => r.status === 'Pendente').sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))[0]

  return (
    <div>
      <PageHeader
        eyebrow="Área Liquidação · Em aberto"
        title="Pendências Liquidação"
        actions={
          <button onClick={() => setShowModal(true)} className="flex items-center gap-1.5 text-[12px] bg-id-dark hover:bg-id-mid rounded-lg px-3 py-1.5 font-medium text-white">
            <Plus size={13} /> Nova pendência
          </button>
        }
      />

      <div className="flex flex-wrap gap-3 mb-4">
        <KpiCard label="Pendentes" value={pendentes} sub="em aberto" accent="amber" />
        <KpiCard label="Concluídas" value={concluidasCount} sub={`${pctConcluidas}% do total`} accent="green" />
        <KpiCard label="Total" value={totalGeral} sub="registros" accent="blue" />
        <KpiCard label="Tempo médio de retorno" value={fmtDuration(tempoMedioMs)} sub={concluidasCount ? `com base em ${concluidasCount} concluída${concluidasCount > 1 ? 's' : ''}` : 'sem dados ainda'} accent="neutral" />
        <KpiCard label="Atrasadas" value={atrasadasCount} sub={`> ${alertaDias} dia${alertaDias > 1 ? 's' : ''} em aberto`} accent={atrasadasCount > 0 ? 'amber' : 'neutral'} />
      </div>

      {maisAntiga && (
        <Card className={`p-3 mb-4 flex items-center gap-3 ${isAtrasada(maisAntiga) ? 'border-red-500/40' : ''}`}>
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${isAtrasada(maisAntiga) ? 'bg-red-500/15 text-red-500' : 'bg-[var(--sur2)] text-[var(--tx3)]'}`}>
            <AlertTriangle size={15} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10.5px] uppercase text-[var(--tx3)]">Pendência mais antiga em aberto</div>
            <div className="text-[12.5px] font-medium truncate">{maisAntiga.fundo} <span className="text-[var(--tx3)] font-normal">· {maisAntiga.ocorrencia}</span></div>
          </div>
          <div className={`text-[13px] font-mono font-semibold shrink-0 ${isAtrasada(maisAntiga) ? 'text-red-500' : 'text-[var(--tx2)]'}`}>{timeAgo(maisAntiga.createdAt)}</div>
        </Card>
      )}

      {weeklyData.some((w) => w.concluidas > 0) && (
        <Card className="p-4 mb-4">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--tx3)] mb-2">
            <HistoryIcon size={12} /> Concluídas por semana (últimas 8 semanas)
          </div>
          <div className="h-[140px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weeklyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--bdr)" vertical={false} />
                <XAxis dataKey="semana" tick={{ fontSize: 10, fill: 'var(--tx3)' }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: 'var(--tx3)' }} axisLine={false} tickLine={false} width={24} />
                <Tooltip contentStyle={{ background: 'var(--sur)', border: '1px solid var(--bdr)', fontSize: 12, borderRadius: 8 }} />
                <Bar dataKey="concluidas" name="Concluídas" radius={[4, 4, 0, 0]}>
                  {weeklyData.map((_, i) => <Cell key={i} fill="#8FB352" />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      <Card>
        <div className="p-3 border-b border-[var(--bdr)]">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar fundo, ocorrência ou detalhamento…"
            className="w-full bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-3 py-2 text-[12px] outline-none focus:border-id-mid placeholder:text-[var(--tx3)]"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10.5px] uppercase tracking-wider text-[var(--tx3)] border-b border-[var(--bdr)]">
                <th className="px-4 py-2.5 font-medium">Fundo</th>
                <th className="px-4 py-2.5 font-medium">Ocorrência</th>
                <th className="px-4 py-2.5 font-medium">Responsável</th>
                <th className="px-4 py-2.5 font-medium">Prioridade</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Observação</th>
                <th className="px-4 py-2.5 font-medium">Tempo</th>
                <th className="px-4 py-2.5 font-medium text-right"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="text-center py-10 text-[var(--tx3)]">Carregando…</td></tr>
              ) : !rows.length ? (
                <tr><td colSpan={8} className="text-center py-10 text-[var(--tx3)]">{items.length ? 'Nenhum resultado.' : 'Nenhuma pendência em aberto. Clique em "Nova pendência" para começar.'}</td></tr>
              ) : rows.map((r) => {
                const atrasada = r.status === 'Pendente' && isAtrasada(r)
                return (
                <tr key={r.id} className={`border-b border-[var(--bdr)]/60 hover:bg-[var(--sur2)]/60 text-[12.5px] ${atrasada ? 'bg-red-500/5' : ''}`} style={atrasada ? { borderLeft: '3px solid #ef4444' } : undefined}>
                  <td className="px-4 py-3 font-medium max-w-[220px] truncate" title={r.fundo}>{r.fundo}</td>
                  <td className="px-4 py-3">
                    <span className="text-[10.5px] font-mono bg-sky-500/10 text-sky-600 dark:text-sky-300 px-1.5 py-0.5 rounded-md">{r.ocorrencia}</span>
                  </td>
                  <td className="px-4 py-3 text-[var(--tx2)]">{r.responsavel || '—'}</td>
                  <td className="px-4 py-3"><PriorityBadge prioridade={r.prioridade} /></td>
                  <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                  <td className="px-4 py-3">
                    <input
                      key={r.id + '_' + (r.observacao || '')}
                      defaultValue={r.observacao || ''}
                      onBlur={(e) => { if (e.target.value !== (r.observacao || '')) updateObservacao(r.id, e.target.value) }}
                      placeholder="Ex: aguardando outra área…"
                      className="w-full min-w-[160px] bg-transparent border border-transparent hover:border-[var(--bdr)] focus:border-id-mid focus:bg-[var(--sur2)] rounded-md px-2 py-1 text-[11.5px] outline-none placeholder:text-[var(--tx4)]"
                    />
                  </td>
                  <td className={`px-4 py-3 font-mono ${atrasada ? 'text-red-500 font-semibold' : 'text-[var(--tx3)]'}`}>
                    {atrasada && '⚠ '}{timeAgo(r.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center gap-1.5 justify-end">
                      <button onClick={() => setDetailItem(r)} title="Ver detalhamento" className="opacity-70 hover:opacity-100 text-[var(--tx3)] hover:text-id-light">
                        <Info size={15} />
                      </button>
                      {r.slackLink && (
                        <a href={r.slackLink} target="_blank" rel="noreferrer" title="Abrir no Slack" className="opacity-80 hover:opacity-100">
                          <SlackIcon size={15} />
                        </a>
                      )}
                      <button onClick={() => concluir(r)} className="text-[11px] bg-id-mid/20 text-id-dark dark:text-id-light border border-id-mid/40 rounded-md px-2.5 py-1 hover:bg-id-mid/30">
                        Concluir
                      </button>
                    </div>
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-end px-4 py-2.5 text-[11px] text-[var(--tx3)] border-t border-[var(--bdr)]">
          {items.length} registros · exibindo só abertas
        </div>
      </Card>

      {showModal && (
        <NovaPendenciaModal
          responsaveis={responsaveis}
          ocorrencias={ocorrencias}
          fundos={fundosAll}
          onClose={() => setShowModal(false)}
          onSave={addPendencia}
        />
      )}

      {detailItem && <DetailModal item={detailItem} onClose={() => setDetailItem(null)} />}
    </div>
  )
}

function DetailField({ label, value }) {
  if (!value) return null
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-[var(--tx3)] mb-0.5">{label}</div>
      <div className="text-[13px] text-[var(--tx)] whitespace-pre-wrap break-words">{value}</div>
    </div>
  )
}

function DetailModal({ item, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-[var(--sur)] border border-[var(--bdr)] rounded-xl w-full max-w-[480px] shadow-card max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--bdr)]">
          <div>
            <div className="font-display font-semibold text-[15px]">{item.fundo}</div>
            <div className="text-[11px] text-[var(--tx3)]">{item.ocorrencia}</div>
          </div>
          <button onClick={onClose} className="text-[var(--tx3)] hover:text-[var(--tx)]"><X size={18} /></button>
        </div>
        <div className="p-5 flex flex-col gap-3.5">
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={item.status} />
            <PriorityBadge prioridade={item.prioridade} />
          </div>
          <DetailField label="Detalhamento" value={item.detalhamento} />
          <DetailField label="Observação" value={item.observacao} />
          <div className="grid grid-cols-2 gap-3">
            <DetailField label="Responsável" value={item.responsavel} />
            <DetailField label="CNPJ" value={item.cnpj} />
            <DetailField label="Alçada" value={item.alcada} />
            <DetailField label="Criado por" value={item.createdBy} />
          </div>
          {item.createdAt && <DetailField label="Aberta em" value={new Date(item.createdAt).toLocaleString('pt-BR')} />}
          {item.slackLink && (
            <a href={item.slackLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[12px] text-id-light hover:underline w-fit">
              <SlackIcon size={14} /> Abrir no Slack
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

function NovaPendenciaModal({ responsaveis, ocorrencias, fundos, onClose, onSave }) {
  const [fundo, setFundo] = useState('')
  const [fundoMatch, setFundoMatch] = useState(null)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [cnpj, setCnpj] = useState('')
  const [ocorrencia, setOcorrencia] = useState('')
  const [responsavel, setResponsavel] = useState('')
  const [novoResp, setNovoResp] = useState('')
  const [showNovoResp, setShowNovoResp] = useState(false)
  const [prioridade, setPrioridade] = useState('Média')
  const [detalhamento, setDetalhamento] = useState('')
  const [slackLink, setSlackLink] = useState('')
  const [error, setError] = useState('')

  const suggestions = useMemo(() => {
    const q = fundo.trim().toLowerCase()
    if (!q || (fundoMatch && fundoMatch.nome.toLowerCase() === q)) return []
    return (fundos || []).filter((f) => f.nome.toLowerCase().includes(q)).slice(0, 8)
  }, [fundo, fundoMatch, fundos])

  function pickFundo(f) {
    setFundo(f.nome)
    setCnpj(f.cnpj)
    setFundoMatch(f)
    setShowSuggestions(false)
  }
  function handleFundoChange(v) {
    setFundo(v)
    setFundoMatch(null)
    setShowSuggestions(true)
  }

  function handleSave() {
    if (!fundo.trim()) { setError('Informe o fundo.'); return }
    if (!ocorrencia) { setError('Selecione a ocorrência.'); return }
    if (!detalhamento.trim()) { setError('Descreva o detalhamento.'); return }
    const resp = showNovoResp && novoResp.trim() ? novoResp.trim() : responsavel
    onSave({ fundo: fundo.trim(), cnpj: cnpj.trim(), ocorrencia, responsavel: resp, alcada: 'Liquidação', prioridade, detalhamento: detalhamento.trim(), slackLink: slackLink.trim() })
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-[var(--sur)] border border-[var(--bdr)] rounded-xl w-full max-w-[520px] p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-[15px] font-semibold">Nova pendência</h2>
          <button onClick={onClose} className="text-[var(--tx3)] hover:text-[var(--tx)]"><X size={18} /></button>
        </div>

        <label className="block text-[10.5px] uppercase text-[var(--tx3)] mb-1">Fundo</label>
        <div className="relative mb-3">
          <input
            value={fundo}
            onChange={(e) => handleFundoChange(e.target.value)}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            placeholder="Digite para buscar o fundo do cadastro…"
            className="w-full bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-3 py-2 text-[12.5px] outline-none focus:border-id-mid"
          />
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-[var(--sur)] border border-[var(--bdr)] rounded-lg shadow-card max-h-[220px] overflow-y-auto">
              {suggestions.map((f) => (
                <button
                  key={f.cnpj + f.nome}
                  type="button"
                  onMouseDown={() => pickFundo(f)}
                  className="w-full text-left px-3 py-2 hover:bg-[var(--sur2)] flex items-start gap-2"
                >
                  <Building2 size={13} className="text-[var(--tx3)] shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <div className="text-[12px] truncate">{f.nome}</div>
                    <div className="text-[10.5px] text-[var(--tx3)]">{f.cnpj} · {f.gestor}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-[10.5px] uppercase text-[var(--tx3)] mb-1">CNPJ</label>
            {fundoMatch ? (
              <div className="w-full bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-3 py-2 text-[12.5px] text-[var(--tx2)]">{cnpj || 'Preenchido pelo cadastro'}</div>
            ) : (
              <input value={cnpj} onChange={(e) => setCnpj(e.target.value)} placeholder="00.000.000/0000-00" className="w-full bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-3 py-2 text-[12.5px] outline-none focus:border-id-mid" />
            )}
          </div>
          <div>
            <label className="block text-[10.5px] uppercase text-[var(--tx3)] mb-1">Ocorrência</label>
            <select value={ocorrencia} onChange={(e) => setOcorrencia(e.target.value)} className="w-full bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-3 py-2 text-[12.5px]">
              <option value="">Selecione…</option>
              {(ocorrencias?.length ? ocorrencias : OCORRENCIAS_DEFAULT).map((o) => <option key={o}>{o}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-[10.5px] uppercase text-[var(--tx3)]">Responsável</label>
              <button type="button" onClick={() => setShowNovoResp((s) => !s)} className="text-[10.5px] text-id-dark dark:text-id-light">+ incluir</button>
            </div>
            {showNovoResp ? (
              <input value={novoResp} onChange={(e) => setNovoResp(e.target.value)} placeholder="Nome do responsável" className="w-full bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-3 py-2 text-[12.5px] outline-none focus:border-id-mid" />
            ) : (
              <select value={responsavel} onChange={(e) => setResponsavel(e.target.value)} className="w-full bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-3 py-2 text-[12.5px]">
                <option value="">Selecione…</option>
                {responsaveis.map((r) => <option key={r}>{r}</option>)}
              </select>
            )}
          </div>
          <div>
            <label className="block text-[10.5px] uppercase text-[var(--tx3)] mb-1">Prioridade</label>
            <select value={prioridade} onChange={(e) => setPrioridade(e.target.value)} className="w-full bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-3 py-2 text-[12.5px]">
              {PRIORIDADES.map((p) => <option key={p}>{p}</option>)}
            </select>
          </div>
        </div>

        <label className="block text-[10.5px] uppercase text-[var(--tx3)] mb-1">Detalhamento *</label>
        <textarea value={detalhamento} onChange={(e) => setDetalhamento(e.target.value)} placeholder="Descreva a pendência…" rows={3} className="w-full bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-3 py-2 text-[12.5px] mb-3 outline-none focus:border-id-mid resize-none" />

        <label className="block text-[10.5px] uppercase text-[var(--tx3)] mb-1">Link do chamado (Slack)</label>
        <input value={slackLink} onChange={(e) => setSlackLink(e.target.value)} placeholder="https://idctvm.slack.com/archives/…" className="w-full bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-3 py-2 text-[12.5px] mb-1 outline-none focus:border-id-mid" />

        {error && <p className="text-[11.5px] text-red-500 mt-2">{error}</p>}

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="text-[12.5px] border border-[var(--bdr)] rounded-lg px-4 py-2 text-[var(--tx2)] hover:bg-[var(--sur2)]">Cancelar</button>
          <button onClick={handleSave} className="text-[12.5px] bg-id-dark hover:bg-id-mid text-white rounded-lg px-4 py-2 font-medium">Salvar</button>
        </div>
      </div>
    </div>
  )
}
