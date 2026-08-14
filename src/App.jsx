import { useEffect, useState } from 'react'
import Sidebar from './components/Sidebar'
import Topbar from './components/Topbar'
import Dashboard from './pages/Dashboard'
import Saldos from './pages/Saldos'
import TaxaAdministracao from './pages/TaxaAdministracao'
import PortalSaldos from './pages/PortalSaldos'
import MultasJuros from './pages/MultasJuros'
import HomeOffice from './pages/HomeOffice'
import Agenda from './pages/Agenda'
import Usuarios from './pages/Usuarios'
import Auditoria from './pages/Auditoria'
import Configuracoes from './pages/Configuracoes'
import { useFirebaseStatus } from './hooks/useFirebaseStatus'

const PAGES = {
  dashboard: { component: Dashboard, title: 'Dashboard', subtitle: 'Visão geral dos processos' },
  saldos: { component: Saldos, title: 'Saldos', subtitle: 'Conta lastros' },
  'taxa-administracao': { component: TaxaAdministracao, title: 'Taxa de Administração' },
  'portal-saldos': { component: PortalSaldos, title: 'Portal Saldos' },
  'multas-juros': { component: MultasJuros, title: 'Multas e Juros', subtitle: 'Cálculo base Selic' },
  'home-office': { component: HomeOffice, title: 'Home Office', subtitle: 'Escala da equipe' },
  agenda: { component: Agenda, title: 'Agenda' },
  usuarios: { component: Usuarios, title: 'Usuários' },
  auditoria: { component: Auditoria, title: 'Auditoria' },
  configuracoes: { component: Configuracoes, title: 'Configurações' },
}

export default function App() {
  const [active, setActive] = useState('dashboard')
  const [collapsed, setCollapsed] = useState(false)
  const [dark, setDark] = useState(true)
  const [search, setSearch] = useState('')
  const status = useFirebaseStatus()

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
  }, [dark])

  const page = PAGES[active] ?? PAGES.dashboard
  const Page = page.component

  return (
    <div className="h-screen w-screen flex bg-bg overflow-hidden">
      <Sidebar
        active={active}
        onNavigate={setActive}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((c) => !c)}
        counts={{ 'multas-juros': 3 }}
        user={{ name: 'Mateus Jesus', role: 'Coordenador', initials: 'MJ' }}
      />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar
          title={page.title}
          subtitle={page.subtitle}
          status={status}
          dark={dark}
          onToggleDark={() => setDark((d) => !d)}
          search={search}
          onSearch={setSearch}
        />
        <main className="flex-1 overflow-y-auto p-5">
          <Page />
        </main>
      </div>
    </div>
  )
}
