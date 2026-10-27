import { describe, expect, it, vi } from 'vitest'
import { createFeexPay, createWebhookHandler, verifyWebhookAuthorization, type VerifiedWebhookEvent } from '../src/index.js'
import { createFeexPayMock, testPhoneNumber } from '../src/testing.js'

const SECRET = 'un_secret_long_et_aleatoire'

async function setup(options: { environment?: 'sandbox' | 'live'; settleAfter?: number } = {}) {
  const environment = options.environment ?? 'sandbox'
  const mock = createFeexPayMock({ apiKey: environment === 'live' ? 'fp_live_mock' : 'test_key_mock', settleAfter: options.settleAfter })
  const feexpay = createFeexPay({ environment, apiKey: mock.apiKey, shopId: mock.shopId, fetch: mock.fetch })
  const events: VerifiedWebhookEvent[] = []
  const ignored: string[] = []
  const handler = createWebhookHandler({
    feexpay,
    secret: SECRET,
    onPayment: (event) => {
      events.push(event)
    },
    onIgnored: (reason) => ignored.push(reason),
  })
  return { mock, feexpay, handler, events, ignored }
}

describe('verifyWebhookAuthorization', () => {
  it('accepte le bon secret, Bearer ou Basic', () => {
    expect(verifyWebhookAuthorization(`Bearer ${SECRET}`, SECRET)).toBe(true)
    expect(verifyWebhookAuthorization(`Basic ${SECRET}`, SECRET, 'Basic')).toBe(true)
  })

  it('refuse tout le reste', () => {
    expect(verifyWebhookAuthorization(`Bearer ${SECRET}x`, SECRET)).toBe(false)
    expect(verifyWebhookAuthorization(`Basic ${SECRET}`, SECRET)).toBe(false)
    expect(verifyWebhookAuthorization(null, SECRET)).toBe(false)
    expect(verifyWebhookAuthorization(`Bearer `, '')).toBe(false)
  })
})

describe('createWebhookHandler', () => {
  it('transmet un paiement confirmé par l’API de statut', async () => {
    const { mock, feexpay, handler, events } = await setup()
    const { reference } = await feexpay.requestPayment({ network: 'mtn', phoneNumber: testPhoneNumber('00'), amount: 2500, callbackInfo: 'order_1' })
    const response = await handler(mock.webhookRequest(reference, { secret: SECRET }))
    expect(response.status).toBe(200)
    expect(events).toHaveLength(1)
    expect(events[0]?.transaction).toMatchObject({ reference, status: 'SUCCESSFUL', amount: 2500, callbackInfo: 'order_1' })
  })

  it('croit l’API de statut, pas le corps du webhook', async () => {
    const { mock, feexpay, handler, events } = await setup()
    const { reference } = await feexpay.requestPayment({ network: 'mtn', phoneNumber: testPhoneNumber('01'), amount: 2500 })
    // Webhook forgé : il annonce un succès et un gros montant pour une transaction échouée.
    const forged = mock.webhookRequest(reference, { secret: SECRET, payload: { status: 'SUCCESSFUL', amount: 999_999 } })
    expect((await handler(forged)).status).toBe(200)
    expect(events[0]?.transaction.status).toBe('FAILED')
    expect(events[0]?.transaction.amount).toBe(2500)
    expect(events[0]?.payload.announcedStatus).toBe('SUCCESSFUL')
  })

  it('refuse un mauvais secret avec 401 (jamais rejoué par FeexPay)', async () => {
    const { mock, feexpay, handler, events } = await setup()
    const { reference } = await feexpay.requestPayment({ network: 'mtn', phoneNumber: testPhoneNumber('00'), amount: 100 })
    expect((await handler(mock.webhookRequest(reference, { secret: 'faux' }))).status).toBe(401)
    expect((await handler(mock.webhookRequest(reference))).status).toBe(401)
    expect(events).toHaveLength(0)
  })

  it('répond 400 à un corps illisible et 405 à un GET', async () => {
    const { handler } = await setup()
    const headers = { Authorization: `Bearer ${SECRET}` }
    expect((await handler(new Request('https://x.test/wh', { method: 'POST', headers, body: '{' }))).status).toBe(400)
    expect((await handler(new Request('https://x.test/wh', { method: 'POST', headers, body: '{"status":"SUCCESSFUL"}' }))).status).toBe(400)
    expect((await handler(new Request('https://x.test/wh'))).status).toBe(405)
  })

  it('écarte un événement sandbox reçu en production', async () => {
    const { mock, feexpay, handler, events, ignored } = await setup({ environment: 'live' })
    const { reference } = await feexpay.requestPayment({ network: 'mtn', phoneNumber: testPhoneNumber('00'), amount: 100 })
    const response = await handler(mock.webhookRequest(reference, { secret: SECRET }))
    expect(response.status).toBe(200)
    expect(events).toHaveLength(0)
    expect(ignored).toEqual(['other_environment'])
  })

  it('écarte un événement sans env reçu en sandbox, les décaissements et les références inconnues', async () => {
    const { mock, feexpay, handler, events, ignored } = await setup()
    const { reference } = await feexpay.requestPayment({ network: 'mtn', phoneNumber: testPhoneNumber('00'), amount: 100 })
    await handler(mock.webhookRequest(reference, { secret: SECRET, payload: { env: undefined } }))
    await handler(mock.webhookRequest(reference, { secret: SECRET, payload: { type: 'Payout' } }))
    await handler(mock.webhookRequest(reference, { secret: SECRET, payload: { reference: 'inconnue' } }))
    expect(events).toHaveLength(0)
    expect(ignored).toEqual(['other_environment', 'payout', 'unknown_reference'])
  })

  it('répond 503 si FeexPay ne répond pas, pour obtenir le nouvel essai', async () => {
    const { mock, feexpay, handler } = await setup()
    const { reference } = await feexpay.requestPayment({ network: 'mtn', phoneNumber: testPhoneNumber('00'), amount: 100 })
    const request = mock.webhookRequest(reference, { secret: SECRET })
    mock.offline = true
    expect((await handler(request)).status).toBe(503)
  })

  it('répond 503 tant que l’API de statut dit PENDING', async () => {
    const { mock, feexpay, handler, events } = await setup({ settleAfter: 1000 })
    const { reference } = await feexpay.requestPayment({ network: 'mtn', phoneNumber: testPhoneNumber('05'), amount: 100 })
    expect((await handler(mock.webhookRequest(reference, { secret: SECRET, payload: { status: 'SUCCESSFUL' } }))).status).toBe(503)
    expect(events).toHaveLength(0)
  })

  it('répond 500 si onPayment échoue', async () => {
    const mock = createFeexPayMock()
    const feexpay = createFeexPay({ environment: 'sandbox', apiKey: mock.apiKey, shopId: mock.shopId, fetch: mock.fetch })
    const onError = vi.fn()
    const handler = createWebhookHandler({
      feexpay,
      secret: SECRET,
      onPayment: () => {
        throw new Error('base indisponible')
      },
      onError,
    })
    const { reference } = await feexpay.requestPayment({ network: 'mtn', phoneNumber: testPhoneNumber('00'), amount: 100 })
    expect((await handler(mock.webhookRequest(reference, { secret: SECRET }))).status).toBe(500)
    expect(onError).toHaveBeenCalledOnce()
  })

  it('crée le client au premier webhook seulement', async () => {
    const mock = createFeexPayMock()
    const factory = vi.fn(() => createFeexPay({ environment: 'sandbox', apiKey: mock.apiKey, shopId: mock.shopId, fetch: mock.fetch }))
    const handler = createWebhookHandler({ feexpay: factory, secret: null, onPayment: () => {} })
    expect(factory).not.toHaveBeenCalled()
    const { reference } = await factory().requestPayment({ network: 'mtn', phoneNumber: testPhoneNumber('00'), amount: 100 })
    factory.mockClear()
    await handler(mock.webhookRequest(reference))
    await handler(mock.webhookRequest(reference))
    expect(factory).toHaveBeenCalledOnce()
  })

  it('refuse un secret vide à la création', () => {
    const mock = createFeexPayMock()
    const feexpay = createFeexPay({ environment: 'sandbox', apiKey: mock.apiKey, shopId: mock.shopId, fetch: mock.fetch })
    expect(() => createWebhookHandler({ feexpay, secret: '', onPayment: () => {} })).toThrow(/secret/)
  })

  it('lit le secret au premier webhook, une seule fois', async () => {
    const mock = createFeexPayMock()
    const feexpay = createFeexPay({ environment: 'sandbox', apiKey: mock.apiKey, shopId: mock.shopId, fetch: mock.fetch })
    const readSecret = vi.fn(() => SECRET)
    const handler = createWebhookHandler({ feexpay, secret: readSecret, onPayment: () => {} })
    expect(readSecret).not.toHaveBeenCalled()
    const { reference } = await feexpay.requestPayment({ network: 'mtn', phoneNumber: testPhoneNumber('00'), amount: 100 })
    expect((await handler(mock.webhookRequest(reference, { secret: SECRET }))).status).toBe(200)
    expect((await handler(mock.webhookRequest(reference, { secret: 'faux' }))).status).toBe(401)
    expect(readSecret).toHaveBeenCalledOnce()
  })

  it('refuse un secret lu vide au premier webhook', async () => {
    const mock = createFeexPayMock()
    const feexpay = createFeexPay({ environment: 'sandbox', apiKey: mock.apiKey, shopId: mock.shopId, fetch: mock.fetch })
    const handler = createWebhookHandler({ feexpay, secret: () => undefined, onPayment: () => {} })
    await expect(handler(new Request('https://x.test/wh', { method: 'POST', body: '{}' }))).rejects.toThrow(/secret/)
  })
})
