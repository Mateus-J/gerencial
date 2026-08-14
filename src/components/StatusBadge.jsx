const STYLES = {
  pendente: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  concluido: 'bg-id-mid/15 text-id-light border-id-mid/30',
  atrasado: 'bg-red-500/15 text-red-400 border-red-500/30',
  default: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
}

export default function StatusBadge({ status }) {
  const key = (status || '').toLowerCase()
  const cls = STYLES[key] || STYLES.default
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[10.5px] font-medium ${cls}`}>
      {status}
    </span>
  )
}
