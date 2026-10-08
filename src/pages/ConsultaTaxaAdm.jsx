// Página pública de consulta (/consulta/taxa-adm?t=TOKEN): só a tela de Taxa
// de Administração, somente leitura, com os dados ao vivo. O servidor confere
// o link e entrega uma sessão que só lê a Taxa ADM; as regras do Firestore
// conferem o link de novo a cada leitura — revogou, perdeu o acesso na hora.
import { useEffect, useState } from 'react'
import { inMemoryPersistence, setPersistence, signInWithCustomToken } from 'firebase/auth'
import { Moon, Sun, Lock, Eye } from 'lucide-react'
import { auth, api } from '../lib/firebase'
import TaxaAdministracao from './TaxaAdministracao'
import logoId from '../assets/logo-id.png'

export default function ConsultaTaxaAdm() {
  const token = new URLSearchParams(window.location.search).get('t') || ''
  const [state, setState] = useState('checking') // checking | ok | invalid | error
  const [label, setLabel] = useState('')
  const [dark, setDark] = useState(() => localStorage.getItem('gerencial_theme') !== 'light')

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    try { localStorage.setItem('gerencial_theme', dark ? 'dark' : 'light') } catch { /* sem storage */ }
  }, [dark])

  useEffect(() => {
    document.title = 'Taxa de Administração · Consulta'
    let alive = true
    const check = async (first) => {
      const r = await api('/api/consulta', { t: token })
      if (!alive) return
      if (!r.ok) { setState(r.status === 404 ? 'invalid' : first ? 'error' : 'ok'); return }
      setLabel(r.data.label || '')
      if (first) {
        await auth.authStateReady()
        // Quem já está logado no app neste navegador continua com a própria
        // sessão; senão, entra só com o link e sem gravar nada no navegador.
        if (!auth.currentUser?.uid?.startsWith('u:')) {
          await setPersistence(auth, inMemoryPersistence)
          await signInWithCustomToken(auth, r.data.token)
        }
      }
      if (alive) setState('ok')
    }
    check(true).catch(() => alive && setState('error'))
    const iv = setInterval(() => check(false).catch(() => {}), 60 * 1000) // revogou → sai da tela
    return () => { alive = false; clearInterval(iv) }
  }, [token])

  if (state !== 'ok') {
    return (
      <div className="h-screen w-screen flex items-center justify-center p-6">
        <div className="glass rounded-2xl p-8 max-w-[420px] text-center">
          <div className="w-12 h-12 mx-auto rounded-2xl bg-[var(--sur2)] flex items-center justify-center mb-3">
            {state === 'checking' ? <div className="w-5 h-5 border-2 border-id-light border-t-transparent rounded-full animate-spin" /> : <Lock size={20} className="text-[var(--tx3)]" />}
          </div>
          <div className="font-display font-semibold text-[16px]">
            {state === 'checking' ? 'Carregando consulta…' : state === 'invalid' ? 'Link inválido ou revogado' : 'Não foi possível carregar'}
          </div>
          {state !== 'checking' && <p className="text-[12.5px] text-[var(--tx3)] mt-1">{state === 'invalid' ? 'Peça um novo link para quem compartilhou com você.' : 'Verifique a conexão e recarregue a página.'}</p>}
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden">
      <header className="h-[60px] shrink-0 border-b border-[var(--bdr)] bg-[var(--glass)] backdrop-blur-xl flex items-center gap-3 px-6">
        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-id-light/25 to-id-dark/10 border border-id-mid/30 flex items-center justify-center shrink-0">
          <img src={logoId} alt="ID" className="w-[18px] h-[18px] object-contain" />
        </div>
        <div className="leading-tight min-w-0">
          <div className="font-display font-semibold text-[13px]">Gerencial · Liquidação</div>
          <div className="text-[10.5px] text-[var(--tx3)] truncate">Consulta{label ? ` · ${label}` : ''}</div>
        </div>
        <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-[var(--tx3)] border border-[var(--bdr)] rounded-full px-2.5 py-1"><Eye size={12} /> Somente leitura</span>
        <button onClick={() => setDark((d) => !d)} className="w-9 h-9 rounded-xl border border-[var(--bdr)] flex items-center justify-center text-[var(--tx3)] hover:text-[var(--tx)] hover:bg-[var(--sur2)]" title="Tema">
          {dark ? <Sun size={14} /> : <Moon size={14} />}
        </button>
      </header>
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1680px] p-4 sm:p-6 animate-fade-up">
          <TaxaAdministracao readOnly />
        </div>
      </main>
    </div>
  )
}
