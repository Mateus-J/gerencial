import { Search, Moon, Sun, Bell } from 'lucide-react'
import { colorForUser, initialsFor } from '../hooks/usePresence'

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

function PresenceAvatars({ users }) {
  if (!users.length) return null
  const shown = users.slice(0, 4)
  const extra = users.length - shown.length
  return (
    <div className="hidden sm:flex items-center gap-1 mr-1.5">
      {shown.map((u) => (
        <div
          key={u.username}
          title={u.name + (u.active ? ' · ativo agora' : ' · com o sistema aberto')}
          style={{ backgroundColor: colorForUser(u.username), '--presence-color': colorForUser(u.username) }}
          className={`w-6 h-6 rounded-full flex items-center justify-center text-[9.5px] font-semibold text-white ${u.active ? 'presence-active' : ''}`}
        >
          {initialsFor(u.name)}
        </div>
      ))}
      {extra > 0 && (
        <div className="w-6 h-6 rounded-full flex items-center justify-center text-[9.5px] font-semibold bg-[var(--sur2)] text-[var(--tx3)]">
          +{extra}
        </div>
      )}
    </div>
  )
}

export default function Topbar({ title, subtitle, status, dark, onToggleDark, search, onSearch, presence = [] }) {
  return (
    <header className="h-[56px] shrink-0 border-b border-[var(--bdr)] bg-[var(--sur)]/60 backdrop-blur flex items-center gap-3 px-5">
      <div className="min-w-0">
        <h1 className="font-display font-semibold text-[15px] leading-tight truncate">{title}</h1>
        {subtitle && <p className="text-[11px] text-[var(--tx3)] truncate">{subtitle}</p>}
      </div>

      <div className="ml-auto flex items-center gap-2">
        {status === 'ok' && presence.length > 0 ? (
          <PresenceAvatars users={presence} />
        ) : (
          <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-[var(--tx3)] mr-1">
            <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[status]}`} />
            {STATUS_LABEL[status]}
          </div>
        )}

        {onSearch && (
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--tx3)]" />
            <input
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Buscar…"
              className="bg-[var(--sur2)] border border-[var(--bdr)] rounded-lg pl-7 pr-3 py-1.5 text-[12px] w-[190px] outline-none focus:border-id-mid placeholder:text-[var(--tx3)]"
            />
          </div>
        )}

        <button className="w-8 h-8 rounded-lg border border-[var(--bdr)] flex items-center justify-center text-[var(--tx3)] hover:text-white hover:bg-[var(--sur2)]">
          <Bell size={14} />
        </button>

        <button
          onClick={onToggleDark}
          className="w-8 h-8 rounded-lg border border-[var(--bdr)] flex items-center justify-center text-[var(--tx3)] hover:text-white hover:bg-[var(--sur2)]"
        >
          {dark ? <Sun size={14} /> : <Moon size={14} />}
        </button>
      </div>
    </header>
  )
}
