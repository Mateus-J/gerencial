export function PageHeader({ eyebrow, title, description, meta, actions }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-5 animate-fade-up">
      <div className="min-w-0">
        {eyebrow && (
          <div className="flex items-center gap-2 text-[10.5px] font-mono font-medium tracking-[.22em] uppercase text-id-dark dark:text-id-light mb-1.5">
            <span className="w-4 h-px bg-current opacity-70" />{eyebrow}
          </div>
        )}
        <h2 className="font-display text-[26px] font-semibold tracking-tight bg-gradient-to-r from-[var(--tx)] to-[var(--tx2)] bg-clip-text text-transparent">{title}</h2>
        {description && <p className="text-[12.5px] text-[var(--tx3)] mt-0.5">{description}</p>}
        {meta && <div className="mt-2">{meta}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Card({ children, className = '', ...rest }) {
  return (
    <div className={`glass rounded-2xl ${className}`} {...rest}>
      {children}
    </div>
  )
}

// Usado nas páginas ainda não migradas do app antigo — deixa a navegação e o
// layout prontos, só falta portar a lógica/dados daquela aba específica.
export function EmptyState({ icon: Icon, title, description }) {
  return (
    <Card className="p-10 flex flex-col items-center text-center gap-2">
      {Icon && <Icon size={26} className="text-[var(--tx4)] mb-1" />}
      <div className="font-medium text-[var(--tx2)]">{title}</div>
      <p className="text-[12px] text-[var(--tx3)] max-w-[360px]">{description}</p>
    </Card>
  )
}
