import { afterEach, describe, expect, it } from 'vitest'
import { FeexPayConfigError, FeexPayError, FeexPayValidationError, createFeexPay, type FeexPay } from '../src/index.js'
import { createFeexPayMock, testPhoneNumber, type FeexPayMock } from '../src/testing.js'

function setup(options: { settleAfter?: number; timeoutMs?: number } = {}): { mock: FeexPayMock; feexpay: FeexPay } {
  const mock = createFeexPayMock({ settleAfter: options.settleAfter })
  const feexpay = createFeexPay({
    environment: 'sandbox',
    apiKey: mock.apiKey,
    shopId: mock.shopId,
    fetch: mock.fetch,
    ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
  })
  return { mock, feexpay }
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('La promesse aurait dû être rejetée.')
}

describe('configuration', () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).window
    delete (globalThis as Record<string, unknown>).document
  })

  it("refuse un environnement absent ou inconnu", () => {
    expect(() => createFeexPay({ environment: 'prod' as never, apiKey: 'fp_x', shopId: 's' })).toThrow(FeexPayConfigError)
  })

  it("refuse une clé de l'autre environnement", () => {
    expect(() => createFeexPay({ environment: 'live', apiKey: 'test_key_abc', shopId: 's' })).toThrow(/sandbox/)
    expect(() => createFeexPay({ environment: 'sandbox', apiKey: 'fp_abc', shopId: 's' })).toThrow(/production/)
  })

  it('refuse une clé ou une boutique vide, espaces compris', () => {
    expect(() => createFeexPay({ environment: 'sandbox', apiKey: '  \n', shopId: 's' })).toThrow(/apiKey/)
    expect(() => createFeexPay({ environment: 'sandbox', apiKey: 'test_key_a', shopId: '' })).toThrow(/shopId/)
  })

  it('nettoie les espaces et retours à la ligne copiés avec la clé', async () => {
    const mock = createFeexPayMock()
    const feexpay = createFeexPay({ environment: 'sandbox', apiKey: ` ${mock.apiKey}\n`, shopId: `${mock.shopId} `, fetch: mock.fetch })
    await feexpay.requestPayment({ network: 'mtn', phoneNumber: testPhoneNumber('00'), amount: 500 })
    expect(mock.requests[0]?.authorization).toBe(`Bearer ${mock.apiKey}`)
  })

  it('refuse de tourner dans un navigateur', () => {
    Object.assign(globalThis, { window: {}, document: {} })
    expect(() => createFeexPay({ environment: 'sandbox', apiKey: 'test_key_a', shopId: 's' })).toThrow(/navigateur/)
  })
})

describe('requestPayment', () => {
  it('envoie la requête documentée, numéro normalisé', async () => {
    const { mock, feexpay } = setup()
    const result = await feexpay.requestPayment({
      network: 'mtn',
      phoneNumber: '01 97 00 00 00',
      amount: 2500,
      description: 'Commande 42',
      callbackInfo: 'order_42',
    })
    const request = mock.requests[0]
    expect(request?.method).toBe('POST')
    expect(request?.url).toBe('https://sandbox-api.feexpay.me/api/transactions/public/requesttopay/mtn')
    expect(request?.body).toEqual({ shop: mock.shopId, amount: 2500, phoneNumber: '2290197000000', description: 'Commande 42', callback_info: 'order_42' })
    expect(result.status).toBe('SUCCESSFUL')
    expect(result.reference).toBe(mock.last()?.reference)
  })

  it('suit une transaction PENDING jusqu’au succès (suffixe 05)', async () => {
    const { feexpay } = setup({ settleAfter: 2 })
    const result = await feexpay.requestPayment({ network: 'mtn', phoneNumber: testPhoneNumber('05'), amount: 1000 })
    expect(result.status).toBe('PENDING')
    expect((await feexpay.getTransaction(result.reference))?.status).toBe('PENDING')
    const final = await feexpay.waitForFinalStatus(result.reference, { intervalMs: 1 })
    expect(final?.status).toBe('SUCCESSFUL')
    expect(final?.amount).toBe(1000)
  })

  it('renvoie PENDING d’abord pour Celtiis, même avec le suffixe 00', async () => {
    const { feexpay } = setup()
    const result = await feexpay.requestPayment({ network: 'celtiis_bj', phoneNumber: testPhoneNumber('00'), amount: 1000 })
    expect(result.status).toBe('PENDING')
    expect((await feexpay.getTransaction(result.reference))?.status).toBe('SUCCESSFUL')
  })

  it('donne le motif d’un échec (suffixe 01)', async () => {
    const { feexpay } = setup()
    const result = await feexpay.requestPayment({ network: 'mtn', phoneNumber: testPhoneNumber('01'), amount: 1000 })
    expect(result.status).toBe('FAILED')
    expect((await feexpay.getTransaction(result.reference))?.reason).toBe('Insufficient balance')
  })

  it('signale une issue incertaine sur un 503 (suffixe 02)', async () => {
    const { feexpay } = setup()
    const error = await rejection(feexpay.requestPayment({ network: 'mtn', phoneNumber: testPhoneNumber('02'), amount: 1000 }))
    expect(error).toBeInstanceOf(FeexPayError)
    expect((error as FeexPayError).kind).toBe('server_error')
    expect((error as FeexPayError).outcomeUnknown).toBe(true)
  })

  it('classe les erreurs documentées', async () => {
    const { mock, feexpay } = setup()
    const kind = async (promise: Promise<unknown>) => ((await rejection(promise)) as FeexPayError).kind

    expect(await kind(feexpay.requestPayment({ network: 'mtn', phoneNumber: testPhoneNumber('04'), amount: 1000 }))).toBe('invalid_phone_number')
    expect(await kind(feexpay.requestPayment({ network: 'mtn', phoneNumber: '0197000099', amount: 1000 }))).toBe('invalid_sandbox_number')
    expect(await kind(feexpay.requestPayment({ network: 'coris', phoneNumber: testPhoneNumber('00'), amount: 1000 }))).toBe('channel_not_in_sandbox')

    mock.failNextRequest(404, { statusCode: 404, message: 'moov channel not configured' })
    expect(await kind(feexpay.requestPayment({ network: 'moov', phoneNumber: testPhoneNumber('00'), amount: 1000 }))).toBe('channel_not_configured')

    mock.failNextRequest(503, { statusCode: 503, message: 'Network under maintenance', code: 'NETWORK_UNAVAILABLE' })
    const maintenance = (await rejection(feexpay.requestPayment({ network: 'mtn', phoneNumber: testPhoneNumber('00'), amount: 1000 }))) as FeexPayError
    expect(maintenance.kind).toBe('network_unavailable')
    expect(maintenance.outcomeUnknown).toBe(false)
  })

  it('valide avant tout appel', async () => {
    const { mock, feexpay } = setup()
    const field = async (promise: Promise<unknown>) => {
      const error = await rejection(promise)
      expect(error).toBeInstanceOf(FeexPayValidationError)
      return (error as FeexPayValidationError).field
    }
    const phone = testPhoneNumber('00')
    expect(await field(feexpay.requestPayment({ network: 'mtn', phoneNumber: phone, amount: 5 }))).toBe('amount')
    expect(await field(feexpay.requestPayment({ network: 'mtn', phoneNumber: phone, amount: 99.5 }))).toBe('amount')
    expect(await field(feexpay.requestPayment({ network: 'mtn', phoneNumber: phone, amount: 100, description: 'x'.repeat(41) }))).toBe('description')
    expect(await field(feexpay.requestPayment({ network: 'mtn_ci', phoneNumber: phone, amount: 100 }))).toBe('phoneNumber')
    expect(await field(feexpay.requestPayment({ network: 'orange_bf', phoneNumber: '70000000', amount: 100 }))).toBe('otp')
    expect(await field(feexpay.requestPayment({ network: 'wave_ci', phoneNumber: testPhoneNumber('00', 'CI'), amount: 100, returnUrl: 'http://shop.test' }))).toBe('returnUrl')
    expect(await field(feexpay.requestPayment({ network: 'nope' as never, phoneNumber: phone, amount: 100 }))).toBe('network')
    expect(mock.requests).toHaveLength(0)
  })

  it('envoie otp vide à la première étape Coris', async () => {
    const mock = createFeexPayMock()
    const feexpay = createFeexPay({ environment: 'sandbox', apiKey: mock.apiKey, shopId: mock.shopId, fetch: mock.fetch })
    await rejection(feexpay.requestPayment({ network: 'coris', phoneNumber: '01 66 00 00 00', amount: 100 }))
    expect((mock.requests[0]?.body as Record<string, unknown>).otp).toBe('')
  })

  it('renvoie la page de l’opérateur pour Wave', async () => {
    const { feexpay } = setup()
    const result = await feexpay.requestPayment({ network: 'wave_ci', phoneNumber: testPhoneNumber('00', 'CI'), amount: 100 })
    expect(result.paymentUrl).toMatch(/^https:\/\//)
  })

  it('retrouve une transaction dont la réponse s’est perdue', async () => {
    const { mock, feexpay } = setup()
    mock.loseNextResponse()
    const error = (await rejection(
      feexpay.requestPayment({ network: 'mtn', phoneNumber: testPhoneNumber('00'), amount: 1000, callbackInfo: 'order_7' }),
    )) as FeexPayError
    expect(error.kind).toBe('network_error')
    expect(error.outcomeUnknown).toBe(true)
    const found = await feexpay.findTransaction({ callbackInfo: 'order_7' })
    expect(found?.status).toBe('SUCCESSFUL')
  })

  it('respecte le délai', async () => {
    const { mock, feexpay } = setup({ timeoutMs: 20 })
    mock.latencyMs = 200
    const error = (await rejection(feexpay.requestPayment({ network: 'mtn', phoneNumber: testPhoneNumber('00'), amount: 1000 }))) as FeexPayError
    expect(error.kind).toBe('timeout')
    expect(error.outcomeUnknown).toBe(true)
  })

  it('ne met jamais la clé dans un message d’erreur', async () => {
    const mock = createFeexPayMock()
    const feexpay = createFeexPay({ environment: 'sandbox', apiKey: 'test_key_wrong_secret', shopId: mock.shopId, fetch: mock.fetch })
    const error = (await rejection(feexpay.requestPayment({ network: 'mtn', phoneNumber: testPhoneNumber('00'), amount: 1000 }))) as FeexPayError
    expect(error.kind).toBe('unauthorized')
    expect(error.message).not.toContain('test_key_wrong_secret')
  })
})

describe('getTransaction et findTransaction', () => {
  it('renvoie null pour une référence inconnue', async () => {
    const { feexpay } = setup()
    expect(await feexpay.getTransaction('inconnue')).toBeNull()
    expect(await feexpay.findTransaction({ callbackInfo: 'inconnue' })).toBeNull()
  })

  it('signale une recherche ambiguë', async () => {
    const { feexpay } = setup()
    for (let i = 0; i < 2; i++) {
      await feexpay.requestPayment({ network: 'mtn', phoneNumber: testPhoneNumber('00'), amount: 100, description: 'abonnement' })
    }
    expect(((await rejection(feexpay.findTransaction({ description: 'abonnement' }))) as FeexPayError).kind).toBe('ambiguous')
  })

  it('refuse une recherche sur plusieurs mots', async () => {
    const { feexpay } = setup()
    await expect(feexpay.findTransaction({ callbackInfo: 'order 42' })).rejects.toBeInstanceOf(FeexPayValidationError)
  })

  it('waitForFinalStatus renvoie le dernier état au délai', async () => {
    const { feexpay } = setup({ settleAfter: 1000 })
    const { reference } = await feexpay.requestPayment({ network: 'mtn', phoneNumber: testPhoneNumber('05'), amount: 100 })
    const last = await feexpay.waitForFinalStatus(reference, { intervalMs: 1, timeoutMs: 20 })
    expect(last?.status).toBe('PENDING')
  })
})

describe('createCardPayment', () => {
  const customer = {
    firstName: 'Awa',
    lastName: 'Kone',
    email: 'awa@exemple.com',
    phoneNumber: '+229 01 97 12 34 56',
    city: 'Cotonou',
    zip: '00229',
    country: 'bj',
  }

  it('prépare la page de paiement puis suit le résultat', async () => {
    const { mock, feexpay } = setup()
    const card = await feexpay.createCardPayment({ amount: 10_000, customer, callbackInfo: 'order_9' })
    expect(new URL(card.paymentUrl).hostname).toBe('sandbox-api.feexpay.me')
    expect(card.expiresAt).toBeInstanceOf(Date)
    expect(mock.requests[0]?.body).toMatchObject({ amount: '10000', currency: 'XOF', country: 'BJ', phoneNumber: '+2290197123456' })
    mock.completeCardPayment(card.reference, 'SUCCESSFUL')
    expect((await feexpay.getTransaction(card.reference))?.status).toBe('SUCCESSFUL')
  })

  it('refuse une page de paiement hors de FeexPay', async () => {
    const { mock, feexpay } = setup()
    mock.failNextRequest(200, { reference: 'abc', status: 'PENDING', payment_url: 'https://evil.example/pay' })
    const error = (await rejection(feexpay.createCardPayment({ amount: 100, customer }))) as FeexPayError
    expect(error.kind).toBe('invalid_response')
  })

  it('exige les champs du titulaire', async () => {
    const { feexpay } = setup()
    const error = (await rejection(feexpay.createCardPayment({ amount: 100, customer: { ...customer, zip: '' } }))) as FeexPayValidationError
    expect(error.field).toBe('customer.zip')
  })

  it('signale une devise non prise en charge', async () => {
    const { feexpay } = setup()
    const error = (await rejection(feexpay.createCardPayment({ amount: 100, currency: 'JPY', customer }))) as FeexPayError
    expect(error.kind).toBe('bad_request')
  })
})

describe('resendWebhook', () => {
  it('redemande le webhook d’une transaction finale', async () => {
    const { mock, feexpay } = setup()
    const { reference } = await feexpay.requestPayment({ network: 'mtn', phoneNumber: testPhoneNumber('00'), amount: 100 })
    expect(await feexpay.resendWebhook(reference)).toEqual({ message: 'Webhook queued for delivery', status: 'SUCCESSFUL' })
    expect(mock.resentWebhooks).toEqual([reference])
  })

  it('refuse une transaction encore PENDING', async () => {
    const { feexpay } = setup({ settleAfter: 1000 })
    const { reference } = await feexpay.requestPayment({ network: 'mtn', phoneNumber: testPhoneNumber('05'), amount: 100 })
    expect(((await rejection(feexpay.resendWebhook(reference))) as FeexPayError).kind).toBe('bad_request')
  })
})
