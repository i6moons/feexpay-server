/**
 * Réseaux Mobile Money documentés par FeexPay (« API - Payin », docs.feexpay.me, API v2).
 * La clé de chaque réseau est le segment d'URL : POST /api/transactions/public/requesttopay/{clé}.
 */

export type Country = 'BJ' | 'TG' | 'CI' | 'CG' | 'SN' | 'BF'

export type Network =
  | 'mtn'
  | 'moov'
  | 'celtiis_bj'
  | 'coris'
  | 'togocom_tg'
  | 'moov_tg'
  | 'mtn_ci'
  | 'moov_ci'
  | 'wave_ci'
  | 'orange_ci'
  | 'mtn_cg'
  | 'orange_sn'
  | 'wave_sn'
  | 'free_sn'
  | 'moov_bf'
  | 'orange_bf'
  | 'wave_bf'

/**
 * Comment le client valide le paiement :
 * - `push` : demande envoyée sur son téléphone (PIN) ;
 * - `redirect` : FeexPay peut renvoyer un `paymentUrl` vers la page de l'opérateur ;
 * - `otp-two-step` : un premier appel envoie un code par SMS, un second appel le transmet ;
 * - `otp-upfront` : le client génère un code (USSD) avant l'appel, à passer dans `otp`.
 */
export type PaymentFlow = 'push' | 'redirect' | 'otp-two-step' | 'otp-upfront'

export interface NetworkInfo {
  id: Network
  country: Country
  name: string
  flow: PaymentFlow
  currency: 'XOF' | 'XAF'
  /** Simulé par la sandbox FeexPay (section « Available channels »). */
  sandbox: boolean
  /** Précision de la documentation, si elle existe. */
  note?: string
}

const n = (id: Network, country: Country, name: string, flow: PaymentFlow, sandbox: boolean, note?: string): NetworkInfo => ({
  id,
  country,
  name,
  flow,
  currency: country === 'CG' ? 'XAF' : 'XOF',
  sandbox,
  ...(note ? { note } : {}),
})

export const NETWORKS: Readonly<Record<Network, NetworkInfo>> = {
  mtn: n('mtn', 'BJ', 'MTN MoMo Bénin', 'push', true),
  moov: n('moov', 'BJ', 'Moov Money Bénin', 'push', true),
  celtiis_bj: n('celtiis_bj', 'BJ', 'Celtiis Cash', 'push', true),
  coris: n('coris', 'BJ', 'Coris Money Bénin', 'otp-two-step', false, 'Appelez une première fois sans `otp` (code envoyé par SMS), puis une seconde fois avec le code.'),
  togocom_tg: n('togocom_tg', 'TG', 'T-Money (Togocom)', 'push', true),
  moov_tg: n('moov_tg', 'TG', 'Flooz (Moov Togo)', 'push', true),
  mtn_ci: n('mtn_ci', 'CI', "MTN MoMo Côte d'Ivoire", 'push', true),
  moov_ci: n('moov_ci', 'CI', "Moov Money Côte d'Ivoire", 'redirect', true),
  wave_ci: n('wave_ci', 'CI', "Wave Côte d'Ivoire", 'redirect', true),
  orange_ci: n('orange_ci', 'CI', "Orange Money Côte d'Ivoire", 'redirect', true),
  mtn_cg: n('mtn_cg', 'CG', 'MTN MoMo Congo', 'push', true),
  orange_sn: n('orange_sn', 'SN', 'Orange Money Sénégal', 'redirect', true),
  wave_sn: n('wave_sn', 'SN', 'Wave Sénégal', 'redirect', true),
  free_sn: n('free_sn', 'SN', 'Free Money Sénégal', 'push', true),
  moov_bf: n('moov_bf', 'BF', 'Moov Money Burkina Faso', 'push', false),
  orange_bf: n('orange_bf', 'BF', 'Orange Money Burkina Faso', 'otp-upfront', false, 'Le client compose #144*4*6*montant# sur son téléphone Orange BF, puis vous transmet le code reçu.'),
  wave_bf: n('wave_bf', 'BF', 'Wave Burkina Faso', 'redirect', false),
}

export interface CountryInfo {
  name: string
  callingCode: string
  /** Chiffres du numéro national, indicatif exclu. */
  nationalLength: number
  /** Numéro complet attendu par FeexPay : indicatif + numéro national, chiffres seuls. */
  pattern: RegExp
  example: string
}

/**
 * Formats tirés de la documentation (« API - Payin » et « Sandbox ») :
 * Bénin « 10-digit number with 01 prefix » (2290166000000), Côte d'Ivoire 225 + 10 chiffres,
 * Sénégal 221 + 9 chiffres, Togo 228 + 8, Burkina Faso 226 + 8, Congo 242 + 9 (242061000000).
 */
export const COUNTRIES: Readonly<Record<Country, CountryInfo>> = {
  BJ: { name: 'Bénin', callingCode: '229', nationalLength: 10, pattern: /^22901\d{8}$/, example: '01 97 00 00 00' },
  TG: { name: 'Togo', callingCode: '228', nationalLength: 8, pattern: /^228\d{8}$/, example: '90 00 00 00' },
  CI: { name: "Côte d'Ivoire", callingCode: '225', nationalLength: 10, pattern: /^225\d{10}$/, example: '05 07 70 00 00' },
  CG: { name: 'Congo', callingCode: '242', nationalLength: 9, pattern: /^242\d{9}$/, example: '06 100 0000' },
  SN: { name: 'Sénégal', callingCode: '221', nationalLength: 9, pattern: /^221\d{9}$/, example: '77 000 00 00' },
  BF: { name: 'Burkina Faso', callingCode: '226', nationalLength: 8, pattern: /^226\d{8}$/, example: '70 00 00 00' },
}

export function isNetwork(value: unknown): value is Network {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(NETWORKS, value)
}

/** Réseaux d'un pays, dans l'ordre de la documentation. */
export function networksOf(country: Country): NetworkInfo[] {
  return Object.values(NETWORKS).filter((network) => network.country === country)
}

/**
 * Numéro au format attendu par FeexPay (indicatif + numéro, chiffres seuls), ou `null` s'il ne
 * correspond pas au pays. Accepte la saisie locale (« 01 97 00 00 00 ») comme internationale
 * (« +229 01 97 00 00 00 », « 00229 01… »).
 */
export function normalizePhoneNumber(input: string, country: Country): string | null {
  const { callingCode, nationalLength, pattern } = COUNTRIES[country]
  let digits = input.replace(/[\s.\-()/]/g, '')
  if (digits.startsWith('+')) digits = digits.slice(1)
  else if (digits.startsWith('00')) digits = digits.slice(2)
  if (!/^\d+$/.test(digits)) return null
  if (digits.length === nationalLength) digits = callingCode + digits
  return pattern.test(digits) ? digits : null
}

/** Pour les journaux : l'indicatif et les deux derniers chiffres suffisent (« +229 ••••••••00 »). */
export function maskPhoneNumber(phoneNumber: string): string {
  const digits = phoneNumber.replace(/\D/g, '')
  const code = Object.values(COUNTRIES).find((c) => digits.startsWith(c.callingCode))?.callingCode
  const rest = code ? digits.slice(code.length) : digits
  return `${code ? `+${code} ` : ''}${'•'.repeat(Math.max(0, rest.length - 2))}${rest.slice(-2)}`
}
