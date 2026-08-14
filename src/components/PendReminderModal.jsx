import { BellRing, X } from 'lucide-react'
import SlackIcon from './SlackIcon'

export default function PendReminderModal({ items, onClose }) {
  if (!items) return null
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] p-4" onClick={onClose}>
      <div className="bg-[var(--sur)] border border-[var(--bdr)] rounded-xl w-full max-w-[520px] max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--bdr)]">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-amber-500/15 flex items-center justify-center">
              <BellRing size={16} className="text-amber-500" />
            </div>
            <div>
              <div className="font-display font-semibold text-[14px]">Lembrete de pendências</div>
              <div className="text-[11px] text-[var(--tx3)]">{items.length} em aberto agora</div>
            </div>
          </div>
          <button onClick={onClose} className="text-[var(--tx3)] hover:text-[var(--tx)]"><X size={18} /></button>
        </div>

        <div className="overflow-y-auto flex-1 divide-y divide-[var(--bdr)]/60">
          {items.map((r) => (
            <div key={r.id} className="px-5 py-3 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-[12.5px] font-medium truncate">{r.fundo}</div>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <span className="text-[10.5px] font-mono bg-sky-500/10 text-sky-600 dark:text-sky-300 px-1.5 py-0.5 rounded-md">{r.ocorrencia}</span>
                  <span className="text-[10.5px] text-[var(--tx3)] font-mono">⏱ {r.tempo}</span>
                  {r.responsavel && <span className="text-[10.5px] text-[var(--tx3)]">👤 {r.responsavel}</span>}
                </div>
              </div>
              {r.slackLink && (
                <a href={r.slackLink} target="_blank" rel="noreferrer" title="Abrir no Slack" className="opacity-80 hover:opacity-100 shrink-0 mt-0.5">
                  <SlackIcon size={16} />
                </a>
              )}
            </div>
          ))}
        </div>

        <div className="px-5 py-3 border-t border-[var(--bdr)] flex justify-end">
          <button onClick={onClose} className="text-[12.5px] bg-id-dark hover:bg-id-mid text-white rounded-lg px-4 py-2 font-medium">Ok, entendi</button>
        </div>
      </div>
    </div>
  )
}
