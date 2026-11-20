# Changelog

## 0.1.0 (2026-10-27)

First release.

- `createFeexPay`: server client, with safeguards on the environment, the key and running in a browser.
- Mobile Money on 17 networks (Benin, Togo, Côte d'Ivoire, Congo, Senegal, Burkina Faso):
  - `requestPayment`, with phone number and amount validation;
  - the two-step Coris flow and the Orange Burkina Faso OTP.
- Payment tracking: `getTransaction`, `findTransaction` (by `callback_info` or `description`), `waitForFinalStatus`.
- Card payments: `createCardPayment`, with a check of the payment page.
- `resendWebhook`.
- Webhook: `createWebhookHandler` (`Request`/`Response` format), which checks the secret and re-reads every transaction from the status API.
- Typed errors: `FeexPayError` (with `kind` and `outcomeUnknown`), `FeexPayConfigError`, `FeexPayValidationError`.
- `feexpay-server/testing`: FeexPay sandbox simulator.
- Next.js example (App Router).
