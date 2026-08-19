// Integração com o Google Drive via Google Identity Services (GIS) — sobe
// arquivos direto pra pastas organizadas automaticamente (uma por conta de
// origem), sem precisar de backend. Usa o escopo mais restrito do Drive
// (drive.file): o app só enxerga/edita os arquivos que ele mesmo criar,
// nunca o resto do seu Drive.
//
// PRECISA CONFIGURAR ANTES DE USAR (uma vez só):
// 1. https://console.cloud.google.com → crie ou selecione um projeto
// 2. "APIs e serviços" → Biblioteca → ative a "Google Drive API"
// 3. "APIs e serviços" → Tela de consentimento OAuth → Externo → preencha
//    nome do app e e-mail de suporte → em Escopos, adicione
//    ".../auth/drive.file" → em Usuários de teste, adicione o seu próprio
//    e-mail do Google (assim continua em modo "Teste" e não passa pela
//    verificação do Google — é só pra você mesmo usar)
// 4. "APIs e serviços" → Credenciais → Criar credenciais → ID do cliente
//    OAuth → tipo "Aplicativo da Web" → em "Origens JavaScript
//    autorizadas", adicione https://gerencial.pages.dev
// 5. Copie o Client ID gerado (algo tipo 123...apps.googleusercontent.com)
//    e cole na constante GOOGLE_CLIENT_ID logo abaixo

export const GOOGLE_CLIENT_ID = '313702187428-aqgkaqfn9vhsi2g1nhfff5jj7b3eapmk.apps.googleusercontent.com'

const SCOPE = 'https://www.googleapis.com/auth/drive.file'
let tokenClient = null
let cachedToken = null // { access_token, expiresAt }

export function isDriveConfigured() {
  return !GOOGLE_CLIENT_ID.startsWith('COLE_AQUI')
}

function loadGis() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve()
    const existing = document.getElementById('gis-script')
    if (existing) { existing.addEventListener('load', () => resolve()); return }
    const script = document.createElement('script')
    script.id = 'gis-script'
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Não consegui carregar o Google Identity Services (verifique sua internet).'))
    document.head.appendChild(script)
  })
}

async function getAccessToken() {
  if (!isDriveConfigured()) throw new Error('Integração com o Drive ainda não configurada (falta o Client ID no código).')
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30000) return cachedToken.access_token

  await loadGis()
  return new Promise((resolve, reject) => {
    if (!tokenClient) {
      tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: SCOPE,
        callback: () => {},
      })
    }
    tokenClient.callback = (resp) => {
      if (resp.error) { reject(new Error('Acesso ao Drive negado ou cancelado.')); return }
      cachedToken = { access_token: resp.access_token, expiresAt: Date.now() + (resp.expires_in || 3600) * 1000 }
      resolve(resp.access_token)
    }
    tokenClient.requestAccessToken({ prompt: cachedToken ? '' : 'consent' })
  })
}

async function driveFetch(url, options = {}) {
  const token = await getAccessToken()
  const res = await fetch(url, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Drive recusou (${res.status}): ${body.slice(0, 180)}`)
  }
  return res.json()
}

async function findFolder(name, parentId) {
  const q = encodeURIComponent(
    `name = '${name.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false` +
    (parentId ? ` and '${parentId}' in parents` : '')
  )
  const data = await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`)
  return data.files?.[0]?.id || null
}

async function createFolder(name, parentId) {
  const body = { name, mimeType: 'application/vnd.google-apps.folder', ...(parentId ? { parents: [parentId] } : {}) }
  const data = await driveFetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return data.id
}

async function ensureFolder(name, parentId) {
  const existing = await findFolder(name, parentId)
  if (existing) return existing
  return createFolder(name, parentId)
}

async function uploadFileToDrive(file, folderId) {
  const token = await getAccessToken()
  const metadata = { name: file.name, parents: [folderId] }
  const form = new FormData()
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }))
  form.append('file', file)
  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  if (!res.ok) throw new Error('Falha ao enviar o arquivo pro Drive (' + res.status + ')')
  const data = await res.json()
  return data.id
}

async function makePublic(fileId) {
  await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'reader', type: 'anyone' }),
  })
}

function driveDownloadLink(fileId) {
  return `https://drive.google.com/uc?export=download&id=${fileId}`
}

// Fluxo completo: garante a pasta raiz "Controles Internos (Gerencial)" >
// subpasta com o nome da conta de origem > sobe o arquivo ali > deixa
// visível por link > devolve o link de download direto.
export async function uploadToContaFolder(file, contaNome) {
  const rootId = await ensureFolder('Controles Internos (Gerencial)')
  const contaFolderId = await ensureFolder(contaNome || 'Sem conta', rootId)
  const fileId = await uploadFileToDrive(file, contaFolderId)
  await makePublic(fileId)
  return { fileId, url: driveDownloadLink(fileId) }
}
