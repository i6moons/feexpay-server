import { FeexPayConfigError, FeexPayError } from './errors.js'
import { normalizeStatus, type FeexPay, type Transaction, type TransactionStatus } from './client.js'

/**
 * Corps d'un webhook FeexPay (« Webhook > Example payload »). Ce n'est qu'une ANNONCE : le webhook
 * n'est pas signé, son contenu peut être forgé. Seule l'API de statut fait foi.
 */
export interface WebhookPayload {
  reference: string
  announcedStatus: TransactionStatus
  /** `Paiement` pour une collecte, `Payout` pour un décaissement. */
  type: string
  /** `"sandbox"` en sandbox ; la valeur en production n'est pas documentée. */
  env: string | null
  amount: number
  callbackInfo: unknown
  raw: Record<string, unknown>
}

export function parseWebhookPayload(body: unknown): WebhookPayload | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const raw = body as Record<string, unknown>
  if (typeof raw.reference !== 'string' || !raw.reference) return null
  return {
    reference: raw.reference,
    announcedStatus: normalizeStatus(raw.status),
    type: typeof raw.type === 'string' ? raw.type : '',
    env: typeof raw.env === 'string' ? raw.env : null,
    amount: Number(raw.amount) || 0,
    callbackInfo: raw.callback_info ?? null,
    raw,
  }
}

/** Comparaison en temps constant, sans `node:crypto` pour fonctionner aussi en Edge. */
function safeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder()
  const x = encoder.encode(a)
  const y = encoder.encode(b)
  let diff = x.length ^ y.length
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}

/**
 * FeexPay envoie `Authorization: <auth_type> <auth_value>`, tels que saisis dans la section
 * Webhooks du tableau de bord (`Bearer` ou `Basic`). Sans secret, tout est refusé.
 */
export function verifyWebhookAuthorization(header: string | null | undefined, secret: string, scheme: 'Bearer' | 'Basic' = 'Bearer'): boolean {
  if (!secret || !header) return false
  return safeEqual(header.trim(), `${scheme} ${secret}`)
}

export interface VerifiedWebhookEvent {
  /** Transaction relue auprès de l'API de statut : c'est elle qui fait foi. */
  transaction: Transaction & { status: 'SUCCESSFUL' | 'FAILED' }
  /** Ce que le webhook annonçait, pour vos journaux. */
  payload: WebhookPayload
}

export type IgnoredReason = 'other_environment' | 'payout' | 'unknown_reference'

export interface WebhookHandlerOptions {
  /** Le client, ou une fonction qui le crée au premier webhook (utile au build de Next.js). */
  feexpay: FeexPay | (() => FeexPay)
  /**
   * Valeur `auth_value` saisie dans le tableau de bord FeexPay, ou une fonction qui la lit au
   * premier webhook (`() => process.env.FEEXPAY_WEBHOOK_SECRET`). `null` désactive la vérification :
   * les paiements restent revérifiés, mais n'importe qui peut alors déclencher ces vérifications.
   */
  secret: string | null | (() => string | null | undefined)
  /** `Bearer` par défaut. */
  scheme?: 'Bearer' | 'Basic'
  /**
   * Paiement confirmé par l'API de statut (`SUCCESSFUL` ou `FAILED`). Doit être idempotent : la
   * même référence peut arriver deux fois (nouvel essai de FeexPay, `resendWebhook`). Vérifiez
   * aussi que `transaction.amount` couvre votre commande.
   */
  onPayment: (event: VerifiedWebhookEvent) => void | Promise<void>
  /** Webhook écarté sans erreur (autre environnement, décaissement, référence inconnue). */
  onIgnored?: (reason: IgnoredReason, payload: WebhookPayload) => void
  /** Erreur levée par `onPayment` (FeexPay recevra un 500). Par défaut : `console.error`. */
  onError?: (error: unknown, event: VerifiedWebhookEvent) => void
}

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/**
 * Gestionnaire de webhook au format Web standard (`Request` → `Response`) : route handler Next.js,
 * Hono, Bun, Deno, Cloudflare Workers.
 *
 * Règles de livraison de FeexPay (« Sandbox > Delivery rules ») : réponse 2xx attendue en 15 s ;
 * un 4xx n'est jamais rejoué ; un 5xx ou un 429 l'est une seule fois, 5 s plus tard. D'où :
 * 401 et 400 pour un webhook illégitime ou illisible, 503 si FeexPay ne répond pas pendant la
 * vérification (pour obtenir le nouvel essai), 500 si `onPayment` échoue.
 */
export function createWebhookHandler(options: WebhookHandlerOptions): (request: Request) => Promise<Response> {
  const emptySecret = () =>
    new FeexPayConfigError('secret est vide : passez la valeur saisie dans le tableau de bord FeexPay, ou null pour désactiver la vérification.')
  if (options.secret !== null && typeof options.secret !== 'function' && !options.secret) throw emptySecret()
  let client: FeexPay | null = typeof options.feexpay === 'function' ? null : options.feexpay
  const getClient = () => (client ??= (options.feexpay as () => FeexPay)())
  let secret: string | null | undefined = typeof options.secret === 'function' ? undefined : options.secret
  const getSecret = (): string | null => {
    if (secret === undefined) {
      const value = (options.secret as () => string | null | undefined)()
      if (value !== null && !value) throw emptySecret()
      secret = value
    }
    return secret
  }

  return async (request) => {
    if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' })
    const expected = getSecret()
    if (expected !== null && !verifyWebhookAuthorization(request.headers.get('authorization'), expected, options.scheme)) {
      return json(401, { error: 'unauthorized' })
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return json(400, { error: 'invalid_json' })
    }
    const payload = parseWebhookPayload(body)
    if (!payload) return json(400, { error: 'invalid_payload' })

    const feexpay = getClient()
    // « Check the env field so you never process a sandbox event as a real payment. »
    const sandboxEvent = payload.env === 'sandbox'
    if (sandboxEvent !== (feexpay.environment === 'sandbox')) {
      options.onIgnored?.('other_environment', payload)
      return json(200, { received: true, ignored: 'other_environment' })
    }
    if (payload.type === 'Payout') {
      options.onIgnored?.('payout', payload)
      return json(200, { received: true, ignored: 'payout' })
    }

    let transaction: Transaction | null
    try {
      transaction = await feexpay.getTransaction(payload.reference)
    } catch (error) {
      if (error instanceof FeexPayError) return json(503, { error: 'verification_unavailable' })
      throw error
    }
    if (!transaction) {
      options.onIgnored?.('unknown_reference', payload)
      return json(200, { received: true, ignored: 'unknown_reference' })
    }
    // FeexPay n'envoie un webhook que pour un statut final : si l'API dit encore PENDING, un
    // 503 obtient le nouvel essai, 5 s plus tard.
    if (transaction.status === 'PENDING') return json(503, { error: 'still_pending' })

    const event: VerifiedWebhookEvent = { transaction: transaction as VerifiedWebhookEvent['transaction'], payload }
    try {
      await options.onPayment(event)
    } catch (error) {
      if (options.onError) options.onError(error, event)
      else console.error(`[feexpay-server] onPayment a échoué pour ${transaction.reference} :`, error)
      return json(500, { error: 'handler_failed' })
    }
    return json(200, { received: true, status: transaction.status })
  }
}
