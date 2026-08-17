import { useEffect, useRef, useState } from 'react'
import { doc, getDoc, onSnapshot, setDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../context/AuthContext'

const PRESENCE_DOC = () => doc(db, 'controle', 'presence')
const ONLINE_WINDOW_MS = 45 * 1000   // some tempo sem "batimento" = considera offline
const ACTIVE_WINDOW_MS = 12 * 1000   // sem mouse/teclado nesse tempo = considera só "aberto", não "ativo"
const HEARTBEAT_MS = 20 * 1000

const COLORS = ['#8FB352', '#5B9BD5', '#E8A33D', '#D96C6C', '#9B7FD1', '#4FBDBA', '#E0836A']

export function colorForUser(username) {
  let h = 0
  for (let i = 0; i < (username || '').length; i++) h = (h * 31 + username.charCodeAt(i)) >>> 0
  return COLORS[h % COLORS.length]
}

export function initialsFor(name) {
  const parts = (name || '').trim().split(/\s+/)
  if (!parts[0]) return '?'
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase()
}

// Presença em tempo real: cada aba aberta grava um "batimento" periódico no
// Firestore (controle/presence) com quem é e se está ativamente mexendo no
// sistema agora (mouse/teclado nos últimos segundos) ou só com a aba aberta.
// Todo mundo lê esse mesmo documento via onSnapshot, então a lista de quem
// está online atualiza sozinha pra todo mundo, sem refresh.
export function usePresence() {
  const { currentUser } = useAuth()
  const [presence, setPresence] = useState([])
  const lastActivityRef = useRef(Date.now())

  useEffect(() => {
    if (!currentUser?.username) return
    const markActivity = () => { lastActivityRef.current = Date.now() }
    const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart']
    events.forEach((ev) => window.addEventListener(ev, markActivity, { passive: true }))

    async function beat() {
      try {
        const snap = await getDoc(PRESENCE_DOC())
        const current = snap.exists() ? snap.data() : {}
        const active = Date.now() - lastActivityRef.current < ACTIVE_WINDOW_MS
        await setDoc(PRESENCE_DOC(), {
          ...current,
          [currentUser.username]: { name: currentUser.name || currentUser.username, lastSeen: Date.now(), active },
        }, { merge: true })
      } catch (e) { console.warn('presence beat err', e) }
    }
    beat()
    const interval = setInterval(beat, HEARTBEAT_MS)

    const unsub = onSnapshot(PRESENCE_DOC(), (snap) => {
      if (!snap.exists()) { setPresence([]); return }
      const data = snap.data()
      const now = Date.now()
      const list = Object.entries(data)
        .filter(([, v]) => now - v.lastSeen < ONLINE_WINDOW_MS)
        .map(([username, v]) => ({ username, name: v.name, active: !!v.active && now - v.lastSeen < ACTIVE_WINDOW_MS }))
        .sort((a, b) => (a.username === currentUser.username ? -1 : b.username === currentUser.username ? 1 : a.name.localeCompare(b.name)))
      setPresence(list)
    }, (e) => console.warn('presence listen err', e))

    return () => {
      events.forEach((ev) => window.removeEventListener(ev, markActivity))
      clearInterval(interval)
      unsub()
    }
  }, [currentUser?.username])

  return presence
}
