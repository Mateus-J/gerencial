const STYLES = {
  pendente: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30',
  concluída: 'bg-id-mid/15 text-id-dark dark:text-id-light border-id-mid/30',
  concluido: 'bg-id-mid/15 text-id-dark dark:text-id-light border-id-mid/30',
  atrasado: 'bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30',
  default: 'bg-[var(--sur2)] text-[var(--tx2)] border-[var(--bdr)]',
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
