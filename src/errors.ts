/**
 * Catégorie d'une erreur, déduite du statut HTTP, du `code` et du message de FeexPay (section
 * « Error Codes » et « Sandbox > Common errors » de la documentation).
 */
export type FeexPayErrorKind =
  /** 401 : clé absente, invalide ou désactivée (UNAUTHORIZED, API_KEY_BLOCKED). */
  | 'unauthorized'
  /** 403 : IP non autorisée, pays ou réseau bloqué. */
  | 'forbidden'
  /**
   * 403 CARD_PAYMENT_NOT_AUTHORIZED : la carte n'est pas activée sur la boutique (dossier KYB).
   * Absent de la documentation, observé en production.
   */
  | 'card_not_authorized'
  /** 404 : boutique introuvable ou désactivée. */
  | 'shop_not_found'
  /** 404 « {channel} channel not configured » : réseau non activé sur la boutique. */
  | 'channel_not_configured'
  /** 400 ou 503 NETWORK_UNAVAILABLE : réseau non pris en charge ou en maintenance. */
  | 'network_unavailable'
  /** 400 CHANNEL_NOT_AVAILABLE_IN_SANDBOX : réseau non simulé par la sandbox. */
  | 'channel_not_in_sandbox'
  /** 400 INVALID_SANDBOX_TEST_NUMBER : en sandbox, le numéro doit finir par 00 à 06. */
  | 'invalid_sandbox_number'
  /** 400 INVALID_PHONE_NUMBER. */
  | 'invalid_phone_number'
  /** 404 NOT_FOUND : transaction inconnue. */
  | 'not_found'
  /** 409 SEARCHKEY_AMBIGUOUS : plusieurs transactions pour cette recherche. */
  | 'ambiguous'
  /** 429 RATE_LIMIT_EXCEEDED. */
  | 'rate_limited'
  /** Autre 4xx (validation…). */
  | 'bad_request'
  /** 5xx. */
  | 'server_error'
  /** Pas de réponse dans le délai. */
  | 'timeout'
  /** Pas de réponse du tout (réseau). */
  | 'network_error'
  /** Réponse 2xx inexploitable (sans référence, page de paiement inattendue…). */
  | 'invalid_response'

export class FeexPayError extends Error {
  override readonly name = 'FeexPayError'
  readonly kind: FeexPayErrorKind
  /** Statut HTTP, ou 0 si FeexPay n'a pas répondu. */
  readonly status: number
  /** `code` renvoyé par FeexPay, s'il existe. */
  readonly code: string | undefined
  /** Corps de la réponse, déjà décodé (jamais la clé d'API). */
  readonly body: unknown
  /**
   * `true` si la demande de paiement a peut-être atteint FeexPay malgré l'erreur (délai dépassé,
   * coupure, erreur 5xx) : le client peut encore recevoir la demande sur son téléphone. Avant de
   * réessayer, cherchez la transaction avec `findTransaction({ callbackInfo })`.
   */
  readonly outcomeUnknown: boolean

  constructor(init: { kind: FeexPayErrorKind; status: number; code?: string | undefined; body?: unknown; message: string; outcomeUnknown?: boolean }) {
    super(init.message)
    this.kind = init.kind
    this.status = init.status
    this.code = init.code
    this.body = init.body
    this.outcomeUnknown = init.outcomeUnknown ?? false
  }
}

/** Configuration refusée avant tout appel : environnement, clé, boutique. */
export class FeexPayConfigError extends Error {
  override readonly name = 'FeexPayConfigError'
}

/** Paramètre refusé avant tout appel : rien n'a été envoyé à FeexPay. */
export class FeexPayValidationError extends Error {
  override readonly name = 'FeexPayValidationError'
  constructor(readonly field: string, message: string) {
    super(message)
  }
}

export function errorKind(status: number, code: string | undefined, message: string): FeexPayErrorKind {
  if (code === 'NETWORK_UNAVAILABLE') return 'network_unavailable'
  if (code === 'CHANNEL_NOT_AVAILABLE_IN_SANDBOX') return 'channel_not_in_sandbox'
  if (code === 'INVALID_SANDBOX_TEST_NUMBER') return 'invalid_sandbox_number'
  if (code === 'INVALID_PHONE_NUMBER') return 'invalid_phone_number'
  if (code === 'SEARCHKEY_AMBIGUOUS' || status === 409) return 'ambiguous'
  if (code === 'CARD_PAYMENT_NOT_AUTHORIZED') return 'card_not_authorized'
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'forbidden'
  if (status === 404) {
    if (/channel not configured/i.test(message)) return 'channel_not_configured'
    if (/shop/i.test(message)) return 'shop_not_found'
    return 'not_found'
  }
  if (status === 429) return 'rate_limited'
  if (status >= 500) return 'server_error'
  return 'bad_request'
}
