# feexpay-server

**Accept Mobile Money and card payments with [FeexPay](https://feexpay.me), on the server, without ever exposing your key.**

[![CI](https://github.com/i6moons/feexpay-server/actions/workflows/ci.yml/badge.svg)](https://github.com/i6moons/feexpay-server/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/feexpay-server?color=cb3837)](https://www.npmjs.com/package/feexpay-server)
![Zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-typed-3178c6)
[![MIT license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

MTN, Moov, Celtiis, Coris, Wave, Orange, Free, T-Money and Flooz, in Benin, Togo, Côte d'Ivoire, Congo, Senegal and Burkina Faso. For Node.js, Next.js, Bun, Deno, Cloudflare Workers and Vercel Edge.

> Community project, not affiliated with FeexPay. It follows the [official documentation](https://docs.feexpay.me) (API v2). Issues and pull requests are welcome in English or French.

## Why

- **Your key stays on the server.** FeexPay's JavaScript and React SDKs take the `fp_…` key as a parameter in the browser. The FeexPay documentation says so: *"The only frontend where they must be exposed is our SDK"*. Yet that same key authorizes your shop's REST API. Here it never leaves your server, and the client refuses to start in a browser.
- **Zero dependencies.** Only `fetch` and standard Web APIs. For comparison, the official Node SDK depends on Express, Winston, Nodemailer and Axios.
- **The pitfalls are already handled:**
  - the status is normalized ("IN PENDING STATE" means `PENDING`);
  - in production, MTN always answers `PENDING` first;
  - the webhook is not signed, so it is re-checked against the API;
  - a connection drop during the request is reported (the request may already be on the customer's phone);
  - a sandbox key used in production is rejected at startup;
  - 10-digit Beninese numbers (01…) are validated.
- **Testable offline.** A simulator reproduces the FeexPay sandbox rules for your automated tests.

## Installation

```sh
npm install feexpay-server
```

Node.js 20 or later (or any runtime that provides `fetch`).

## Quick start

```ts
import { createFeexPay } from 'feexpay-server'

const feexpay = createFeexPay({
  environment: 'sandbox', // 'live' in production
  apiKey: process.env.FEEXPAY_API_KEY!, // test_key_… or fp_…
  shopId: process.env.FEEXPAY_SHOP_ID!,
})

// 1. The customer receives the request on their phone
const payment = await feexpay.requestPayment({
  network: 'mtn',
  phoneNumber: '01 97 00 00 00', // local format or +229…
  amount: 2500, // computed by YOUR server, never taken from the browser
  description: 'Premium subscription',
  callbackInfo: 'order_42', // returned to you as is
})

// 2. They confirm with their PIN; the final status comes next
const transaction = await feexpay.waitForFinalStatus(payment.reference)
if (transaction?.status === 'SUCCESSFUL' && transaction.amount >= 2500) {
  // deliver the order
}
```

In production, prefer the [webhook](#webhook) to polling.

## Supported networks

| Country | Network | `network` | Flow | Sandbox |
| --- | --- | --- | --- | :---: |
| Benin | MTN MoMo | `mtn` | PIN on the phone | ✅ |
| Benin | Moov Money | `moov` | PIN on the phone | ✅ |
| Benin | Celtiis Cash | `celtiis_bj` | PIN on the phone | ✅ |
| Benin | Coris Money | `coris` | SMS code, two calls | — |
| Togo | T-Money (Togocom) | `togocom_tg` | PIN on the phone | ✅ |
| Togo | Flooz (Moov) | `moov_tg` | PIN on the phone | ✅ |
| Côte d'Ivoire | MTN MoMo | `mtn_ci` | PIN on the phone | ✅ |
| Côte d'Ivoire | Moov Money | `moov_ci` | operator page | ✅ |
| Côte d'Ivoire | Wave | `wave_ci` | operator page | ✅ |
| Côte d'Ivoire | Orange Money | `orange_ci` | operator page | ✅ |
| Congo | MTN MoMo (XAF) | `mtn_cg` | PIN on the phone | ✅ |
| Senegal | Orange Money | `orange_sn` | operator page | ✅ |
| Senegal | Wave | `wave_sn` | operator page | ✅ |
| Senegal | Free Money | `free_sn` | PIN on the phone | ✅ |
| Burkina Faso | Moov Money | `moov_bf` | PIN on the phone | — |
| Burkina Faso | Orange Money | `orange_bf` | USSD code before the call | — |
| Burkina Faso | Wave | `wave_bf` | operator page | — |

- **Operator page**: if `payment.paymentUrl` is set, send the customer there.
- **Coris**: a first call without `otp` triggers the SMS code. Then call `requestPayment` again with the same parameters and `otp`.
- **Orange Burkina Faso**: the customer dials `#144*4*6*amount#`, then gives you the code, which you pass as `otp`.
- Each network's details are exported: `NETWORKS`, `networksOf('BJ')`, `normalizePhoneNumber('01 97 00 00 00', 'BJ')`.

Amounts: 100 to 2,000,000 XOF in production, 10 to 1,000,000 in the sandbox. They are checked before the call.

## Tracking a payment

The response from `requestPayment` is usually `PENDING`: the customer has not confirmed yet. The final status (`SUCCESSFUL` or `FAILED`) comes later, in one of three ways:

| Method | For |
| --- | --- |
| **Webhook**: `createWebhookHandler` | Production: FeexPay notifies you. |
| **`getTransaction(reference)`** | The browser polling your API every 3 s while the customer confirms, and the safety net if a webhook gets lost. |
| **`waitForFinalStatus(reference)`** | Scripts and tests. |

Before delivering, always check that `transaction.amount` covers the order price and that `transaction.callbackInfo` matches the order.

## Webhook

FeexPay sends a single webhook per transaction, and it is **not signed**. The handler:

1. checks the `Authorization` header (in constant time);
2. drops events from the other environment (a sandbox event received in production, for example);
3. **re-reads the transaction from the status API**, with your key: the webhook body is never trusted as is;
4. calls `onPayment` with the verified transaction.

```ts
// app/api/webhooks/feexpay/route.ts (Next.js App Router)
import { createWebhookHandler } from 'feexpay-server'
import { getFeexPay } from '@/lib/feexpay' // returns your createFeexPay(…) client

export const POST = createWebhookHandler({
  feexpay: getFeexPay, // a function: read on the first webhook, not during `next build`
  secret: () => process.env.FEEXPAY_WEBHOOK_SECRET, // also entered in the FeexPay dashboard
  async onPayment({ transaction }) {
    // Idempotent: the same reference can arrive twice.
    await markOrderPaid(transaction.callbackInfo, transaction.reference, transaction.amount)
  },
})
```

In the FeexPay dashboard, **Webhooks** section:
- the URL of this route;
- the `transaction.successful` and `transaction.failed` events;
- `Bearer` authentication, with the same value as `FEEXPAY_WEBHOOK_SECRET` (generate it with `openssl rand -hex 32`).

Response codes follow FeexPay's delivery rules: a 4xx is never retried, a 5xx is retried once, 5 s later.

| Response | Case |
| --- | --- |
| `200` | Payment processed, or webhook dropped (other environment, payout, unknown reference) |
| `401` | Missing or wrong secret |
| `400` | Unreadable body |
| `503` | FeexPay unreachable during verification, or transaction still `PENDING`: FeexPay will retry |
| `500` | `onPayment` threw an error: FeexPay will retry |

The handler takes a `Request` and returns a `Response` (standard Web API). It also works with Hono, Bun, Deno and Cloudflare Workers.

## Card payments

```ts
const card = await feexpay.createCardPayment({
  amount: 10_000,
  customer: {
    firstName: 'Awa',
    lastName: 'Kone',
    email: 'awa@example.com',
    phoneNumber: '+2290197123456',
    city: 'Cotonou',
    zip: '00229',
    country: 'BJ',
  },
  callbackInfo: 'order_42',
  returnUrl: 'https://shop.example/thanks',
})
// Redirect the customer to card.paymentUrl (FeexPay page, 3D Secure)
```

`paymentUrl` is verified: only the FeexPay payment page is accepted, so an unexpected response will never send your customer elsewhere. In production, cards must first be enabled on the shop (KYB file). Until then, FeexPay answers `403` and the error has the kind `card_not_authorized`.

## Errors

Three error classes:

- `FeexPayConfigError`: configuration rejected at startup (environment, key, shop).
- `FeexPayValidationError`: parameter rejected before the call. `error.field` says which one. Nothing was sent.
- `FeexPayError`: a response, or no response, from FeexPay. It carries `status`, `code`, `body` and a ready-to-use `kind`:

| `kind` | What to do |
| --- | --- |
| `channel_not_configured`, `network_unavailable` | Offer another operator |
| `invalid_phone_number`, `invalid_sandbox_number` | Ask for a corrected number (in the sandbox: ending in 00 to 06) |
| `unauthorized`, `forbidden`, `shop_not_found`, `card_not_authorized` | Configuration problem: alert the team |
| `timeout`, `network_error`, `server_error` | See `outcomeUnknown` below |

**`outcomeUnknown`**: the request may have reached FeexPay despite the error (timeout, connection drop, 5xx). The customer may already have the request on their phone. Do not blindly start a second payment: look for the first one.

```ts
try {
  await feexpay.requestPayment({ ...params, callbackInfo: attemptId })
} catch (error) {
  if (error instanceof FeexPayError && error.outcomeUnknown) {
    const existing = await feexpay.findTransaction({ callbackInfo: attemptId })
    // existing ? track that transaction : ask the customer to check their phone
  }
}
```

For this lookup to work, `callbackInfo` must be a **single-word** identifier, unique to each attempt (for example `order_42:a1b2c3d4`).

## Testing with the simulator

`feexpay-server/testing` reproduces the [FeexPay sandbox](https://docs.feexpay.me/?section=sandbox&version=v2) with no network and no account. It plugs in place of `fetch`, without changing anything globally.

```ts
import { createFeexPay } from 'feexpay-server'
import { createFeexPayMock, testPhoneNumber } from 'feexpay-server/testing'

const mock = createFeexPayMock()
const feexpay = createFeexPay({ environment: 'sandbox', apiKey: mock.apiKey, shopId: mock.shopId, fetch: mock.fetch })

const payment = await feexpay.requestPayment({ network: 'mtn', phoneNumber: testPhoneNumber('05'), amount: 1000 })
// PENDING, then SUCCESSFUL on the next lookup

// Test your webhook route with the real FeexPay format
const response = await POST(mock.webhookRequest(payment.reference, { secret: 'my_secret' }))
```

| The number ends in | Result |
| --- | --- |
| `00` | `SUCCESSFUL` |
| `01` | `FAILED` (insufficient balance) |
| `02` | HTTP 503, transaction `FAILED` |
| `03` | `PENDING` then `FAILED` (timed out) |
| `04` | HTTP 400 `INVALID_PHONE_NUMBER` |
| `05` | `PENDING` then `SUCCESSFUL` |
| `06` | `PENDING` then `FAILED` (declined by the customer) |

To simulate incidents:
- `mock.offline = true` cuts the network;
- `mock.latencyMs` adds a delay, to test `timeoutMs`;
- `mock.loseNextResponse()` creates the transaction, then loses the response;
- `mock.failNextRequest(404, { message: 'moov channel not configured' })` returns an error;
- `mock.tamper(reference, { amount: 1 })` tampers with the status, to test your checks.

## Full example

[`examples/nextjs`](examples/nextjs) contains a minimal Next.js shop:
- the checkout page;
- the route that starts the payment;
- tracking from the browser;
- the webhook;
- an order whose price is set by the server.

## Good practices

- **The amount comes from your database**, never from the browser.
- **Server-only variables**: never `NEXT_PUBLIC_FEEXPAY_…`.
- **Idempotent processing**: the same reference can arrive through the webhook, through tracking and through a retry.
- **Logs without personal data**: `maskPhoneNumber('2290197000005')` gives `+229 ••••••••05`.
- **Enable the webhook secret.** Without it, payments are still re-checked, but anyone can trigger those checks.

## Known limitations

- **Not supported yet**: payouts, balance and payment history.
- **This package is tested against the simulator**, not yet against FeexPay in real conditions. Its rules follow the official documentation.
- **Feedback welcome**: if a network behaves differently for you, [open an issue](https://github.com/i6moons/feexpay-server/issues).

## Contributing

Contributions are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md). To report a vulnerability, read [SECURITY.md](SECURITY.md).

```sh
npm install
npm test
npm run typecheck
npm run build
```

## License

[MIT](LICENSE) © Del Prudence ([@i6moons](https://github.com/i6moons)).
