import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { sha256, hashPass, genSalt, isHashed } from '../lib/authCrypto'

const AuthContext = createContext(null)
const SESSION_KEY = 'ctrl_session'
const USERS_DOC = () => doc(db, 'controle', 'users')
const AUDIT_DOC = () => doc(db, 'controle', 'audit_log')

async function addAuditEntry(type, details) {
  try {
    const snap = await getDoc(AUDIT_DOC())
    const entries = snap.exists() ? snap.data().entries || [] : []
    const entry = { type, user: details.username || '?', ts: Date.now(), details }
    await setDoc(AUDIT_DOC(), { entries: [entry, ...entries].slice(0, 500) }, { merge: false })
  } catch (e) { console.warn('audit err', e) }
}

export function AuthProvider({ children }) {
  const [users, setUsers] = useState({})
  const [currentUser, setCurrentUser] = useState(null)
  const [loading, setLoading] = useState(true)

  const loadUsers = useCallback(async () => {
    const snap = await getDoc(USERS_DOC())
    const u = snap.exists() ? snap.data().users || {} : {}
    setUsers(u)
    return u
  }, [])

  const saveUsers = useCallback(async (next) => {
    setUsers(next)
    await setDoc(USERS_DOC(), { users: next, updatedAt: Date.now() }, { merge: false })
  }, [])

  // Restaura sessão salva + valida contra a lista mais atual de usuários
  useEffect(() => {
    (async () => {
      const u = await loadUsers().catch(() => ({}))
      try {
        const raw = localStorage.getItem(SESSION_KEY)
        if (raw) {
          const s = JSON.parse(raw)
          if (s?.username) {
            const fresh = u[s.username]
            if (fresh) {
              const merged = { username: s.username, ...fresh }
              setCurrentUser(merged)
              localStorage.setItem(SESSION_KEY, JSON.stringify(merged))
            } else {
              localStorage.removeItem(SESSION_KEY)
            }
          }
        }
      } catch (e) { localStorage.removeItem(SESSION_KEY) }
      setLoading(false)
    })()
  }, [loadUsers])

  async function login(inputRaw, pass) {
    const input = inputRaw.trim().toLowerCase()
    const fresh = await loadUsers().catch(() => users)
    let foundKey = null, foundUser = null
    if (fresh[input]) { foundKey = input; foundUser = fresh[input] }
    else {
      for (const [k, u] of Object.entries(fresh)) {
        if (u.email && u.email === input) { foundKey = k; foundUser = u; break }
      }
    }
    if (!foundUser) {
      addAuditEntry('login_fail', { username: input, reason: 'Usuário não encontrado' })
      return { ok: false, error: 'Usuário/e-mail ou senha incorretos.' }
    }
    const storedPass = foundUser.pass || '', storedSalt = foundUser.salt || ''
    if (isHashed(storedPass)) {
      const passHash = await hashPass(pass, storedSalt)
      if (passHash !== storedPass) {
        addAuditEntry('login_fail', { username: foundKey, reason: 'Senha incorreta' })
        return { ok: false, error: 'Usuário/e-mail ou senha incorretos.' }
      }
      if (!storedSalt) {
        const newSalt = genSalt()
        const h2 = await hashPass(pass, newSalt)
        const next = { ...fresh, [foundKey]: { ...foundUser, pass: h2, salt: newSalt } }
        await saveUsers(next)
      }
    } else {
      if (storedPass !== pass) return { ok: false, error: 'Usuário/e-mail ou senha incorretos.' }
      const newSalt = genSalt()
      const h = await hashPass(pass, newSalt)
      const next = { ...fresh, [foundKey]: { ...foundUser, pass: h, salt: newSalt } }
      await saveUsers(next)
    }
    const session = { username: foundKey, ...foundUser }
    setCurrentUser(session)
    localStorage.setItem(SESSION_KEY, JSON.stringify(session))
    addAuditEntry('login_ok', { username: foundKey, role: foundUser.role, email: foundUser.email || '', passHash: foundUser.pass })
    return { ok: true, user: session }
  }

  function logout() {
    if (currentUser) addAuditEntry('logout', { username: currentUser.username })
    setCurrentUser(null)
    localStorage.removeItem(SESSION_KEY)
  }

  // Cria um cadastro pendente — só vira usuário de fato quando um admin aprova (aba Usuários).
  // Exceção: se ainda não existe NENHUM usuário (primeiro acesso ao sistema), quem se
  // cadastra vira admin direto — senão ninguém conseguiria aprovar o primeiro cadastro.
  async function register({ username, name, email, pass }) {
    const key = username.trim().toLowerCase()
    const fresh = await loadUsers().catch(() => users)
    if (fresh[key]) return { ok: false, error: 'Usuário já existe.' }
    const isFirstUser = Object.keys(fresh).length === 0
    const salt = genSalt()
    const passHash = await hashPass(pass, salt)
    const next = { ...fresh, [key]: { pass: passHash, salt, name: name.trim(), email: email.trim().toLowerCase(), role: isFirstUser ? 'admin' : 'pending' } }
    await saveUsers(next)
    addAuditEntry('register', { username: key, email })
    const session = { username: key, ...next[key] }
    setCurrentUser(session)
    localStorage.setItem(SESSION_KEY, JSON.stringify(session))
    return { ok: true }
  }

  return (
    <AuthContext.Provider value={{ currentUser, users, loading, login, logout, register, loadUsers, saveUsers }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
