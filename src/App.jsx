import { useEffect, useState } from 'react'
import Sidebar from './components/Sidebar'
import Topbar from './components/Topbar'
import Dashboard from './pages/Dashboard'
import Saldos from './pages/Saldos'
import Fundos from './pages/Fundos'
import TaxaAdministracao from './pages/TaxaAdministracao'
import PortalSaldos from './pages/PortalSaldos'
import MultasJuros from './pages/MultasJuros'
import HomeOffice from './pages/HomeOffice'
import Agenda from './pages/Agenda'
import Usuarios from './pages/Usuarios'
import Auditoria from './pages/Auditoria'
import Historico from './pages/Historico'
import Configuracoes from './pages/Configuracoes'
import Login from './pages/Login'
import PendingApproval from './pages/PendingApproval'
import Quadro from './pages/Quadro'
import PendReminderModal from './components/PendReminderModal'
import { useFirebaseStatus } from './hooks/useFirebaseStatus'
import { usePendReminder } from './hooks/usePendReminder'
import { COLABORADORES } from './hooks/useBoard'
import { AuthProvider, useAuth } from './context/AuthContext'

const PAGES = {
  dashboard: { component: Dashboard, title: 'Pendências', subtitle: 'Área Liquidação' },
  saldos: { component: Saldos, title: 'Saldos', subtitle: 'Conta lastros' },
  fundos: { component: Fundos, title: 'Fundos', subtitle: 'Base de referência' },
  'taxa-administracao': { component: TaxaAdministracao, title: 'Taxa de Administração' },
  'portal-saldos': { component: PortalSaldos, title: 'Portal Saldos' },
  'multas-juros': { component: MultasJuros, title: 'Multas e Juros', subtitle: 'Cálculo base Selic' },
  'home-office': { component: HomeOffice, title: 'Home Office', subtitle: 'Escala da equipe' },
  agenda: { component: Agenda, title: 'Agenda' },
  usuarios: { component: Usuarios, title: 'Usuários', adminOnly: true },
  auditoria: { component: Auditoria, title: 'Auditoria', adminOnly: true },
  historico: { component: Historico, title: 'Histórico', subtitle: 'Pendências concluídas' },
  configuracoes: { component: Configuracoes, title: 'Configurações', adminOnly: true },
}

function AppShell() {
  const { currentUser, loading, logout } = useAuth()
  const [active, setActive] = useState('dashboard')
  const [collapsed, setCollapsed] = useState(false)
  const [dark, setDark] = useState(() => localStorage.getItem('gerencial_theme') === 'dark')
  const [search, setSearch] = useState('')
  const status = useFirebaseStatus()

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('gerencial_theme', dark ? 'dark' : 'light')
  }, [dark])

  if (loading) {
    return <div className="h-screen w-screen flex items-center justify-center bg-[var(--bg)] text-[var(--tx3)] text-[13px]">Carregando…</div>
  }
  if (!currentUser) return <Login />
  if (currentUser.role === 'pending') return <PendingApproval />

  const isAdmin = currentUser.role === 'admin'
  const isBoard = active.startsWith('board:')

  // Quadros (Controle): cada um só acessa o próprio, admin acessa qualquer um
  if (isBoard) {
    const slug = active.slice('board:'.length)
    const isOwn = slug === currentUser.username
    if (!isOwn && !isAdmin) {
      return <Redirect to="board:" username={currentUser.username} setActive={setActive} {...{ collapsed, setCollapsed, dark, setDark, search, setSearch, status, currentUser, isAdmin, logout }} />
    }
  } else {
    const page = PAGES[active] ?? PAGES.dashboard
    if (page.adminOnly && !isAdmin) {
      return <AppShellInner {...{ active: 'dashboard', setActive, collapsed, setCollapsed, dark, setDark, search, setSearch, status, currentUser, isAdmin, logout }} />
    }
  }

  return <AppShellInner {...{ active, setActive, collapsed, setCollapsed, dark, setDark, search, setSearch, status, currentUser, isAdmin, logout }} />
}

// Pequeno helper: se um não-admin tentar abrir o quadro de outra pessoa via URL/estado direto, manda pro próprio
function Redirect({ username, setActive, ...rest }) {
  useEffect(() => { setActive('board:' + username) }, [])
  return <AppShellInner active={'board:' + username} setActive={setActive} {...rest} />
}

function AppShellInner({ active, setActive, collapsed, setCollapsed, dark, setDark, search, setSearch, status, currentUser, isAdmin, logout }) {
  const { pendingItems, dismiss } = usePendReminder(currentUser.notifPendencias === true)
  const initials = (currentUser.name || currentUser.username || '?').split(' ').slice(0, 2).map((w) => w[0] || '').join('').toUpperCase()
  const roleLabel = { admin: 'Administrador', user: 'Equipe', consulta: 'Consulta' }[currentUser.role] || currentUser.role

  const isBoard = active.startsWith('board:')
  let Page, title, subtitle, boardSlug, boardOwnerName

  if (isBoard) {
    boardSlug = active.slice('board:'.length)
    if (boardSlug === currentUser.username) {
      boardOwnerName = currentUser.name || currentUser.username
    } else {
      boardOwnerName = COLABORADORES.find((c) => c.slug === boardSlug)?.name || boardSlug
    }
    title = boardOwnerName
    subtitle = 'Controle'
  } else {
    const page = PAGES[active] ?? PAGES.dashboard
    Page = page.component
    title = page.title
    subtitle = page.subtitle
  }

  return (
    <div className="h-screen w-screen flex bg-[var(--bg)] overflow-hidden">
      <Sidebar
        active={active}
        onNavigate={setActive}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((c) => !c)}
        isAdmin={isAdmin}
        ownSlug={currentUser.username}
        ownName={currentUser.name || currentUser.username}
        user={{ name: currentUser.name || currentUser.username, role: roleLabel, initials }}
        onLogout={logout}
      />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar
          title={title}
          subtitle={subtitle}
          status={status}
          dark={dark}
          onToggleDark={() => setDark((d) => !d)}
          search={search}
          onSearch={setSearch}
        />
        <main className="flex-1 overflow-y-auto p-5">
          {isBoard ? <Quadro slug={boardSlug} ownerName={boardOwnerName} /> : <Page />}
        </main>
      </div>
      <PendReminderModal items={pendingItems} onClose={dismiss} />
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  )
}
