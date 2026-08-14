import { useEffect, useMemo, useState } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { PageHeader, Card } from '../components/PageShell'
import StatusBadge from '../components/StatusBadge'
import SlackIcon from '../components/SlackIcon'

const HIST_DOC = () => doc(db, 'controle', 'pendencias_historico')

function fmtDate(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleDateString('pt-BR') + ' ' + new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

export default function Historico() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')

  useEffect(() => {
    let mounted = true
    getDoc(HIST_DOC())
      .then((snap) => { if (mounted && snap.exists()) setItems(snap.data().items || []) })
      .catch((e) => console.warn('histLoad err', e))
      .finally(() => mounted && setLoading(false))
    return () => { mounted = false }
  }, [])

  const rows = useMemo(
    () => items.filter((r) => (r.fundo || '').toLowerCase().includes(q.toLowerCase()) || (r.concluidoPor || '').toLowerCase().includes(q.toLowerCase())),
    [items, q]
  )

  return (
    <div>
      <PageHeader eyebrow="Sistema" title="Histórico" subtitle="Pendências concluídas" />

      <Card>
        <div className="p-3 border-b border-[var(--bdr)]">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar fundo ou quem concluiu…"
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
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Concluído por</th>
                <th className="px-4 py-2.5 font-medium">Concluído em</th>
                <th className="px-4 py-2.5 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="text-center py-10 text-[var(--tx3)]">Carregando…</td></tr>
              ) : !rows.length ? (
                <tr><td colSpan={7} className="text-center py-10 text-[var(--tx3)]">{items.length ? 'Nenhum resultado.' : 'Nenhuma pendência concluída ainda.'}</td></tr>
              ) : rows.map((r) => (
                <tr key={r.id} className="border-b border-[var(--bdr)]/60 hover:bg-[var(--sur2)]/60 text-[12.5px]">
                  <td className="px-4 py-3 font-medium max-w-[220px] truncate" title={r.fundo}>{r.fundo}</td>
                  <td className="px-4 py-3">
                    <span className="text-[10.5px] font-mono bg-sky-500/10 text-sky-600 dark:text-sky-300 px-1.5 py-0.5 rounded-md">{r.ocorrencia}</span>
                  </td>
                  <td className="px-4 py-3 text-[var(--tx2)]">{r.responsavel || '—'}</td>
                  <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                  <td className="px-4 py-3 text-[var(--tx2)] font-medium">{r.concluidoPor || '—'}</td>
                  <td className="px-4 py-3 text-[var(--tx3)]">{fmtDate(r.concluidoEm)}</td>
                  <td className="px-4 py-3">
                    {r.slackLink && (
                      <a href={r.slackLink} target="_blank" rel="noreferrer" title="Abrir no Slack" className="opacity-80 hover:opacity-100">
                        <SlackIcon size={15} />
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2.5 text-[11px] text-[var(--tx3)] border-t border-[var(--bdr)]">{rows.length} de {items.length} registros</div>
      </Card>
    </div>
  )
}
