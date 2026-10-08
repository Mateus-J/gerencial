// Cartões compartilhados pelas telas de taxas (ADM, Anbima): destaque com
// barra de participação, mini-indicador, ranking com hover e fundo de modal.
import { useEffect, useState } from 'react'
import { Card } from '../PageShell'
import AnimatedNumber from '../AnimatedNumber'
import { fmtShort } from '../../lib/taxaCore'

export const TONES = {
  green: { icon: 'bg-id-mid/15 text-id-dark dark:text-id-light', value: 'text-id-dark dark:text-id-light', bar: 'bg-id-light' },
  amber: { icon: 'bg-amber-500/15 text-amber-600 dark:text-amber-400', value: 'text-amber-600 dark:text-amber-400', bar: 'bg-amber-400' },
  red: { icon: 'bg-red-500/15 text-red-600 dark:text-red-400', value: 'text-red-600 dark:text-red-400', bar: 'bg-red-400' },
  neutral: { icon: 'bg-[var(--sur2)] text-[var(--tx3)]', value: 'text-[var(--tx)]', bar: 'bg-[var(--tx4)]' },
}

// Cartão de número com rodapé: barra de participação no total + detalhes,
// todos alinhados pelo topo (o botão não centraliza mais o conteúdo).
export function StatCard({ icon: Icon, tone = 'neutral', label, value, share, details = [], onClick, hint }) {
  const t = TONES[tone]
  const Tag = onClick ? 'button' : 'div'
  return (
    <Card className="p-0 h-full">
      <Tag onClick={onClick} title={hint} className="w-full h-full text-left p-5 rounded-2xl transition-colors hover:bg-[var(--sur2)]/40 flex flex-col justify-start items-stretch">
        <div className="flex items-center gap-2">
          <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${t.icon}`}><Icon size={15} /></span>
          <span className="text-[10px] font-mono font-medium tracking-[.16em] uppercase text-[var(--tx3)]">{label}</span>
          {share != null && <span className="ml-auto text-[11px] font-mono text-[var(--tx3)]">{share.toFixed(1).replace('.', ',')}% do total</span>}
        </div>
        <div className={`font-display text-[26px] leading-tight font-semibold tracking-tight mt-3 glow-text whitespace-nowrap ${t.value}`}>{value}</div>
        <div className="mt-auto pt-4">
          {share != null && (
            <div className="h-1.5 rounded-full bg-[var(--sur2)] overflow-hidden mb-3">
              <div className={`h-full rounded-full grow-x transition-[width] duration-700 ease-out ${t.bar}`} style={{ width: Math.min(100, Math.max(0, share)) + '%' }} />
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            {details.map(([k, v, cls]) => (
              <div key={k} className="min-w-0">
                <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--tx4)] truncate">{k}</div>
                <div className={`text-[13px] font-semibold tabular truncate ${cls || 'text-[var(--tx2)]'}`}>{v}</div>
              </div>
            ))}
          </div>
        </div>
      </Tag>
    </Card>
  )
}

export function MiniStat({ icon: Icon, label, value, tone, onClick }) {
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

export function RankCard({ title, tone, items, empty, onPick }) {
  const max = items[0]?.value || 1
  const [hover, setHover] = useState(-1)
  return (
    <Card className="p-4">
      <div className="text-[12.5px] font-semibold mb-3">{title}</div>
      <div className="space-y-1" onMouseLeave={() => setHover(-1)}>
        {items.map((f, i) => {
          const on = hover === i
          const dim = hover >= 0 && !on
          return (
            <button key={f.name} onClick={() => onPick(f.name)} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(-1)}
              className={`w-full text-left rounded-lg px-2 py-1.5 transition-all duration-300 ${on ? 'bg-[var(--sur2)] translate-x-1' : ''} ${dim ? 'opacity-45' : ''}`}>
              <div className="flex items-center gap-2 text-[11.5px]">
                <span className={`flex-1 truncate transition-colors duration-300 ${on ? 'text-[var(--tx)]' : 'text-[var(--tx2)]'}`}>{f.name}</span>
                <span className={`font-mono tabular ${TONES[tone].value}`}><AnimatedNumber value={f.value} format={fmtShort} /></span>
              </div>
              <div className="h-1.5 mt-1 rounded-full bg-[var(--sur2)] overflow-hidden">
                <div className={`h-full rounded-full grow-x transition-[width,box-shadow] duration-700 ease-out ${TONES[tone].bar}`}
                  style={{ width: Math.max(3, (f.value / max) * 100) + '%', boxShadow: on ? '0 0 14px currentColor' : '0 0 6px currentColor' }} />
              </div>
            </button>
          )
        })}
        {!items.length && <div className="text-[12px] text-[var(--tx3)]">{empty}</div>}
      </div>
    </Card>
  )
}

export function Overlay({ children, onClose, side }) {
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
