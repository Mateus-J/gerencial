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
//
// Segurança: a chave nunca vai para o navegador; a função só entrega para os
// domínios permitidos (por padrão, só e-mails de canal do Slack), só aceita
// chamadas vindas do próprio site e limita o tamanho de cada envio.

const MAX_MESSAGES = 50
const MAX_BODY = 20000
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })

function allowedDomain(email, env) {
  const domain = email.split('@')[1]?.toLowerCase() || ''
  const list = (env.ALLOWED_DOMAINS || 'slack.com').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean)
  return list.some((d) => domain === d || domain.endsWith('.' + d))
}

function sameOrigin(request) {
  const origin = request.headers.get('origin')
  if (!origin) return false
  const host = new URL(request.url).host
  try { return new URL(origin).host === host } catch { return false }
}

export async function onRequestGet({ env }) {
  return json({
    configured: Boolean(env.BREVO_API_KEY && env.MAIL_FROM),
    from: env.MAIL_FROM || null,
    fromName: env.MAIL_FROM_NAME || 'Liquidação · ID',
    allowedDomains: (env.ALLOWED_DOMAINS || 'slack.com').split(',').map((d) => d.trim()),
  })
}

export async function onRequestPost({ request, env }) {
  if (!env.BREVO_API_KEY || !env.MAIL_FROM) return json({ error: 'Envio não configurado no Cloudflare (BREVO_API_KEY / MAIL_FROM).' }, 503)
  if (!sameOrigin(request)) return json({ error: 'Origem não permitida.' }, 403)

  let payload
  try { payload = await request.json() } catch { return json({ error: 'JSON inválido.' }, 400) }
  const messages = Array.isArray(payload?.messages) ? payload.messages : []
  if (!messages.length) return json({ error: 'Nenhuma mensagem.' }, 400)
  if (messages.length > MAX_MESSAGES) return json({ error: `Máximo de ${MAX_MESSAGES} mensagens por envio.` }, 400)

  const sender = { email: env.MAIL_FROM, name: env.MAIL_FROM_NAME || 'Liquidação · ID' }
  const results = []
  for (const m of messages) {
    const to = String(m?.to || '').trim().toLowerCase()
    const subject = String(m?.subject || '').slice(0, 300)
    const body = String(m?.body || '')
    const id = m?.id ?? null
    if (!EMAIL_RE.test(to)) { results.push({ id, to, ok: false, error: 'E-mail inválido' }); continue }
    if (!allowedDomain(to, env)) { results.push({ id, to, ok: false, error: 'Destino fora dos domínios permitidos' }); continue }
    if (!subject || !body || body.length > MAX_BODY) { results.push({ id, to, ok: false, error: 'Assunto/mensagem vazio ou grande demais' }); continue }
    try {
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          sender,
          to: [{ email: to }],
          subject,
          textContent: body,
          ...(env.MAIL_REPLY_TO ? { replyTo: { email: env.MAIL_REPLY_TO } } : {}),
          tags: ['taxas-slack'],
        }),
      })
      const data = await res.json().catch(() => ({}))
      results.push(res.ok ? { id, to, ok: true, messageId: data.messageId || null } : { id, to, ok: false, error: data.message || `Brevo HTTP ${res.status}` })
    } catch {
      results.push({ id, to, ok: false, error: 'Falha de conexão com o Brevo' })
    }
  }
  return json({ sent: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results })
}
