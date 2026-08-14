export function PageHeader({ eyebrow, title, actions }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div>
        {eyebrow && (
          <div className="text-[10.5px] font-semibold tracking-widest uppercase text-id-light/80 mb-0.5">
            {eyebrow}
          </div>
        )}
        <h2 className="font-display text-xl font-semibold">{title}</h2>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Card({ children, className = '' }) {
  return (
    <div className={`bg-bg-panel border border-bg-border rounded-xl shadow-card ${className}`}>
      {children}
    </div>
  )
}

// Usado nas páginas ainda não migradas do app antigo — deixa a navegação e o
// layout prontos, só falta portar a lógica/dados daquela aba específica.
export function EmptyState({ icon: Icon, title, description }) {
  return (
    <Card className="p-10 flex flex-col items-center text-center gap-2">
      {Icon && <Icon size={26} className="text-slate-600 mb-1" />}
      <div className="font-medium text-slate-300">{title}</div>
      <p className="text-[12px] text-slate-500 max-w-[360px]">{description}</p>
    </Card>
  )
}
