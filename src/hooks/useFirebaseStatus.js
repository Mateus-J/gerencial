import { useEffect, useState } from 'react'
import { ensureAnonAuth } from '../lib/firebase'

// Espelha o "sdot" do app antigo: cinza = conectando, verde = ok, âmbar = offline
export function useFirebaseStatus() {
  const [status, setStatus] = useState('connecting') // connecting | ok | offline

  useEffect(() => {
    let mounted = true
    ensureAnonAuth()
      .then(() => { if (mounted) setStatus('ok') })
      .catch(() => { if (mounted) setStatus('offline') })
    return () => { mounted = false }
  }, [])

  return status
}
