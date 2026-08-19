// Mesma configuração do app atual (gerencial.pages.dev).
// Trocar o hosting/frontend NÃO afeta os dados: eles continuam
// no mesmo projeto Firestore ('id-liquidacao'). Copiei a config
// direto do HTML original — ajuste aqui se algo mudar.
import { initializeApp } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth'

const firebaseConfig = {
  apiKey: 'AIzaSyAUcVEYwdeq1sfo6P8q8JIodgu0J-akJgI',
  authDomain: 'id-liquidacao.firebaseapp.com',
  projectId: 'id-liquidacao',
  storageBucket: 'id-liquidacao.firebasestorage.app',
  messagingSenderId: '254207803173',
  appId: '1:254207803173:web:70dc87e9cdf67682b424cc',
}

// Nota: a apiKey acima não é secreta (é normal ela ir no bundle client-side
// do Firebase). Quem protege os dados de verdade são as Regras do Firestore
// no console do projeto — confirme que elas continuam restritas por usuário/role.

export const app = initializeApp(firebaseConfig)
export const db = getFirestore(app)
export const auth = getAuth(app)
export const storage = getStorage(app)

export function ensureAnonAuth() {
  return new Promise((resolve, reject) => {
    const unsub = onAuthStateChanged(auth, (user) => {
      unsub()
      if (user) return resolve(user)
      signInAnonymously(auth).then((cred) => resolve(cred.user)).catch(reject)
    })
  })
}
