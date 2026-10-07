// Mesma configuração do app atual (gerencial.pages.dev).
// Trocar o hosting/frontend NÃO afeta os dados: eles continuam
// no mesmo projeto Firestore ('id-liquidacao').
import { initializeApp } from 'firebase/app'
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore'
import { getAuth, connectAuthEmulator } from 'firebase/auth'

const firebaseConfig = {
  apiKey: 'AIzaSyAUcVEYwdeq1sfo6P8q8JIodgu0J-akJgI',
  authDomain: 'id-liquidacao.firebaseapp.com',
  projectId: 'id-liquidacao',
  storageBucket: 'id-liquidacao.firebasestorage.app',
  messagingSenderId: '254207803173',
  appId: '1:254207803173:web:70dc87e9cdf67682b424cc',
}

// A apiKey acima não é secreta (todo app Firebase a expõe no navegador). Quem
// protege os dados são as regras do Firestore (firestore.rules): só entra quem
// fez login pelo servidor (/api/auth/login), que entrega uma sessão com o
// perfil (admin/user/consulta) — não existe mais acesso anônimo.

export const app = initializeApp(firebaseConfig)
export const db = getFirestore(app)
export const auth = getAuth(app)

// Só em testes locais (npm run dev com VITE_FIREBASE_EMULATOR=1)
if (import.meta.env.VITE_FIREBASE_EMULATOR) {
  connectFirestoreEmulator(db, '127.0.0.1', 8089)
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
}

// Chamada às funções do servidor levando o token da sessão atual
export async function api(path, body) {
  const headers = { 'content-type': 'application/json' }
  const tok = auth.currentUser ? await auth.currentUser.getIdToken().catch(() => null) : null
  if (tok) headers.authorization = 'Bearer ' + tok
  let res
  try { res = await fetch(path, { method: 'POST', headers, body: JSON.stringify(body || {}) }) } catch { return { ok: false, status: 0, data: { error: 'Sem conexão com o servidor.' } } }
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data }
}
