// Cloudflare Pages Function: envia as notificações de taxas por e-mail via
// Brevo (https://www.brevo.com) direto para o e-mail dos canais do Slack.
//
// Variáveis no Cloudflare (Pages → gerencial → Settings → Variables and Secrets):
//   BREVO_API_KEY   (secreta)  chave de API do Brevo
//   MAIL_FROM                  e-mail remetente já confirmado no Brevo
//   MAIL_FROM_NAME  (opcional) nome do remetente — padrão "Liquidação · ID"
//   MAIL_REPLY_TO   (opcional) e-mail para respostas
//   ALLOWED_DOMAINS (opcional) domínios de destino aceitos, separados por
//                              vírgula — padrão "slack.com"
//   MAX_PER_HOUR    (opcional) teto de envios por hora — padrão 300
//
// Segurança: o navegador só diz QUAIS fundos de QUAL mês enviar. O destino
// (e-mail do canal cadastrado), o texto (modelo + dados da base) e o registro
// do envio (1 por fundo em cada competência) são resolvidos aqui no servidor, a partir do Firestore. Assim quem
// chamar este endereço por fora não consegue escolher destinatário nem
// escrever o conteúdo. A chave do Brevo nunca vai para o navegador, e só um
// administrador logado (token de sessão conferido aqui) consegue disparar.
import { groupByFund, renderMessage, DEFAULT_TEMPLATE } from '../../src/lib/slackNotify.js'
import { json, sameOrigin, serviceAccount, getDoc, patchFields, fieldPath } from '../../server/gcp.js'
import { requireStaff } from '../../server/auth.js'

const MAX_KEYS = 50
// Mesmo nome de documento que o site usa (AAAA_MM)
const shardOf = (mesRef) => mesRef.slice(3) + '_' + mesRef.slice(0, 2)
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function allowedDomain(email, env) {
  const domain = email.split('@')[1]?.toLowerCase() || ''
  const list = (env.ALLOWED_DOMAINS || 'slack.com').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean)
  return list.some((d) => domain === d || domain.endsWith('.' + d))
}

// Grava só os envios novos dentro de `enviados` (não mexe no resto do doc)
const recordSent = (env, entries) => patchFields(env, 'controle/taxa_adm_slack', Object.fromEntries(Object.entries(entries).map(([k, v]) => [fieldPath('enviados', k), v])))

// ---- Handlers ---------------------------------------------------------------
export async function onRequestGet({ env }) {
  return json({ configured: Boolean(env.BREVO_API_KEY && env.MAIL_FROM && serviceAccount(env)), fromName: env.MAIL_FROM_NAME || 'Liquidação · ID' })
}

export async function onRequestPost({ request, env }) {
  if (!env.BREVO_API_KEY || !env.MAIL_FROM || !serviceAccount(env)) return json({ error: 'Envio não configurado no Cloudflare (BREVO_API_KEY / MAIL_FROM / FIREBASE_SERVICE_ACCOUNT).' }, 503)
  if (!sameOrigin(request)) return json({ error: 'Origem não permitida.' }, 403)
  // Só administrador logado dispara envio (a tela de notificações é só de admin)
  const me = await requireStaff(env, request, ['admin']).catch(() => null)
  if (!me) return json({ error: 'Faça login como administrador para enviar.' }, 401)

  let payload
  try { payload = await request.json() } catch { return json({ error: 'JSON inválido.' }, 400) }
  const mesRef = String(payload?.mesRef || '')
  const keys = [...new Set((Array.isArray(payload?.keys) ? payload.keys : []).map(String))]
  const who = me.user.name || me.username
  if (!/^\d{2}\.\d{4}$/.test(mesRef)) return json({ error: 'Mês inválido.' }, 400)
  if (!keys.length) return json({ error: 'Nenhum fundo.' }, 400)
  if (keys.length > MAX_KEYS) return json({ error: `Máximo de ${MAX_KEYS} fundos por envio.` }, 400)

  let cfg, shard
  try {
    [cfg, shard] = await Promise.all([getDoc(env, 'controle/taxa_adm_slack'), getDoc(env, 'controle/taxa_adm__' + shardOf(mesRef))])
  } catch {
    return json({ error: 'Não foi possível ler a base agora. Tente de novo.' }, 502)
  }
  const canais = cfg?.canais || {}
  const enviados = cfg?.enviados || {}
  const template = cfg?.template?.body ? cfg.template : DEFAULT_TEMPLATE
  const funds = new Map(groupByFund(shard?.rows || [], mesRef).map((f) => [f.key, f]))

  // Teto por hora, contando o que já saiu (o registro é gravado aqui mesmo)
  const now = Date.now()
  const maxHour = Number(env.MAX_PER_HOUR) || 300
  let lastHour = Object.values(enviados).filter((e) => e?.via === 'brevo' && now - Number(e.at || 0) < 3600e3).length

  const sender = { email: env.MAIL_FROM, name: env.MAIL_FROM_NAME || 'Liquidação · ID' }
  const sentKey = (k) => k + '|' + mesRef.replace('.', '_')
  const results = []
  const record = {}
  for (const id of keys) {
    const f = funds.get(id)
    const to = String(canais[id] || '').trim().toLowerCase()
    const prev = enviados[sentKey(id)]
    if (!f) { results.push({ id, ok: false, error: 'Fundo não encontrado nesse mês' }); continue }
    if (!to) { results.push({ id, ok: false, error: 'Canal não cadastrado' }); continue }
    if (!EMAIL_RE.test(to) || !allowedDomain(to, env)) { results.push({ id, ok: false, error: 'Canal fora dos domínios permitidos' }); continue }
    // Cada fundo recebe 1 envio automático por competência
    if (prev?.via === 'brevo') { results.push({ id, ok: false, error: 'Já enviado nesta competência' }); continue }
    if (lastHour >= maxHour) { results.push({ id, ok: false, error: 'Limite de envios por hora atingido' }); continue }
    const msg = renderMessage(template, f)
    try {
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          sender,
          to: [{ email: to }],
          subject: msg.subject.slice(0, 300),
          textContent: msg.body.slice(0, 20000),
          ...(env.MAIL_REPLY_TO ? { replyTo: { email: env.MAIL_REPLY_TO } } : {}),
          tags: ['taxas-slack'],
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        lastHour++
        record[sentKey(id)] = { at: Date.now(), by: who, via: 'brevo', to }
        results.push({ id, ok: true })
      } else results.push({ id, ok: false, error: data.message || `Brevo HTTP ${res.status}` })
    } catch {
      results.push({ id, ok: false, error: 'Falha de conexão com o Brevo' })
    }
  }
  let recorded = true
  if (Object.keys(record).length) { try { await recordSent(env, record) } catch { recorded = false } }
  return json({ sent: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, recorded, results })
}
