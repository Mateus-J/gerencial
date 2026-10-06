// Peças compartilhadas dos gráficos (Recharts): cores validadas para os dois
// temas, brilho, tooltip de vidro e legenda que liga/desliga séries.

import AnimatedNumber from '../AnimatedNumber'

// <defs> com gradiente (lavagem vertical) e brilho para cada cor usada.
// Uso: <NeonDefs id="evo" colors={{ pago: '#0ca30c' }} /> dentro do gráfico,
// depois fill={`url(#evo-pago)`} e filter="url(#evo-glow)".
export function NeonDefs({ id, colors }) {
  return (
    <defs>
      {Object.entries(colors).map(([k, c]) => (
        <linearGradient key={k} id={`${id}-${k}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={c} stopOpacity={0.32} />
          <stop offset="70%" stopColor={c} stopOpacity={0.06} />
          <stop offset="100%" stopColor={c} stopOpacity={0} />
        </linearGradient>
      ))}
      {Object.entries(colors).map(([k, c]) => (
        <linearGradient key={k + 'b'} id={`${id}-${k}-bar`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={c} stopOpacity={1} />
          <stop offset="100%" stopColor={c} stopOpacity={0.72} />
        </linearGradient>
      ))}
      <filter id={`${id}-glow`} x="-20%" y="-50%" width="140%" height="200%">
        <feGaussianBlur stdDeviation="3.5" result="b" />
        <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
    </defs>
  )
}

// Tooltip de vidro: valor em destaque, nome da série discreto, chave em traço.
export function GlassTooltip({ active, payload, label, format = (v) => v, labelFormat = (l) => l, names = {}, footer }) {
  if (!active || !payload?.length) return null
  const rows = payload.filter((p) => p.value != null && !p.hide)
  return (
    <div className="rounded-xl border border-[var(--bdr)] bg-[var(--sur)]/95 backdrop-blur-xl shadow-[var(--shadow-pop)] px-3 py-2.5 min-w-[200px] animate-fade-up">
      <div key={label} className="text-[10px] font-mono uppercase tracking-[.18em] text-[var(--tx3)] mb-1.5 animate-fade-up">{labelFormat(label)}</div>
      <div className="space-y-1">
        {rows.map((p) => (
          <div key={p.dataKey} className="flex items-center gap-2">
            <span className="w-3 h-[3px] rounded-full shrink-0" style={{ background: p.color || p.payload?.fill, boxShadow: `0 0 8px ${p.color || p.payload?.fill}` }} />
            <span className="font-display font-semibold text-[13px] text-[var(--tx)] tabular"><AnimatedNumber value={Number(p.value) || 0} format={(v) => format(v, p)} duration={320} /></span>
            <span className="text-[11px] text-[var(--tx3)] ml-auto pl-3">{names[p.dataKey] || p.name}</span>
          </div>
        ))}
      </div>
      {footer && <div className="mt-2 pt-1.5 border-t border-[var(--bdr)] text-[11px] text-[var(--tx2)]">{footer(rows)}</div>}
    </div>
  )
}

// Legenda clicável: mostra/esconde séries. A cor segue a série, nunca a posição.
export function LegendToggle({ items, hidden, onToggle, shape = 'rect' }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((it) => {
        const off = hidden.has(it.key)
        return (
          <button
            key={it.key}
            type="button"
            onClick={() => onToggle(it.key)}
            aria-pressed={!off}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-all ${off ? 'border-[var(--bdr)] text-[var(--tx4)] opacity-60' : 'border-[var(--bdr)] text-[var(--tx2)] bg-[var(--glass)] hover:text-[var(--tx)]'}`}
          >
            {it.icon ? <it.icon size={11} style={{ color: off ? undefined : it.color }} /> : null}
            <span
              className={shape === 'line' ? 'w-3 h-[3px] rounded-full' : 'w-2.5 h-2.5 rounded-[3px]'}
              style={{ background: off ? 'transparent' : it.color, border: off ? `1px solid ${it.color}` : 'none', boxShadow: off ? 'none' : `0 0 8px ${it.color}` }}
            />
            {it.label}
          </button>
        )
      })}
    </div>
  )
}
