import { useEffect, useRef, useState, useCallback } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { playBeep } from '../lib/beep'

const PEND_DOC = () => doc(db, 'controle', 'pendencias')
const INTERVAL_MS = 60 * 60 * 1000 // 1 hora

function timeAgo(ts) {
  if (!ts) return '—'
  const diff = Date.now() - ts
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return min + 'min'
  const h = Math.floor(min / 60)
  if (h < 24) return h + 'h'
  const d = Math.floor(h / 24)
  return d + 'd'
}

// Lembrete de pendências em aberto: popup + notificação nativa do navegador + som,
// a cada 1h enquanto o app estiver aberto. Só ativo se o usuário tiver a permissão
// ligada (campo notifPendencias no Firestore, controlado em Usuários por um admin).
export function usePendReminder(enabled) {
  const [pendingItems, setPendingItems] = useState(null) // null = popup fechado
  const timerRef = useRef(null)

  const fireReminder = useCallback(async () => {
    try {
      const snap = await getDoc(PEND_DOC())
      const all = snap.exists() ? snap.data().items || [] : []
      const pendentes = all.filter((r) => r.status === 'Pendente').map((r) => ({ ...r, tempo: timeAgo(r.createdAt) }))
      if (!pendentes.length) return

      setPendingItems(pendentes)
      playBeep()

      if ('Notification' in window && Notification.permission === 'granted') {
        const title = `${pendentes.length} pendência${pendentes.length > 1 ? 's' : ''} em aberto`
        const body = pendentes.slice(0, 4).map((p) => `• ${p.fundo} — ${p.ocorrencia} (${p.tempo})`).join('\n') + (pendentes.length > 4 ? `\n+ ${pendentes.length - 4} outra(s)…` : '')
        const n = new Notification(title, { body, icon: '/favicon.svg', tag: 'pendencias-reminder' })
        n.onclick = () => { window.focus() }
      }
    } catch (e) { console.warn('pendReminder err', e) }
  }, [])

  useEffect(() => {
    if (!enabled) return
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {})
    }
    timerRef.current = setInterval(fireReminder, INTERVAL_MS)
    return () => clearInterval(timerRef.current)
  }, [enabled, fireReminder])

  return { pendingItems, dismiss: () => setPendingItems(null) }
}
