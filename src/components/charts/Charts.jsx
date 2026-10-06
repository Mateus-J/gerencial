// Gráficos do painel — mesmo visual em todas as abas: linhas de 2px com
// brilho, lavagem em gradiente, barras finas (máx. 24px) com ponta arredondada,
// grade em fio, tooltip de vidro, legenda que liga/desliga séries e barra de
// zoom embaixo para navegar pelo período.
import { useMemo, useState } from 'react'
import {
  ResponsiveContainer, ComposedChart, AreaChart, BarChart, Cell, Area, Bar, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Brush, ReferenceLine,
} from 'recharts'
import { NeonDefs, GlassTooltip, LegendToggle } from './ChartKit'
import { useChartTheme, toggleIn } from './theme'
import AnimatedNumber from '../AnimatedNumber'

const ANIM = { isAnimationActive: true, animationDuration: 900, animationEasing: 'ease-out' }
const shortMoney = (v) => {
  v = Number(v) || 0
  const a = Math.abs(v)
  return a >= 1e6 ? (v / 1e6).toFixed(1).replace('.', ',') + 'M' : a >= 1e3 ? (v / 1e3).toFixed(0) + 'K' : v.toFixed(0)
}

function Axes({ t, xKey, yFormat, yWidth = 44 }) {
  yFormat = yFormat || shortMoney
  return (
    <>
      <CartesianGrid stroke={t.grid} vertical={false} />
      <XAxis dataKey={xKey} tick={{ fontSize: 10.5, fill: t.axis, fontFamily: 'JetBrains Mono, monospace' }} axisLine={false} tickLine={false} tickMargin={8} minTickGap={12} />
      <YAxis tick={{ fontSize: 10.5, fill: t.axis, fontFamily: 'JetBrains Mono, monospace' }} tickFormatter={yFormat} axisLine={false} tickLine={false} width={yWidth} />
    </>
  )
}

function ZoomBrush({ t, xKey, len, keep }) {
  if (len <= keep) return null
  return (
    <Brush
      dataKey={xKey}
      height={22}
      travellerWidth={8}
      startIndex={Math.max(0, len - keep)}
      endIndex={len - 1}
      stroke={t.cursor}
      fill={t.dark ? 'rgba(15,20,27,.6)' : 'rgba(255,255,255,.6)'}
      tickFormatter={() => ''}
    />
  )
}

/* Séries empilhadas ao longo do tempo, como área (fluxo) ou colunas.
   series: [{ key, label, color, icon? }] */
export function StackedTimeChart({ data, xKey = 'mes', series, kind = 'area', format, yFormat, height = 300, keep = 14, selected, onSelect, id = 'stk', legend = series.length > 1 }) {
  const t = useChartTheme()
  const [hidden, setHidden] = useState(() => new Set())
  const colors = Object.fromEntries(series.map((s) => [s.key, s.color]))
  const names = Object.fromEntries(series.map((s) => [s.key, s.label]))
  const visible = series.filter((s) => !hidden.has(s.key))
  const click = (e) => { const x = e?.activeLabel ?? e?.activePayload?.[0]?.payload?.[xKey]; if (x && onSelect) onSelect(x) }
  const tooltip = (
    <Tooltip
      cursor={kind === 'area' ? { stroke: t.cursor, strokeWidth: 1 } : { fill: t.band }}
      content={<GlassTooltip format={format} names={names} footer={visible.length > 1 ? (rows) => <span className="flex justify-between gap-3"><span className="text-[var(--tx3)]">Total</span><span className="font-semibold tabular">{format(rows.reduce((a, r) => a + (Number(r.value) || 0), 0))}</span></span> : undefined} />}
    />
  )
  return (
    <div>
      {legend && <div className="mb-3"><LegendToggle items={series} hidden={hidden} onToggle={(k) => setHidden((h) => toggleIn(h, k))} shape={kind === 'area' ? 'line' : 'rect'} /></div>}
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          {kind === 'area' ? (
            <ComposedChart key={data.length} data={data} onClick={click} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} className="cursor-crosshair">
              <NeonDefs id={id} colors={colors} />
              <Axes t={t} xKey={xKey} yFormat={yFormat} />
              {tooltip}
              {selected && <ReferenceLine x={selected} stroke={t.cursor} strokeWidth={1} />}
              {visible.map((s) => (
                <Area key={s.key} type="monotone" dataKey={s.key} stackId="1" stroke={s.color} strokeWidth={2} fill={`url(#${id}-${s.key})`}
                  filter={`url(#${id}-glow)`} dot={false} activeDot={{ r: 5, fill: s.color, stroke: t.surface, strokeWidth: 2 }} {...ANIM} />
              ))}
              <ZoomBrush t={t} xKey={xKey} len={data.length} keep={keep} />
            </ComposedChart>
          ) : (
            <BarChart key={data.length} data={data} onClick={click} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="28%">
              <NeonDefs id={id} colors={colors} />
              <Axes t={t} xKey={xKey} yFormat={yFormat} />
              {tooltip}
              {visible.map((s, i) => (
                <Bar key={s.key} dataKey={s.key} stackId="1" fill={`url(#${id}-${s.key}-bar)`} maxBarSize={24}
                  stroke={t.surface} strokeWidth={2} radius={i === visible.length - 1 ? [4, 4, 0, 0] : 0}
                  activeBar={{ fill: s.color, filter: `url(#${id}-glow)` }} className="cursor-pointer" {...ANIM}>
                  {selected && data.map((d) => <Cell key={d[xKey]} fillOpacity={d[xKey] === selected ? 1 : 0.45} />)}
                </Bar>
              ))}
              <ZoomBrush t={t} xKey={xKey} len={data.length} keep={keep} />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  )
}

/* Rosca interativa, desenhada em SVG próprio para a interação ser fluida:
   a fatia sob o ponteiro desliza para fora com brilho, as outras esmaecem
   com transição, e o valor do centro "conta" até o número novo. */
const DONUT = { size: 200, rOut: 88, rIn: 60, pad: 0.014, pop: 7 }
function arcPath(a0, a1, rOut, rIn) {
  const c = DONUT.size / 2
  const p = (r, a) => [c + r * Math.sin(a), c - r * Math.cos(a)]
  const large = a1 - a0 > Math.PI ? 1 : 0
  const [x0, y0] = p(rOut, a0), [x1, y1] = p(rOut, a1), [x2, y2] = p(rIn, a1), [x3, y3] = p(rIn, a0)
  return `M${x0},${y0} A${rOut},${rOut} 0 ${large} 1 ${x1},${y1} L${x2},${y2} A${rIn},${rIn} 0 ${large} 0 ${x3},${y3} Z`
}

export function DonutChart({ data, format, colors, height = 190, onPick, centerLabel = 'Total' }) {
  const t = useChartTheme()
  const [hover, setHover] = useState(-1)
  const total = data.reduce((a, d) => a + d.value, 0)
  const cur = hover >= 0 ? data[hover] : null
  const colorOf = (i, d) => (d.name === 'Outros' ? t.other : colors[i % colors.length])
  const slices = useMemo(() => {
    let a = 0
    return data.map((d) => {
      const span = total > 0 ? (d.value / total) * Math.PI * 2 : 0
      const a0 = a, a1 = a + span
      a = a1
      const pad = span > DONUT.pad * 3 ? DONUT.pad : 0
      const mid = (a0 + a1) / 2
      return { d, path: span >= Math.PI * 2 - 1e-6 ? null : arcPath(a0 + pad / 2, a1 - pad / 2, DONUT.rOut, DONUT.rIn), dx: Math.sin(mid) * DONUT.pop, dy: -Math.cos(mid) * DONUT.pop }
    })
  }, [data, total])
  const ease = 'cubic-bezier(.22,.8,.24,1)'

  return (
    <div>
      <div className="relative flex items-center justify-center" style={{ height }} onMouseLeave={() => setHover(-1)}>
        <svg viewBox={`-10 -10 ${DONUT.size + 20} ${DONUT.size + 20}`} className="h-full overflow-visible" role="img" aria-label="Distribuição por classificação">
          {slices.map(({ d, path, dx, dy }, i) => {
            const on = hover === i
            const dim = hover >= 0 && !on
            const c = colorOf(i, d)
            return (
              <g key={d.name} className="donut-slice" style={{ animationDelay: `${i * 70}ms` }}>
                <g
                  onMouseEnter={() => setHover(i)}
                  onClick={() => onPick?.(d.name)}
                  className="cursor-pointer"
                  style={{
                    transform: on ? `translate(${dx}px, ${dy}px)` : 'translate(0px, 0px)',
                    opacity: dim ? 0.32 : 1,
                    filter: on ? `drop-shadow(0 0 7px ${c})` : 'drop-shadow(0 0 0 transparent)',
                    transition: `transform .35s ${ease}, opacity .3s ease, filter .35s ease`,
                  }}
                >
                  {path
                    ? <path d={path} fill={c} stroke={t.surface} strokeWidth={1.5} strokeLinejoin="round" />
                    : <circle cx={DONUT.size / 2} cy={DONUT.size / 2} r={(DONUT.rOut + DONUT.rIn) / 2} fill="none" stroke={c} strokeWidth={DONUT.rOut - DONUT.rIn} />}
                </g>
              </g>
            )
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center px-16">
          <div key={cur ? cur.name : '_total'} className="text-[9.5px] font-mono uppercase tracking-[.18em] text-[var(--tx3)] truncate max-w-full animate-fade-up">{cur ? cur.name : centerLabel}</div>
          <div className="font-display text-[15px] font-semibold tracking-tight tabular"><AnimatedNumber value={cur ? cur.value : total} format={format} duration={450} /></div>
          <div className="text-[11px] text-[var(--tx3)] h-4 transition-opacity duration-300" style={{ opacity: cur ? 1 : 0 }}>
            {cur ? `${total ? ((cur.value / total) * 100).toFixed(1).replace('.', ',') : 0}%` : ''}
          </div>
        </div>
      </div>
      <div className="space-y-0.5 mt-2">
        {data.map((d, i) => (
          <button key={d.name} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(-1)} onFocus={() => setHover(i)} onBlur={() => setHover(-1)} onClick={() => onPick?.(d.name)}
            className={`w-full flex items-center gap-2 text-[11.5px] rounded-md px-1.5 py-1 transition-all duration-300 ${hover === i ? 'bg-[var(--sur2)] translate-x-1' : 'hover:bg-[var(--sur2)]'} ${hover >= 0 && hover !== i ? 'opacity-60' : ''}`}>
            <span className="w-2.5 h-2.5 rounded-[3px] shrink-0 transition-shadow duration-300" style={{ background: colorOf(i, d), boxShadow: hover === i ? `0 0 10px ${colorOf(i, d)}` : 'none' }} />
            <span className="truncate flex-1 text-left text-[var(--tx2)]">{d.name}</span>
            <span className="font-mono text-[var(--tx3)] tabular">{total ? ((d.value / total) * 100).toFixed(0) : 0}%</span>
          </button>
        ))}
      </div>
    </div>
  )
}

/* Linha mínima de tendência (sem eixos) para cartões de número. */
export function Sparkline({ data, dataKey = 'v', color, height = 44, id = 'spark' }) {
  const t = useChartTheme()
  const c = color || (t.dark ? '#8FB352' : '#44723E')
  const last = data.length - 1
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 6, right: 6, left: 6, bottom: 2 }}>
          <NeonDefs id={id} colors={{ s: c }} />
          <Area type="monotone" dataKey={dataKey} stroke={c} strokeWidth={2} fill={`url(#${id}-s)`} filter={`url(#${id}-glow)`}
            dot={(p) => (p.index === last ? <circle key="end" cx={p.cx} cy={p.cy} r={4} fill={c} stroke={t.surface} strokeWidth={2} /> : <g key={p.index} />)}
            {...ANIM} animationDuration={1200} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

/* Linhas simples (ex.: total × recebido) com o mesmo acabamento. */
export function LinesChart({ data, xKey = 'mes', series, format, height = 240, keep = 14, id = 'ln' }) {
  const t = useChartTheme()
  const [hidden, setHidden] = useState(() => new Set())
  const colors = useMemo(() => Object.fromEntries(series.map((s) => [s.key, s.color])), [series])
  const names = Object.fromEntries(series.map((s) => [s.key, s.label]))
  return (
    <div>
      <div className="mb-3"><LegendToggle items={series} hidden={hidden} onToggle={(k) => setHidden((h) => toggleIn(h, k))} shape="line" /></div>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart key={data.length} data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <NeonDefs id={id} colors={colors} />
            <Axes t={t} xKey={xKey} />
            <Tooltip cursor={{ stroke: t.cursor, strokeWidth: 1 }} content={<GlassTooltip format={format} names={names} />} />
            {series.filter((s) => !hidden.has(s.key)).map((s, i) => (
              i === 0
                ? <Area key={s.key} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={2} fill={`url(#${id}-${s.key})`} filter={`url(#${id}-glow)`} dot={false} activeDot={{ r: 5, fill: s.color, stroke: t.surface, strokeWidth: 2 }} {...ANIM} />
                : <Line key={s.key} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={2} filter={`url(#${id}-glow)`} dot={false} activeDot={{ r: 5, fill: s.color, stroke: t.surface, strokeWidth: 2 }} {...ANIM} />
            ))}
            <ZoomBrush t={t} xKey={xKey} len={data.length} keep={keep} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
