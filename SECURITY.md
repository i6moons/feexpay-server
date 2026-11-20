# Security

## Reporting a vulnerability in feexpay-server

Do not open a public issue. Use GitHub's private reporting: the repository's **Security** tab, then **Report a vulnerability**.

Describe the affected version, the scenario and its impact. You will get an answer within 7 days. Security fixes are released first, with an entry in the [CHANGELOG](CHANGELOG.md), and your name if you wish.

## Vulnerability in FeexPay itself

If the problem concerns the FeexPay platform (API, dashboard, official SDKs) and not this package, write to FeexPay: support@feexpay.com (the address given in their [documentation](https://docs.feexpay.me/?section=security&version=v2)).

## What the package guarantees

- The API key is never written into an error message or returned in an object.
- `createFeexPay` refuses to start in a browser, unless the `dangerouslyAllowBrowser` option is set.
- The webhook compares the secret in constant time and never trusts its body: every transaction is re-read from the status API.
- `paymentUrl` (cards) only accepts the documented FeexPay hosts; the other returned URLs must use https.
- No runtime dependencies: nothing but your code and this package touches the key.
