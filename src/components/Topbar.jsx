import { Search, Moon, Sun, Bell } from 'lucide-react'

const STATUS_LABEL = {
  connecting: 'Conectando…',
  ok: 'Tempo real ativo',
  offline: 'Firebase offline — modo local',
}
const STATUS_DOT = {
  connecting: 'bg-slate-500 animate-pulse',
  ok: 'bg-id-light',
  offline: 'bg-amber-500 animate-pulse',
}

export default function Topbar({ title, subtitle, status, dark, onToggleDark, search, onSearch }) {
  return (
    <header className="h-[56px] shrink-0 border-b border-bg-border bg-bg-panel/60 backdrop-blur flex items-center gap-3 px-5">
      <div className="min-w-0">
        <h1 className="font-display font-semibold text-[15px] leading-tight truncate">{title}</h1>
        {subtitle && <p className="text-[11px] text-slate-500 truncate">{subtitle}</p>}
      </div>

      <div className="ml-auto flex items-center gap-2">
        <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-slate-400 mr-1">
          <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[status]}`} />
          {STATUS_LABEL[status]}
        </div>

        {onSearch && (
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Buscar…"
              className="bg-bg-panel2 border border-bg-border rounded-lg pl-7 pr-3 py-1.5 text-[12px] w-[190px] outline-none focus:border-id-mid placeholder:text-slate-500"
            />
          </div>
        )}

        <button className="w-8 h-8 rounded-lg border border-bg-border flex items-center justify-center text-slate-400 hover:text-white hover:bg-bg-panel2">
          <Bell size={14} />
        </button>

        <button
          onClick={onToggleDark}
          className="w-8 h-8 rounded-lg border border-bg-border flex items-center justify-center text-slate-400 hover:text-white hover:bg-bg-panel2"
        >
          {dark ? <Sun size={14} /> : <Moon size={14} />}
        </button>
      </div>
    </header>
  )
}
