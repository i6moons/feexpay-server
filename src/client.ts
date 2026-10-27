import { FeexPayConfigError, FeexPayError, FeexPayValidationError, errorKind } from './errors.js'
import { COUNTRIES, NETWORKS, isNetwork, normalizePhoneNumber, type Network } from './networks.js'

export type Environment = 'sandbox' | 'live'

/** « Sandbox environment » et « Key concepts » : sandbox-api pour les tests, api-v2 en production. */
export const API_URLS: Readonly<Record<Environment, string>> = {
  sandbox: 'https://sandbox-api.feexpay.me',
  live: 'https://api-v2.feexpay.me',
}

/** Hôtes de la page de paiement par carte (« Card payment collection », « Sandbox > Card payment »). */
export const CARD_CHECKOUT_HOSTS: Readonly<Record<Environment, readonly string[]>> = {
  sandbox: ['sandbox-api.feexpay.me', 'checkout.feexpay.me'],
  live: ['checkout.feexpay.me'],
}

/** Limites documentées : 100 à 2 000 000 XOF en production, 10 à 1 000 000 en sandbox. */
export const AMOUNT_LIMITS: Readonly<Record<Environment, { min: number; max: number }>> = {
  sandbox: { min: 10, max: 1_000_000 },
  live: { min: 100, max: 2_000_000 },
}

export interface FeexPayOptions {
  environment: Environment
  /** Clé privée de la boutique : `test_key_…` en sandbox, `fp_…` en production. */
  apiKey: string
  /** Identifiant public de la boutique (menu Développeurs). */
  shopId: string
  /** Délai par appel. 10 s par défaut, sous les 15 s que FeexPay laisse à un webhook pour répondre. */
  timeoutMs?: number
  /** `fetch` à utiliser (tests, proxy). Par défaut, le `fetch` global. */
  fetch?: typeof fetch
  /** Remplace l'URL de l'API (proxy, tests). */
  baseUrl?: string
  /** Vérifie le format des numéros avant l'appel. `true` par défaut. */
  validatePhoneNumbers?: boolean
  /**
   * Autorise la création du client dans un navigateur. À ne jamais activer : la clé donne accès
   * à toute l'API de la boutique.
   */
  dangerouslyAllowBrowser?: boolean
}

export type TransactionStatus = 'PENDING' | 'SUCCESSFUL' | 'FAILED'

/** Valeur renvoyée telle quelle par FeexPay : texte, nombre ou objet JSON. */
export type CallbackInfo = string | number | Record<string, unknown>

export interface Transaction {
  reference: string
  /** `SUCCESSFUL` et `FAILED` sont finaux ; toute autre valeur (« IN PENDING STATE »…) vaut `PENDING`. */
  status: TransactionStatus
  rawStatus: string
  amount: number
  phoneNumber: string | null
  callbackInfo: unknown
  /** Cause d'un échec, par exemple `LOW_BALANCE_OR_PAYEE_LIMIT_REACHED_OR_NOT_ALLOWED`. */
  reason: string | null
  description: string | null
  date: string | null
  operatorId: string | null
  raw: Record<string, unknown>
}

export interface PaymentRequest {
  network: Network
  /** Saisie locale (« 01 97 00 00 00 ») ou internationale (« +229… »). */
  phoneNumber: string
  /** Montant entier, calculé par votre serveur, jamais reçu du navigateur. */
  amount: number
  /** 40 caractères au plus, sans caractères spéciaux. */
  description?: string
  /**
   * Renvoyé tel quel par le webhook et l'API de statut. Utilisez un identifiant d'un seul mot
   * (« order_42 ») pour pouvoir retrouver la transaction avec `findTransaction`.
   */
  callbackInfo?: CallbackInfo
  firstName?: string
  lastName?: string
  email?: string
  /** Coris (seconde étape) et Orange Burkina Faso. */
  otp?: string
  /** Réseaux à redirection (Wave, Orange…) : page de retour après le paiement. */
  returnUrl?: string
  cancelUrl?: string
}

export interface PaymentRequestResult {
  reference: string
  status: TransactionStatus
  rawStatus: string
  message: string | null
  /** Page de l'opérateur où envoyer le client (Wave, Orange…), en https uniquement. */
  paymentUrl: string | null
  raw: Record<string, unknown>
}

export interface CardCustomer {
  firstName: string
  lastName: string
  email: string
  /** Indicatif compris (« 2290160000000 »). */
  phoneNumber: string
  city: string
  /** La documentation donne « 00229 » pour Cotonou. */
  zip: string
  /** Code ISO à deux lettres (« BJ », « CI »…). */
  country: string
}

export interface CardPaymentRequest {
  amount: number
  /** `XOF` par défaut. */
  currency?: string
  customer: CardCustomer
  description?: string
  callbackInfo?: CallbackInfo
  returnUrl?: string
  cancelUrl?: string
}

export interface CardPaymentResult {
  reference: string
  status: TransactionStatus
  /** Page de paiement FeexPay, vérifiée : seuls les hôtes FeexPay documentés sont acceptés. */
  paymentUrl: string
  /** Fin de validité de la page ; après, la transaction devient `FAILED`. */
  expiresAt: Date | null
  raw: Record<string, unknown>
}

export interface WaitOptions {
  /** 3 s par défaut. */
  intervalMs?: number
  /** 3 minutes par défaut. */
  timeoutMs?: number
  signal?: AbortSignal
}

export interface FeexPay {
  readonly environment: Environment
  /** Demande de paiement Mobile Money. La réponse est le plus souvent `PENDING`. */
  requestPayment(request: PaymentRequest): Promise<PaymentRequestResult>
  /** Statut d'une transaction, ou `null` si FeexPay ne la connaît pas. */
  getTransaction(reference: string): Promise<Transaction | null>
  /** Recherche par `callback_info` ou `description` (un seul mot), ou `null`. */
  findTransaction(query: { callbackInfo: string } | { description: string }): Promise<Transaction | null>
  /** Interroge le statut jusqu'à un état final, ou jusqu'au délai (renvoie alors le dernier état). */
  waitForFinalStatus(reference: string, options?: WaitOptions): Promise<Transaction | null>
  /** Prépare un paiement par carte : envoyez ensuite le client sur `paymentUrl`. */
  createCardPayment(request: CardPaymentRequest): Promise<CardPaymentResult>
  /** Redemande l'envoi du webhook d'une transaction finale. */
  resendWebhook(reference: string): Promise<{ message: string | null; status: TransactionStatus | null }>
}

const DEFAULT_TIMEOUT_MS = 10_000

export function normalizeStatus(raw: unknown): TransactionStatus {
  if (raw === 'SUCCESSFUL') return 'SUCCESSFUL'
  if (raw === 'FAILED') return 'FAILED'
  return 'PENDING'
}

function textOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

export function readTransaction(body: unknown): Transaction | null {
  const raw = asRecord(body)
  if (typeof raw.reference !== 'string' || !raw.reference) return null
  return {
    reference: raw.reference,
    status: normalizeStatus(raw.status),
    rawStatus: typeof raw.status === 'string' ? raw.status : String(raw.status ?? ''),
    amount: Number(raw.amount) || 0,
    phoneNumber: textOrNull(raw.phoneNumber),
    callbackInfo: raw.callback_info ?? null,
    reason: textOrNull(raw.reason),
    description: textOrNull(raw.description),
    date: textOrNull(raw.date),
    operatorId: textOrNull(raw.operator_id),
    raw,
  }
}

/** URL en https, sans identifiants, et sur l'un des hôtes donnés si la liste est fournie. */
export function safeUrl(value: unknown, hosts?: readonly string[]): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password) return null
    if (hosts && !hosts.includes(url.hostname)) return null
    return url.toString()
  } catch {
    return null
  }
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isBrowser(): boolean {
  return typeof (globalThis as { window?: unknown }).window !== 'undefined' && typeof (globalThis as { document?: unknown }).document !== 'undefined'
}

export function createFeexPay(options: FeexPayOptions): FeexPay {
  const environment = options.environment
  if (environment !== 'sandbox' && environment !== 'live') {
    throw new FeexPayConfigError(`environment doit valoir 'sandbox' ou 'live' (reçu : ${environment === undefined ? 'rien' : JSON.stringify(environment)}).`)
  }
  if (isBrowser() && !options.dangerouslyAllowBrowser) {
    throw new FeexPayConfigError('feexpay-server ne doit pas tourner dans un navigateur : la clé FeexPay donne accès à toute l\'API de la boutique. Appelez votre propre API depuis le navigateur.')
  }
  // Copiée depuis le tableau de bord, une clé arrive souvent avec un espace ou un retour à la ligne.
  const apiKey = clean(options.apiKey)
  const shopId = clean(options.shopId)
  if (!apiKey) throw new FeexPayConfigError('apiKey est vide.')
  if (!shopId) throw new FeexPayConfigError('shopId est vide.')
  // « Key concepts » : `test_` en sandbox, `fp_` en production. La clé de l'autre environnement
  // serait refusée (401) au premier paiement : mieux vaut le dire tout de suite.
  if (environment === 'live' && apiKey.startsWith('test_')) {
    throw new FeexPayConfigError("Clé de sandbox (test_…) utilisée avec environment 'live'.")
  }
  if (environment === 'sandbox' && apiKey.startsWith('fp_')) {
    throw new FeexPayConfigError("Clé de production (fp_…) utilisée avec environment 'sandbox'.")
  }

  const baseUrl = (options.baseUrl ?? API_URLS[environment]).replace(/\/+$/, '')
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const doFetch = options.fetch ?? globalThis.fetch
  const validatePhones = options.validatePhoneNumbers ?? true
  const limits = AMOUNT_LIMITS[environment]

  async function call(method: 'GET' | 'POST', path: string, body?: unknown, payment = false): Promise<unknown> {
    let response: Response
    try {
      response = await doFetch(`${baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (error) {
      const timeout = (error as { name?: string })?.name === 'TimeoutError'
      // Jamais la clé dans le message : la méthode, le chemin et la cause technique suffisent.
      throw new FeexPayError({
        kind: timeout ? 'timeout' : 'network_error',
        status: 0,
        message: `FeexPay n'a pas répondu (${method} ${path}) : ${timeout ? `délai de ${timeoutMs} ms dépassé` : (error as Error)?.message ?? String(error)}`,
        outcomeUnknown: payment,
      })
    }

    const text = await response.text()
    let parsed: unknown = null
    try {
      parsed = text ? JSON.parse(text) : null
    } catch {
      parsed = text
    }
    if (!response.ok) {
      const record = asRecord(parsed)
      const detail = Array.isArray(record.message) ? record.message.join(' ; ') : typeof record.message === 'string' ? record.message : ''
      const code = typeof record.code === 'string' ? record.code : undefined
      const kind = errorKind(response.status, code, detail)
      throw new FeexPayError({
        kind,
        status: response.status,
        code,
        body: parsed,
        message: `FeexPay ${method} ${path} : HTTP ${response.status}${code ? ` ${code}` : ''}${detail ? ` — ${detail}` : ''}`,
        // Un 5xx peut arriver après l'envoi de la demande au téléphone ; une maintenance documentée
        // (NETWORK_UNAVAILABLE) signifie au contraire que rien n'est parti.
        outcomeUnknown: payment && response.status >= 500 && kind !== 'network_unavailable',
      })
    }
    return parsed
  }

  function checkAmount(amount: number, integer: boolean): void {
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || (integer && !Number.isInteger(amount))) {
      throw new FeexPayValidationError('amount', `amount doit être un nombre${integer ? ' entier' : ''} positif (reçu : ${amount}).`)
    }
  }

  function checkDescription(description: string | undefined): void {
    if (description !== undefined && description.length > 40) {
      throw new FeexPayValidationError('description', 'description : 40 caractères au plus.')
    }
  }

  function checkCallbackInfo(value: CallbackInfo | undefined): void {
    if (value === undefined) return
    // « Sandbox > Request body » : 2 000 caractères pour un texte, 5 000 une fois sérialisé pour un objet.
    if (typeof value === 'string' && value.length > 2000) {
      throw new FeexPayValidationError('callbackInfo', 'callbackInfo : 2 000 caractères au plus.')
    }
    if (typeof value === 'object' && JSON.stringify(value).length > 5000) {
      throw new FeexPayValidationError('callbackInfo', 'callbackInfo : 5 000 caractères au plus une fois sérialisé.')
    }
  }

  function checkReference(reference: string, field = 'reference'): string {
    const value = clean(reference)
    if (!value) throw new FeexPayValidationError(field, `${field} est vide.`)
    return value
  }

  const client: FeexPay = {
    environment,

    async requestPayment(request) {
      if (!isNetwork(request.network)) {
        throw new FeexPayValidationError('network', `Réseau inconnu : ${String(request.network)}.`)
      }
      const network = NETWORKS[request.network]
      checkAmount(request.amount, true)
      if (request.amount < limits.min || request.amount > limits.max) {
        throw new FeexPayValidationError('amount', `amount : de ${limits.min} à ${limits.max} en ${environment} (reçu : ${request.amount}).`)
      }
      checkDescription(request.description)
      checkCallbackInfo(request.callbackInfo)
      let phoneNumber = clean(request.phoneNumber).replace(/[\s.\-()/]/g, '').replace(/^\+/, '')
      if (validatePhones) {
        const normalized = normalizePhoneNumber(request.phoneNumber ?? '', network.country)
        if (!normalized) {
          const country = COUNTRIES[network.country]
          throw new FeexPayValidationError('phoneNumber', `Numéro invalide pour ${network.name} (exemple : ${country.example} ou +${country.callingCode}…).`)
        }
        phoneNumber = normalized
      }
      if (network.flow === 'otp-upfront' && !clean(request.otp)) {
        throw new FeexPayValidationError('otp', `${network.name} : otp est obligatoire. ${network.note ?? ''}`.trim())
      }
      const returnUrl = request.returnUrl === undefined ? undefined : safeUrl(request.returnUrl)
      const cancelUrl = request.cancelUrl === undefined ? undefined : safeUrl(request.cancelUrl)
      if (returnUrl === null) throw new FeexPayValidationError('returnUrl', 'returnUrl doit être une URL https.')
      if (cancelUrl === null) throw new FeexPayValidationError('cancelUrl', 'cancelUrl doit être une URL https.')

      const body: Record<string, unknown> = {
        shop: shopId,
        amount: request.amount,
        phoneNumber,
        ...(request.description !== undefined ? { description: request.description } : {}),
        ...(request.callbackInfo !== undefined ? { callback_info: request.callbackInfo } : {}),
        ...(request.firstName !== undefined ? { first_name: request.firstName } : {}),
        ...(request.lastName !== undefined ? { last_name: request.lastName } : {}),
        ...(request.email !== undefined ? { email: request.email } : {}),
        ...(returnUrl ? { return_url: returnUrl } : {}),
        ...(cancelUrl ? { cancel_url: cancelUrl } : {}),
      }
      // Coris : « otp — Leave empty » à la première étape, le code reçu par SMS à la seconde.
      if (network.flow === 'otp-two-step') body.otp = clean(request.otp)
      else if (request.otp !== undefined) body.otp = clean(request.otp)

      const raw = asRecord(await call('POST', `/api/transactions/public/requesttopay/${network.id}`, body, true))
      if (typeof raw.reference !== 'string' || !raw.reference) {
        throw new FeexPayError({ kind: 'invalid_response', status: 200, body: raw, message: 'Réponse FeexPay sans référence de transaction.', outcomeUnknown: true })
      }
      return {
        reference: raw.reference,
        status: normalizeStatus(raw.status),
        rawStatus: typeof raw.status === 'string' ? raw.status : '',
        message: textOrNull(raw.message),
        paymentUrl: safeUrl(raw.payment_url),
        raw,
      }
    },

    async getTransaction(reference) {
      const value = checkReference(reference)
      try {
        return readTransaction(await call('GET', `/api/transactions/public/single/status/${encodeURIComponent(value)}`))
      } catch (error) {
        if (error instanceof FeexPayError && error.kind === 'not_found') return null
        throw error
      }
    },

    async findTransaction(query) {
      const [by, raw] = 'callbackInfo' in query ? (['callback_info', query.callbackInfo] as const) : (['description', query.description] as const)
      const value = checkReference(raw, by === 'callback_info' ? 'callbackInfo' : 'description')
      // « Alternative lookup » : la valeur doit être un seul mot, sans espace.
      if (/\s/.test(value)) {
        throw new FeexPayValidationError(by === 'callback_info' ? 'callbackInfo' : 'description', 'La recherche ne fonctionne que sur un seul mot, sans espace.')
      }
      try {
        return readTransaction(await call('GET', `/api/transactions/public/single/status/${encodeURIComponent(value)}?by=${by}`))
      } catch (error) {
        if (error instanceof FeexPayError && error.kind === 'not_found') return null
        throw error
      }
    },

    async waitForFinalStatus(reference, waitOptions = {}) {
      const intervalMs = waitOptions.intervalMs ?? 3_000
      const deadline = Date.now() + (waitOptions.timeoutMs ?? 180_000)
      let last: Transaction | null = null
      for (;;) {
        waitOptions.signal?.throwIfAborted()
        last = await client.getTransaction(reference)
        if (last && last.status !== 'PENDING') return last
        if (Date.now() + intervalMs > deadline) return last
        await sleep(intervalMs, waitOptions.signal)
      }
    },

    async createCardPayment(request) {
      checkAmount(request.amount, false)
      checkDescription(request.description)
      checkCallbackInfo(request.callbackInfo)
      const customer = request.customer
      const required: (keyof CardCustomer)[] = ['firstName', 'lastName', 'email', 'phoneNumber', 'city', 'zip', 'country']
      for (const field of required) {
        if (!clean(customer?.[field])) throw new FeexPayValidationError(`customer.${field}`, `customer.${field} est obligatoire.`)
      }
      const country = clean(customer.country).toUpperCase()
      if (!/^[A-Z]{2}$/.test(country)) throw new FeexPayValidationError('customer.country', 'customer.country : code ISO à deux lettres (« BJ »).')
      const returnUrl = request.returnUrl === undefined ? undefined : safeUrl(request.returnUrl)
      const cancelUrl = request.cancelUrl === undefined ? undefined : safeUrl(request.cancelUrl)
      if (returnUrl === null) throw new FeexPayValidationError('returnUrl', 'returnUrl doit être une URL https.')
      if (cancelUrl === null) throw new FeexPayValidationError('cancelUrl', 'cancelUrl doit être une URL https.')

      const raw = asRecord(
        await call(
          'POST',
          '/api/transactions/public/requesttopay/init',
          {
            shop: shopId,
            amount: String(request.amount), // « Transaction amount, sent as a string »
            currency: clean(request.currency).toUpperCase() || 'XOF',
            first_name: clean(customer.firstName),
            last_name: clean(customer.lastName),
            email: clean(customer.email),
            phoneNumber: clean(customer.phoneNumber).replace(/[\s.\-()/]/g, ''),
            city: clean(customer.city),
            zip: clean(customer.zip),
            country,
            ...(request.description !== undefined ? { description: request.description } : {}),
            ...(request.callbackInfo !== undefined ? { callback_info: request.callbackInfo } : {}),
            ...(returnUrl ? { return_url: returnUrl } : {}),
            ...(cancelUrl ? { cancel_url: cancelUrl } : {}),
          },
          true,
        ),
      )
      if (typeof raw.reference !== 'string' || !raw.reference) {
        throw new FeexPayError({ kind: 'invalid_response', status: 200, body: raw, message: 'Réponse FeexPay (carte) sans référence de transaction.', outcomeUnknown: true })
      }
      // Le client ne doit jamais être envoyé ailleurs que sur la page FeexPay, même sur une réponse inattendue.
      const paymentUrl = safeUrl(raw.payment_url, CARD_CHECKOUT_HOSTS[environment])
      if (!paymentUrl) {
        throw new FeexPayError({
          kind: 'invalid_response',
          status: 200,
          body: raw,
          message: `Réponse FeexPay (carte) sans page de paiement ${CARD_CHECKOUT_HOSTS[environment].join(' ou ')} (référence ${raw.reference}).`,
        })
      }
      const expires = typeof raw.expires_at === 'string' ? new Date(raw.expires_at) : null
      return {
        reference: raw.reference,
        status: normalizeStatus(raw.status),
        paymentUrl,
        expiresAt: expires && !Number.isNaN(expires.getTime()) ? expires : null,
        raw,
      }
    },

    async resendWebhook(reference) {
      const value = checkReference(reference)
      const raw = asRecord(await call('GET', `/api/transactions/resend-webhook/${encodeURIComponent(value)}`))
      return {
        message: textOrNull(raw.message),
        status: typeof raw.status === 'string' ? normalizeStatus(raw.status) : null,
      }
    },
  }
  return client
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal?.reason)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
