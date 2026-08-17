const ACCENTS = {
  neutral: { border: 'border-[var(--bdr)]', text: 'text-[var(--tx2)]' },
  amber: { border: 'border-amber-500/40', text: 'text-amber-700 dark:text-amber-400' },
  green: { border: 'border-id-mid/40', text: 'text-id-dark dark:text-id-light' },
  blue: { border: 'border-sky-500/40', text: 'text-sky-700 dark:text-sky-400' },
}

export default function KpiCard({ label, value, sub, accent = 'neutral' }) {
  const a = ACCENTS[accent] || ACCENTS.neutral
  return (
    <div className={`flex-1 min-w-[150px] bg-[var(--sur)] border ${a.border} rounded-xl px-4 py-3 shadow-card`}>
      <div className={`text-[10.5px] font-semibold tracking-widest uppercase ${a.text}`}>{label}</div>
      <div className={`font-display text-2xl font-semibold mt-1 ${a.text}`}>{value}</div>
      {sub && <div className="text-[11px] text-[var(--tx3)] mt-0.5">{sub}</div>}
    </div>
  )
}
