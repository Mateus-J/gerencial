import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { onAuthStateChanged, signInWithCustomToken, signOut } from 'firebase/auth'
import { db, auth, api } from '../lib/firebase'

// Login: usuário, senha e 2FA são conferidos no servidor (/api/auth/login),
// que devolve um token do Firebase com o perfil da pessoa. As regras do
// Firestore só liberam a base para quem tem esse token — o navegador não vê
// senha nem segredo de 2FA de ninguém.
const AuthContext = createContext(null)
const LAST_USER_KEY = 'ctrl_last_username'
const LOGOUT_REASON_KEY = 'ctrl_logout_reason'
const USERS_DOC = () => doc(db, 'controle', 'users')
const AUDIT_DOC = () => doc(db, 'controle', 'audit_log')

// "HH:MM" -> minutos desde 00:00, pra comparar horário de acesso
function toMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '')
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

// Se o usuário tem janela de horário configurada, checa se agora está dentro dela.
// Sem horário configurado (um ou os dois campos vazios) = sem restrição.
// (O servidor também confere no login, no horário de Brasília.)
export function withinAccessWindow(user) {
  const start = toMinutes(user?.acessoInicio)
  const end = toMinutes(user?.acessoFim)
  if (start == null || end == null) return true
  const now = new Date()
  const nowMin = now.getHours() * 60 + now.getMinutes()
  if (start <= end) return nowMin >= start && nowMin <= end
  // janela que cruza a meia-noite (ex.: 22:00–06:00)
  return nowMin >= start || nowMin <= end
}

export function getLastUsername() {
  try { return localStorage.getItem(LAST_USER_KEY) } catch { return null }
}

// Lê o motivo do último logout automático (inatividade / fora do horário) e
// já limpa, pra só aparecer uma vez na tela de login.
export function consumeLogoutReason() {
  try {
    const r = localStorage.getItem(LOGOUT_REASON_KEY)
    if (r) localStorage.removeItem(LOGOUT_REASON_KEY)
    return r
  } catch { return null }
}

async function addAuditEntry(type, details) {
  try {
    const snap = await getDoc(AUDIT_DOC())
    const entries = snap.exists() ? snap.data().entries || [] : []
    const entry = { type, user: details.username || '?', ts: Date.now(), details }
    await setDoc(AUDIT_DOC(), { entries: [entry, ...entries].slice(0, 500) }, { merge: false })
  } catch (e) { console.warn('audit err', e) }
}

const usernameOf = (fbUser) => (fbUser?.uid?.startsWith('u:') ? fbUser.uid.slice(2) : null)

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const userRef = useRef(null)
  useEffect(() => { userRef.current = currentUser }, [currentUser])

  // Sessão do Firebase (persistida pelo próprio SDK) → perfil atual da base
  useEffect(() => onAuthStateChanged(auth, async (fbUser) => {
    const username = usernameOf(fbUser)
    if (!username) {
      // sessão anônima antiga ou de link de consulta: não serve para o app
      if (fbUser) await signOut(auth).catch(() => {})
      setCurrentUser((cur) => (cur?.role === 'pending' ? cur : null))
      setLoading(false)
      return
    }
    try {
      const snap = await getDoc(USERS_DOC())
      const profile = snap.exists() ? snap.data().users?.[username] : null
      if (!profile || profile.role === 'pending') { await signOut(auth); setCurrentUser(null) }
      else setCurrentUser({ username, ...profile })
    } catch (e) {
      console.warn('perfil err', e)
      await signOut(auth).catch(() => {})
      setCurrentUser(null)
    }
    setLoading(false)
  }), [])

  // Entra com usuário + senha (+ código do 2FA). Respostas:
  // { ok } | { needs2FA, setup, secret?, label? } | { ok:false, error }
  const login = useCallback(async (user, pass, code) => {
    const r = await api('/api/auth/login', { user, pass, code })
    if (!r.ok) return { ok: false, error: r.data.error || 'Não foi possível entrar.', needs2FA: !!r.data.needs2FA }
    if (r.data.needs2FA) return { ok: true, needs2FA: true, setup: !!r.data.setup, secret: r.data.secret, label: r.data.label }
    const profile = r.data.user
    try { localStorage.setItem(LAST_USER_KEY, profile.username) } catch { /* sem storage */ }
    if (!r.data.token) { setCurrentUser(profile); return { ok: true, user: profile } } // aguardando aprovação
    await signInWithCustomToken(auth, r.data.token)
    setCurrentUser(profile)
    return { ok: true, user: profile }
  }, [])

  const register = useCallback(async ({ username, name, email, pass }) => {
    const r = await api('/api/auth/register', { username, name, email, pass })
    if (!r.ok) return { ok: false, error: r.data.error || 'Não foi possível cadastrar.' }
    setCurrentUser(r.data.user)
    return { ok: true }
  }, [])

  const logout = useCallback((reason) => {
    const safeReason = typeof reason === 'string' ? reason : null
    const cur = userRef.current
    if (cur && cur.role !== 'pending') addAuditEntry(safeReason ? 'logout_auto' : 'logout', { username: cur.username, reason: safeReason }).finally(() => signOut(auth).catch(() => {}))
    else signOut(auth).catch(() => {})
    setCurrentUser(null)
    if (safeReason) { try { localStorage.setItem(LOGOUT_REASON_KEY, safeReason) } catch { /* sem storage */ } }
  }, [])

  // Deslogamento automático: 1h sem interação com o sistema, ou o horário
  // permitido do usuário (definido em Usuários) chegou ao fim.
  useEffect(() => {
    if (!currentUser || currentUser.role === 'pending') return
    const IDLE_LIMIT_MS = 60 * 60 * 1000 // 1 hora
    const CHECK_EVERY_MS = 30 * 1000
    let lastActivity = Date.now()
    const markActivity = () => { lastActivity = Date.now() }
    const events = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart', 'scroll']
    events.forEach((ev) => window.addEventListener(ev, markActivity, { passive: true }))

    const interval = setInterval(() => {
      if (Date.now() - lastActivity >= IDLE_LIMIT_MS) {
        logout('Sessão encerrada por 1h sem interação com o sistema.')
        return
      }
      if (!withinAccessWindow(currentUser)) {
        logout(`Sessão encerrada: fora do horário permitido (${currentUser.acessoInicio}–${currentUser.acessoFim}).`)
      }
    }, CHECK_EVERY_MS)

    return () => {
      events.forEach((ev) => window.removeEventListener(ev, markActivity))
      clearInterval(interval)
    }
  }, [currentUser, logout])

  return (
    <AuthContext.Provider value={{ currentUser, loading, login, logout, register }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

// Igual ao useAuth, mas sem exigir login (usado na página pública de consulta)
export function useOptionalAuth() {
  return useContext(AuthContext)
}
