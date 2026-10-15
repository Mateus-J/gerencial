import { useEffect, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '../lib/firebase'

// Espelha o "sdot" do app antigo: cinza = conectando, verde = ok, âmbar = offline
export function useFirebaseStatus() {
  const [status, setStatus] = useState('connecting') // connecting | ok | offline

  useEffect(() => {
    const sync = () => setStatus(!navigator.onLine ? 'offline' : auth.currentUser ? 'ok' : 'connecting')
    const unsub = onAuthStateChanged(auth, sync)
    window.addEventListener('online', sync)
    window.addEventListener('offline', sync)
    return () => { unsub(); window.removeEventListener('online', sync); window.removeEventListener('offline', sync) }
  }, [])

  return status
}
