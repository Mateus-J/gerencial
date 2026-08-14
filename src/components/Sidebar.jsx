import {
  LayoutDashboard, Wallet, Percent, Landmark, AlertTriangle,
  Home, CalendarDays, Users, ShieldCheck, Settings, ChevronDown,
} from 'lucide-react'
import { useState } from 'react'

const NAV = [
  {
    group: 'Visão geral',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    ],
  },
  {
    group: 'Operacional',
    items: [
      { id: 'saldos', label: 'Saldos', icon: Wallet },
      { id: 'taxa-administracao', label: 'Taxa de Administração', icon: Percent },
      { id: 'portal-saldos', label: 'Portal Saldos', icon: Landmark },
      { id: 'multas-juros', label: 'Multas e Juros', icon: AlertTriangle, badge: true },
    ],
  },
  {
    group: 'Equipe',
    items: [
      { id: 'home-office', label: 'Home Office', icon: Home },
      { id: 'agenda', label: 'Agenda', icon: CalendarDays },
      { id: 'usuarios', label: 'Usuários', icon: Users },
    ],
  },
  {
    group: 'Sistema',
    items: [
      { id: 'auditoria', label: 'Auditoria', icon: ShieldCheck },
      { id: 'configuracoes', label: 'Configurações', icon: Settings },
    ],
  },
]

export default function Sidebar({ active, onNavigate, counts = {}, user, collapsed, onToggleCollapsed }) {
  return (
    <aside
      className={`h-full shrink-0 bg-bg-panel border-r border-bg-border flex flex-col transition-all duration-150 ${
        collapsed ? 'w-[64px]' : 'w-[220px]'
      }`}
    >
      <div className="h-[50px] flex items-center gap-2 px-4 border-b border-bg-border shrink-0">
        <div className="w-6 h-6 rounded-md bg-id-dark flex items-center justify-center text-white text-[11px] font-bold shrink-0">
          ID
        </div>
        {!collapsed && (
          <span className="font-display font-semibold text-[13px] tracking-wide truncate">
            Gerencial
          </span>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-4">
        {NAV.map((group) => (
          <div key={group.group}>
            {!collapsed && (
              <div className="px-2 mb-1 text-[10px] font-semibold tracking-widest uppercase text-slate-500">
                {group.group}
              </div>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon
                const isActive = active === item.id
                const count = counts[item.id]
                return (
                  <button
                    key={item.id}
                    onClick={() => onNavigate(item.id)}
                    title={collapsed ? item.label : undefined}
                    className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[12.5px] transition-colors
                      ${isActive
                        ? 'bg-id-dark/20 text-id-light border border-id-dark/40'
                        : 'text-slate-300 hover:bg-bg-panel2 hover:text-white border border-transparent'}`}
                  >
                    <Icon size={15} className="shrink-0" />
                    {!collapsed && <span className="truncate flex-1 text-left">{item.label}</span>}
                    {!collapsed && count > 0 && (
                      <span className="text-[10px] font-mono bg-id-mid/30 text-id-light px-1.5 py-0.5 rounded-full">
                        {count}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      <button
        onClick={onToggleCollapsed}
        className="h-10 border-t border-bg-border text-slate-500 hover:text-slate-300 text-[11px] flex items-center justify-center gap-1"
      >
        <ChevronDown size={13} className={`transition-transform ${collapsed ? '-rotate-90' : 'rotate-90'}`} />
        {!collapsed && 'Recolher'}
      </button>

      {user && (
        <div className="border-t border-bg-border p-2.5 flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-id-mid/30 text-id-light flex items-center justify-center text-[11px] font-semibold shrink-0">
            {user.initials}
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <div className="text-[12px] font-medium truncate">{user.name}</div>
              <div className="text-[10.5px] text-slate-500 truncate">{user.role}</div>
            </div>
          )}
        </div>
      )}
    </aside>
  )
}
