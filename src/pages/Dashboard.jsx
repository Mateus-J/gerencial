import { useEffect, useMemo, useState } from 'react'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { Plus, X, MessageCircle, Building2 } from 'lucide-react'
import { db } from '../lib/firebase'
import { PageHeader, Card } from '../components/PageShell'
import KpiCard from '../components/KpiCard'
import StatusBadge from '../components/StatusBadge'
import { useAuth } from '../context/AuthContext'
import { useFundos } from '../hooks/useFundos'

const PEND_DOC = () => doc(db, 'controle', 'pendencias')
const HIST_DOC = () => doc(db, 'controle', 'pendencias_historico')

const OCORRENCIAS_DEFAULT = ['Pagamento de Nota', 'Taxa de Administração', 'Movimentação', 'Documentação', 'Outro']
const ALCADAS_DEFAULT = ['Liquidação', 'Backoffice', 'Custódia Lastro']

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

export default function Dashboard() {
  const { currentUser } = useAuth()
  const { all: fundosAll } = useFundos()
  const [items, setItems] = useState([])
  const [responsaveis, setResponsaveis] = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [, forceTick] = useState(0)

  useEffect(() => {
    let mounted = true
    getDoc(PEND_DOC())
      .then((snap) => {
        if (!mounted || !snap.exists()) return
        setItems(snap.data().items || [])
        setResponsaveis(snap.data().responsaveis || [])
      })
      .catch((e) => console.warn('pendLoad err', e))
      .finally(() => mounted && setLoading(false))
    // Atualiza a coluna "Tempo" a cada minuto
    const t = setInterval(() => forceTick((x) => x + 1), 60000)
    return () => { mounted = false; clearInterval(t) }
  }, [])

  function persist(nextItems, nextResp) {
    setItems(nextItems)
    if (nextResp) setResponsaveis(nextResp)
    setDoc(PEND_DOC(), { items: nextItems, responsaveis: nextResp || responsaveis }, { merge: false }).catch((e) => console.warn('pendSave err', e))
  }

  async function addPendencia(data) {
    const item = { id: 'pd' + Date.now(), status: 'Pendente', createdAt: Date.now(), createdBy: currentUser?.name || currentUser?.username, ...data }
    const nextResp = data.responsavel && !responsaveis.includes(data.responsavel) ? [...responsaveis, data.responsavel] : responsaveis
    persist([item, ...items], nextResp)
    setShowModal(false)
  }

  async function concluir(item) {
    const remaining = items.filter((i) => i.id !== item.id)
    persist(remaining)
    const concluded = { ...item, status: 'Concluída', concluidoPor: currentUser?.name || currentUser?.username, concluidoEm: Date.now(), dataFinalizacao: item.dataFinalizacao || new Date().toISOString().slice(0, 10) }
    try {
      const snap = await getDoc(HIST_DOC())
      const hist = snap.exists() ? snap.data().items || [] : []
      await setDoc(HIST_DOC(), { items: [concluded, ...hist] }, { merge: false })
    } catch (e) { console.warn('histSave err', e) }
  }

  const rows = useMemo(() => items.filter((r) => (r.fundo || '').toLowerCase().includes(q.toLowerCase()) || (r.detalhamento || '').toLowerCase().includes(q.toLowerCase())), [items, q])
  const pendentes = items.filter((r) => r.status === 'Pendente').length
  const concluidasHoje = 0 // concluídas saem da lista e vão pro histórico

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
        <KpiCard label="Total" value={items.length} sub="registros em aberto" accent="blue" />
      </div>

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
                <th className="px-4 py-2.5 font-medium">Alçada</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Tempo</th>
                <th className="px-4 py-2.5 font-medium text-right"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="text-center py-10 text-[var(--tx3)]">Carregando…</td></tr>
              ) : !rows.length ? (
                <tr><td colSpan={7} className="text-center py-10 text-[var(--tx3)]">{items.length ? 'Nenhum resultado.' : 'Nenhuma pendência em aberto. Clique em "Nova pendência" para começar.'}</td></tr>
              ) : rows.map((r) => (
                <tr key={r.id} className="border-b border-[var(--bdr)]/60 hover:bg-[var(--sur2)]/60 text-[12.5px]">
                  <td className="px-4 py-3 font-medium max-w-[220px] truncate" title={r.fundo}>{r.fundo}</td>
                  <td className="px-4 py-3">
                    <span className="text-[10.5px] font-mono bg-sky-500/10 text-sky-600 dark:text-sky-300 px-1.5 py-0.5 rounded-md">{r.ocorrencia}</span>
                  </td>
                  <td className="px-4 py-3 text-[var(--tx2)]">{r.responsavel || '—'}</td>
                  <td className="px-4 py-3">
                    <span className="text-[10.5px] font-mono bg-[var(--sur2)] border border-[var(--bdr)] px-1.5 py-0.5 rounded-md text-[var(--tx3)]">{r.alcada}</span>
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                  <td className="px-4 py-3 text-[var(--tx3)] font-mono">{timeAgo(r.createdAt)}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center gap-1.5 justify-end">
                      {r.slackLink && (
                        <a href={r.slackLink} target="_blank" rel="noreferrer" title="Abrir no Slack" className="text-[var(--tx3)] hover:text-[#4A154B] dark:hover:text-purple-300">
                          <MessageCircle size={14} />
                        </a>
                      )}
                      <button onClick={() => concluir(r)} className="text-[11px] bg-id-mid/20 text-id-dark dark:text-id-light border border-id-mid/40 rounded-md px-2.5 py-1 hover:bg-id-mid/30">
                        Concluir
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
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
          fundos={fundosAll}
          onClose={() => setShowModal(false)}
          onSave={addPendencia}
        />
      )}
    </div>
  )
}

function NovaPendenciaModal({ responsaveis, fundos, onClose, onSave }) {
  const [fundo, setFundo] = useState('')
  const [fundoMatch, setFundoMatch] = useState(null)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [cnpj, setCnpj] = useState('')
  const [ocorrencia, setOcorrencia] = useState(OCORRENCIAS_DEFAULT[0])
  const [responsavel, setResponsavel] = useState('')
  const [novoResp, setNovoResp] = useState('')
  const [showNovoResp, setShowNovoResp] = useState(false)
  const [alcada, setAlcada] = useState(ALCADAS_DEFAULT[0])
  const [detalhamento, setDetalhamento] = useState('')
  const [slackLink, setSlackLink] = useState('')
  const [dataFinalizacao, setDataFinalizacao] = useState('')
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
    if (!detalhamento.trim()) { setError('Descreva o detalhamento.'); return }
    const resp = showNovoResp && novoResp.trim() ? novoResp.trim() : responsavel
    onSave({ fundo: fundo.trim(), cnpj: cnpj.trim(), ocorrencia, responsavel: resp, alcada, detalhamento: detalhamento.trim(), slackLink: slackLink.trim(), dataFinalizacao })
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
              {OCORRENCIAS_DEFAULT.map((o) => <option key={o}>{o}</option>)}
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
            <label className="block text-[10.5px] uppercase text-[var(--tx3)] mb-1">Alçada</label>
            <select value={alcada} onChange={(e) => setAlcada(e.target.value)} className="w-full bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-3 py-2 text-[12.5px]">
              {ALCADAS_DEFAULT.map((a) => <option key={a}>{a}</option>)}
            </select>
          </div>
        </div>

        <label className="block text-[10.5px] uppercase text-[var(--tx3)] mb-1">Detalhamento *</label>
        <textarea value={detalhamento} onChange={(e) => setDetalhamento(e.target.value)} placeholder="Descreva a pendência…" rows={3} className="w-full bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-3 py-2 text-[12.5px] mb-3 outline-none focus:border-id-mid resize-none" />

        <label className="block text-[10.5px] uppercase text-[var(--tx3)] mb-1">Link do chamado (Slack)</label>
        <input value={slackLink} onChange={(e) => setSlackLink(e.target.value)} placeholder="https://idctvm.slack.com/archives/…" className="w-full bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-3 py-2 text-[12.5px] mb-3 outline-none focus:border-id-mid" />

        <div className="grid grid-cols-2 gap-3 mb-1">
          <div>
            <label className="block text-[10.5px] uppercase text-[var(--tx3)] mb-1">Status</label>
            <div className="w-full bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-3 py-2 text-[12.5px] text-[var(--tx3)]">Pendente</div>
          </div>
          <div>
            <label className="block text-[10.5px] uppercase text-[var(--tx3)] mb-1">Data de finalização</label>
            <input type="date" value={dataFinalizacao} onChange={(e) => setDataFinalizacao(e.target.value)} className="w-full bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg px-3 py-2 text-[12.5px]" />
          </div>
        </div>

        {error && <p className="text-[11.5px] text-red-500 mt-2">{error}</p>}

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="text-[12.5px] border border-[var(--bdr)] rounded-lg px-4 py-2 text-[var(--tx2)] hover:bg-[var(--sur2)]">Cancelar</button>
          <button onClick={handleSave} className="text-[12.5px] bg-id-dark hover:bg-id-mid text-white rounded-lg px-4 py-2 font-medium">Salvar</button>
        </div>
      </div>
    </div>
  )
}
