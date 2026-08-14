const ACCENTS = {
  neutral: 'border-bg-border',
  amber: 'border-amber-500/40',
  green: 'border-id-mid/40',
  blue: 'border-sky-500/40',
}

export default function KpiCard({ label, value, sub, accent = 'neutral' }) {
  return (
    <div className={`flex-1 min-w-[150px] bg-bg-panel border ${ACCENTS[accent]} rounded-xl px-4 py-3 shadow-card`}>
      <div className="text-[10.5px] font-semibold tracking-widest uppercase text-slate-500">{label}</div>
      <div className="font-display text-2xl font-semibold mt-1">{value}</div>
      {sub && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  )
}
