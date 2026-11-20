# Next.js example (App Router)

A minimal shop that accepts Mobile Money payments with `feexpay-server`.

| File | Role |
| --- | --- |
| [`lib/feexpay.ts`](lib/feexpay.ts) | The FeexPay client, created on the first request (`server-only`) |
| [`lib/orders.ts`](lib/orders.ts) | Orders (in memory for the demo) and `applyTransaction`, idempotent |
| [`app/api/pay/route.ts`](app/api/pay/route.ts) | Starts the payment: the price comes from the server |
| [`app/api/pay/[reference]/route.ts`](app/api/pay/%5Breference%5D/route.ts) | Tracking from the browser, and the safety net if the webhook gets lost |
| [`app/api/webhooks/feexpay/route.ts`](app/api/webhooks/feexpay/route.ts) | The webhook, re-checked against the status API |
| [`app/page.tsx`](app/page.tsx) | The form: operator, number, then waiting for confirmation |

## Running it

1. Create a test account on [sandbox-app.feexpay.me](https://sandbox-app.feexpay.me) and copy your key (`test_key_…`) and the shop ID.
2. Then:

```sh
# at the repository root: build the package
npm install && npm run build

# in this folder
cd examples/nextjs
cp .env.example .env.local   # then fill it in
npm install
npm run dev
```

Open http://localhost:3000.

In the sandbox, use a test number: `01 97 00 00 00` succeeds immediately, `01 97 00 00 05` goes through the waiting step, `01 97 00 00 01` fails.

To receive webhooks locally, expose port 3000 (for example with `cloudflared tunnel --url http://localhost:3000`). Then enter the `…/api/webhooks/feexpay` URL in the sandbox dashboard, Webhooks section, with `Bearer` and the value of `FEEXPAY_WEBHOOK_SECRET`.
