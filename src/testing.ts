/**
 * Simulateur de la sandbox FeexPay, pour vos tests : aucune requête ne part sur le réseau.
 *
 *   const mock = createFeexPayMock()
 *   const feexpay = createFeexPay({ environment: 'sandbox', apiKey: mock.apiKey, shopId: mock.shopId, fetch: mock.fetch })
 *
 * Comportement tiré de la section « Sandbox environment » de la documentation (docs.feexpay.me) :
 * le résultat dépend des deux derniers chiffres du numéro.
 *
 *   00 → SUCCESSFUL               01 → FAILED (solde insuffisant)
 *   02 → HTTP 503, FAILED         03 → PENDING puis FAILED (délai dépassé)
 *   04 → HTTP 400 INVALID_PHONE_NUMBER, FAILED
 *   05 → PENDING puis SUCCESSFUL  06 → PENDING puis FAILED (refusé par le client)
 *   autre → HTTP 400 INVALID_SANDBOX_TEST_NUMBER, aucune transaction
 *
 * Dans la vraie sandbox, la bascule d'un PENDING prend environ 20 s ; ici, elle a lieu après
 * `settleAfter` consultations du statut, ou tout de suite avec `settle()`.
 */
import { COUNTRIES, NETWORKS, isNetwork, type Country, type Network } from './networks.js'

export type MockStatus = 'PENDING' | 'SUCCESSFUL' | 'FAILED'

export interface MockTransaction {
  reference: string
  network: Network | 'card'
  phoneNumber: string
  amount: number
  currency: string
  description: string
  callbackInfo: unknown
  status: MockStatus
  reason: string
  /** Statut vers lequel la transaction basculera. */
  final: { status: 'SUCCESSFUL' | 'FAILED'; reason: string } | null
  lookups: number
  createdAt: Date
}

export interface MockRequest {
  method: string
  url: string
  body: unknown
  authorization: string | null
}

export interface FeexPayMockOptions {
  /** `test_key_mock` par défaut. */
  apiKey?: string
  /** `shop_mock` par défaut. */
  shopId?: string
  /** Consultations du statut avant qu'une transaction PENDING bascule. 1 par défaut. */
  settleAfter?: number
}

export interface FeexPayMock {
  readonly apiKey: string
  readonly shopId: string
  /** À passer à `createFeexPay({ fetch })`. */
  readonly fetch: typeof fetch
  readonly transactions: Map<string, MockTransaction>
  readonly requests: MockRequest[]
  /** Références dont le webhook a été redemandé avec `resendWebhook`. */
  readonly resentWebhooks: string[]
  settleAfter: number
  /** Toute requête échoue comme une coupure réseau. */
  offline: boolean
  /** Délai avant chaque réponse, pour tester `timeoutMs`. */
  latencyMs: number
  last(): MockTransaction | undefined
  /** Fait aboutir une transaction PENDING tout de suite (le client a validé sur son téléphone). */
  settle(reference: string): void
  /** Résultat du paiement sur la page carte. */
  completeCardPayment(reference: string, status: 'SUCCESSFUL' | 'FAILED', reason?: string): void
  /** Modifie ce que l'API de statut renverra : utile pour tester vos contrôles (montant, référence). */
  tamper(reference: string, changes: Partial<Pick<MockTransaction, 'amount' | 'status' | 'callbackInfo' | 'reason'>>): void
  /** La prochaine demande de paiement reçoit cette erreur, sans créer de transaction. */
  failNextRequest(status: number, body: Record<string, unknown>): void
  /** La prochaine demande de paiement crée la transaction, puis la réponse se perd (coupure). */
  loseNextResponse(): void
  /** Le webhook que FeexPay enverrait pour cette transaction. */
  webhookRequest(reference: string, options?: { url?: string; secret?: string; scheme?: 'Bearer' | 'Basic'; payload?: Record<string, unknown> }): Request
}

/** Réseaux simulés dont la réponse porte déjà le statut final (« Immediate response by channel »). */
const IMMEDIATE: ReadonlySet<Network> = new Set(['mtn', 'moov', 'wave_ci', 'orange_ci'])
/** Pour ces réseaux, les scénarios 02 et 04 renvoient FAILED sans erreur HTTP. */
const NO_HTTP_ERROR: ReadonlySet<Network> = new Set(['orange_sn', 'wave_sn', 'free_sn', 'moov_tg'])
/** La sandbox renvoie un faux `payment_url` pour ces réseaux. */
const FAKE_PAYMENT_URL: ReadonlySet<Network> = new Set(['wave_ci', 'orange_ci'])
const CARD_CURRENCIES = new Set(['XOF', 'EUR', 'USD', 'GBP', 'CHF', 'CAD', 'XAF', 'NGN', 'GHS'])

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function randomId(length: number): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
}

function statusBody(t: MockTransaction) {
  return {
    reference: t.reference,
    amount: t.amount,
    phoneNumber: t.phoneNumber,
    status: t.status,
    callback_info: t.callbackInfo ?? null,
    responsecode: t.status,
    responsemsg: t.status,
    transref: t.reference,
    serviceref: t.reference,
    comment: '',
    reason: t.reason,
    description: t.description,
    date: t.createdAt.toISOString(),
    operator_id: t.status === 'SUCCESSFUL' ? '12243963624' : '',
  }
}

function wait(ms: number, signal: AbortSignal | null | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(signal.reason)
    }, { once: true })
  })
}

export function createFeexPayMock(options: FeexPayMockOptions = {}): FeexPayMock {
  const apiKey = options.apiKey ?? 'test_key_mock'
  const shopId = options.shopId ?? 'shop_mock'
  let nextFailure: { status: number; body: Record<string, unknown> } | null = null
  let loseNext = false

  const settle = (t: MockTransaction) => {
    if (!t.final) return
    t.status = t.final.status
    t.reason = t.final.reason
    t.final = null
  }

  async function handle(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
    const request = input instanceof Request ? input : null
    const url = new URL(request ? request.url : String(input))
    const method = (init.method ?? request?.method ?? 'GET').toUpperCase()
    const headers = new Headers(init.headers ?? request?.headers)
    const authorization = headers.get('authorization')
    const rawBody = typeof init.body === 'string' ? init.body : request ? await request.text() : ''
    let body: any
    try {
      body = rawBody ? JSON.parse(rawBody) : undefined
    } catch {
      return json(400, { statusCode: 400, message: 'Invalid JSON' })
    }
    mock.requests.push({ method, url: url.toString(), body, authorization })

    if (mock.latencyMs > 0) await wait(mock.latencyMs, init.signal)
    if (init.signal?.aborted) throw init.signal.reason
    if (mock.offline) throw new TypeError('fetch failed')
    if (authorization !== `Bearer ${apiKey}`) {
      return json(401, { statusCode: 401, message: 'Invalid or expired token', code: 'UNAUTHORIZED' })
    }

    const path = url.pathname

    // Carte (« Sandbox > Card payment »)
    if (method === 'POST' && path === '/api/transactions/public/requesttopay/init') {
      if (body?.shop !== shopId) return json(404, { statusCode: 404, message: 'Merchant or Shop not found' })
      const missing = ['amount', 'first_name', 'last_name', 'email', 'phoneNumber'].filter((k) => body?.[k] === undefined || body[k] === '')
      if (missing.length) return json(400, { statusCode: 400, message: missing.map((k) => `${k} should not be empty`) })
      const currency = String(body.currency ?? 'XOF')
      if (!CARD_CURRENCIES.has(currency)) {
        return json(400, { statusCode: 400, code: 'currency_not_supported', message: `Currency ${currency} is not supported`, supported: [...CARD_CURRENCIES] })
      }
      if (nextFailure) {
        const failure = nextFailure
        nextFailure = null
        return json(failure.status, failure.body)
      }
      const t: MockTransaction = {
        reference: randomId(12),
        network: 'card',
        phoneNumber: String(body.phoneNumber),
        amount: Number(body.amount),
        currency,
        description: body.description ?? '',
        callbackInfo: body.callback_info ?? null,
        status: 'PENDING',
        reason: '',
        final: null,
        lookups: 0,
        createdAt: new Date(),
      }
      mock.transactions.set(t.reference, t)
      return json(200, {
        reference: t.reference,
        status: 'PENDING',
        message: 'Accepted',
        payment_url: `https://sandbox-api.feexpay.me/api/card/sandbox/checkout/card-details?ref=${t.reference}`,
        currency,
        amount: t.amount,
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      })
    }

    // Mobile Money (« Sandbox > Available channels » et « Test numbers »)
    const payin = path.match(/^\/api\/transactions\/public\/requesttopay\/([a-z_]+)$/)
    if (method === 'POST' && payin) {
      const id = payin[1]
      if (!isNetwork(id) || !NETWORKS[id].sandbox) {
        return json(400, { statusCode: 400, code: 'CHANNEL_NOT_AVAILABLE_IN_SANDBOX', message: `Channel ${id} is not available in sandbox` })
      }
      const network = NETWORKS[id]
      if (body?.shop !== shopId) return json(404, { statusCode: 404, message: 'Merchant or Shop not found' })
      if (!Number.isInteger(body?.amount) || body.amount < 10 || body.amount > 1_000_000) {
        return json(400, { statusCode: 400, message: ['amount must be an integer from 10 to 1000000'] })
      }
      const phoneNumber = String(body?.phoneNumber ?? '')
      if (!/^\d+$/.test(phoneNumber) || !phoneNumber.startsWith(COUNTRIES[network.country].callingCode)) {
        return json(400, { statusCode: 400, message: ['phoneNumber does not match the channel format'] })
      }
      if (body.description !== undefined && String(body.description).length > 40) {
        return json(400, { statusCode: 400, message: ['description must be shorter than or equal to 40 characters'] })
      }
      if (nextFailure) {
        const failure = nextFailure
        nextFailure = null
        return json(failure.status, failure.body)
      }
      const suffix = phoneNumber.slice(-2)
      if (!/^0[0-6]$/.test(suffix)) {
        return json(400, { success: false, status: 'FAILED', statusCode: 400, code: 'INVALID_SANDBOX_TEST_NUMBER', message: `Sandbox: ${phoneNumber} is not a test number. Use a number ending in 00 to 06.` })
      }

      const t: MockTransaction = {
        reference: crypto.randomUUID(),
        network: id,
        phoneNumber,
        amount: body.amount,
        currency: network.currency,
        description: body.description ?? '',
        callbackInfo: body.callback_info ?? null,
        status: 'PENDING',
        reason: '',
        final: null,
        lookups: 0,
        createdAt: new Date(),
      }
      mock.transactions.set(t.reference, t)
      const immediate = IMMEDIATE.has(id)
      const outcome = (status: 'SUCCESSFUL' | 'FAILED', reason: string) => {
        if (immediate) {
          t.status = status
          t.reason = reason
        } else {
          t.final = { status, reason }
        }
      }
      switch (suffix) {
        case '00': outcome('SUCCESSFUL', ''); break
        case '01': outcome('FAILED', 'Insufficient balance'); break
        case '02':
          t.status = 'FAILED'
          t.reason = 'Internal Server Error'
          if (!NO_HTTP_ERROR.has(id)) return json(503, { statusCode: 503, message: 'Internal Server Error' })
          break
        case '03': t.final = { status: 'FAILED', reason: 'Timeout' }; break
        case '04':
          t.status = 'FAILED'
          t.reason = 'INVALID_PHONE_NUMBER'
          if (!NO_HTTP_ERROR.has(id)) return json(400, { statusCode: 400, message: 'Invalid phone number', code: 'INVALID_PHONE_NUMBER' })
          break
        case '05': t.final = { status: 'SUCCESSFUL', reason: '' }; break
        case '06': t.final = { status: 'FAILED', reason: 'Declined by customer' }; break
      }
      if (loseNext) {
        loseNext = false
        throw new TypeError('fetch failed')
      }
      return json(200, {
        reference: t.reference,
        message: t.status === 'PENDING' ? 'Accepted' : t.status === 'SUCCESSFUL' ? 'Successful' : 'Failed',
        status: t.status,
        amount: t.amount,
        description: t.description,
        callback_info: t.callbackInfo,
        phoneNumber: t.phoneNumber,
        ...(FAKE_PAYMENT_URL.has(id) ? { payment_url: `https://pay.example.test/${t.reference}` } : {}),
      })
    }

    // Statut (« Check a transaction status »)
    const status = path.match(/^\/api\/transactions\/public\/single\/status\/(.+)$/)
    if (method === 'GET' && status) {
      const value = decodeURIComponent(status[1] ?? '')
      const by = url.searchParams.get('by')
      const matches = by === 'callback_info' || by === 'description'
        ? [...mock.transactions.values()].filter((t) => {
            const field = by === 'callback_info' ? t.callbackInfo : t.description
            return (typeof field === 'string' || typeof field === 'number') && String(field) === value
          })
        : [mock.transactions.get(value)].filter((t): t is MockTransaction => t !== undefined)
      if (matches.length > 1) return json(409, { statusCode: 409, message: 'Several transactions match this search key', code: 'SEARCHKEY_AMBIGUOUS' })
      const t = matches[0]
      if (!t) return json(404, { statusCode: 404, message: 'Transaction not found', code: 'NOT_FOUND' })
      t.lookups += 1
      if (t.final && t.lookups >= mock.settleAfter) settle(t)
      return json(200, statusBody(t))
    }

    // Nouvel envoi du webhook (« Webhook > Resend a webhook »)
    const resend = path.match(/^\/api\/transactions\/resend-webhook\/(.+)$/)
    if (method === 'GET' && resend) {
      const reference = decodeURIComponent(resend[1] ?? '')
      const t = mock.transactions.get(reference)
      if (!t || t.status === 'PENDING') {
        return json(400, { success: false, message: t ? 'Cannot resend webhook: transaction is PENDING (must be SUCCESSFUL or FAILED)' : 'Transaction not found', reference })
      }
      mock.resentWebhooks.push(reference)
      return json(200, { success: true, message: 'Webhook queued for delivery', reference, status: t.status, trigger_code: 'PAYMENT_API' })
    }

    return json(404, { statusCode: 404, message: 'Not Found' })
  }

  const find = (reference: string) => {
    const t = mock.transactions.get(reference)
    if (!t) throw new Error(`Transaction inconnue du simulateur : ${reference}`)
    return t
  }

  const mock: FeexPayMock = {
    apiKey,
    shopId,
    fetch: handle as typeof fetch,
    transactions: new Map(),
    requests: [],
    resentWebhooks: [],
    settleAfter: options.settleAfter ?? 1,
    offline: false,
    latencyMs: 0,
    last: () => [...mock.transactions.values()].at(-1),
    settle: (reference) => settle(find(reference)),
    completeCardPayment(reference, status, reason = '') {
      const t = find(reference)
      if (t.network !== 'card') throw new Error(`${reference} n'est pas un paiement par carte.`)
      t.status = status
      t.reason = reason
    },
    tamper(reference, changes) {
      Object.assign(find(reference), changes)
    },
    failNextRequest(status, body) {
      nextFailure = { status, body }
    },
    loseNextResponse() {
      loseNext = true
    },
    webhookRequest(reference, opts = {}) {
      const t = find(reference)
      const payload = {
        env: 'sandbox',
        reference: t.reference,
        order_id: t.reference,
        status: t.status,
        amount: t.amount,
        callback_info: t.callbackInfo,
        type: 'Paiement',
        phoneNumber: t.phoneNumber,
        reseau: t.network === 'card' ? 'CARD' : NETWORKS[t.network].name,
        reason: t.reason,
        date: new Date().toISOString(),
        first_name: '',
        last_name: '',
        email: '',
        description: t.description,
        ref_link: '',
        ref_operator: '',
        ...opts.payload,
      }
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (opts.secret !== undefined) headers.Authorization = `${opts.scheme ?? 'Bearer'} ${opts.secret}`
      return new Request(opts.url ?? 'https://example.test/api/webhooks/feexpay', { method: 'POST', headers, body: JSON.stringify(payload) })
    },
  }
  return mock
}

/**
 * Numéro de test valide pour le pays, terminé par `suffix` (00 à 06), au format international.
 * Le milieu est aléatoire pour que deux tests n'utilisent pas le même numéro.
 */
export function testPhoneNumber(suffix: '00' | '01' | '02' | '03' | '04' | '05' | '06', country: Country = 'BJ'): string {
  const { callingCode, nationalLength } = COUNTRIES[country]
  const prefix = { BJ: '01', TG: '90', CI: '05', CG: '06', SN: '77', BF: '70' }[country]
  const middleLength = nationalLength - prefix.length - 2
  const middle = Array.from(crypto.getRandomValues(new Uint8Array(middleLength)), (b) => String(b % 10)).join('')
  return `${callingCode}${prefix}${middle}${suffix}`
}
