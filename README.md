# feexpay-server

**Encaissez par Mobile Money et carte bancaire avec [FeexPay](https://feexpay.me), côté serveur, sans jamais exposer votre clé.**

[![CI](https://github.com/i6moons/feexpay-server/actions/workflows/ci.yml/badge.svg)](https://github.com/i6moons/feexpay-server/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/feexpay-server?color=cb3837)](https://www.npmjs.com/package/feexpay-server)
![Zéro dépendance](https://img.shields.io/badge/d%C3%A9pendances-0-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-typ%C3%A9-3178c6)
[![Licence MIT](https://img.shields.io/badge/licence-MIT-blue)](LICENSE)

MTN, Moov, Celtiis, Coris, Wave, Orange, Free, T-Money et Flooz, au Bénin, au Togo, en Côte d'Ivoire, au Congo, au Sénégal et au Burkina Faso. Pour Node.js, Next.js, Bun, Deno, Cloudflare Workers et Vercel Edge.

> Projet communautaire, non affilié à FeexPay. Il suit la [documentation officielle](https://docs.feexpay.me) (API v2).

## Pourquoi

- **Votre clé reste sur le serveur.** Les SDK JavaScript et React de FeexPay prennent la clé `fp_…` en paramètre dans le navigateur. La documentation FeexPay l'assume : *« The only frontend where they must be exposed is our SDK »*. Or cette même clé autorise l'API REST de votre boutique. Ici, elle ne quitte jamais votre serveur, et le client refuse de démarrer dans un navigateur.
- **Zéro dépendance.** Seulement `fetch` et les API Web standard. À titre de comparaison, le SDK Node officiel dépend d'Express, Winston, Nodemailer et Axios.
- **Les pièges déjà gérés :**
  - le statut est normalisé (« IN PENDING STATE » veut dire `PENDING`) ;
  - en production, MTN répond toujours `PENDING` d'abord ;
  - le webhook n'est pas signé, donc il est revérifié auprès de l'API ;
  - une coupure pendant la demande est signalée (la demande est peut-être déjà sur le téléphone) ;
  - une clé de sandbox utilisée en production est refusée au démarrage ;
  - les numéros béninois à 10 chiffres (01…) sont validés.
- **Testable sans réseau.** Un simulateur reproduit les règles de la sandbox FeexPay pour vos tests automatisés.

## Installation

```sh
npm install feexpay-server
```

Node.js 20 ou plus récent (ou tout environnement qui fournit `fetch`).

## Démarrage rapide

```ts
import { createFeexPay } from 'feexpay-server'

const feexpay = createFeexPay({
  environment: 'sandbox', // 'live' en production
  apiKey: process.env.FEEXPAY_API_KEY!, // test_key_… ou fp_…
  shopId: process.env.FEEXPAY_SHOP_ID!,
})

// 1. Le client reçoit la demande sur son téléphone
const payment = await feexpay.requestPayment({
  network: 'mtn',
  phoneNumber: '01 97 00 00 00', // saisie locale ou +229…
  amount: 2500, // calculé par VOTRE serveur, jamais reçu du navigateur
  description: 'Abonnement Premium',
  callbackInfo: 'order_42', // vous sera rendu tel quel
})

// 2. Il valide avec son code PIN ; le statut final arrive ensuite
const transaction = await feexpay.waitForFinalStatus(payment.reference)
if (transaction?.status === 'SUCCESSFUL' && transaction.amount >= 2500) {
  // livrer la commande
}
```

En production, préférez le [webhook](#webhook) à l'attente active.

## Réseaux pris en charge

| Pays | Réseau | `network` | Parcours | Sandbox |
| --- | --- | --- | --- | :---: |
| Bénin | MTN MoMo | `mtn` | PIN sur le téléphone | ✅ |
| Bénin | Moov Money | `moov` | PIN sur le téléphone | ✅ |
| Bénin | Celtiis Cash | `celtiis_bj` | PIN sur le téléphone | ✅ |
| Bénin | Coris Money | `coris` | code SMS en deux appels | — |
| Togo | T-Money (Togocom) | `togocom_tg` | PIN sur le téléphone | ✅ |
| Togo | Flooz (Moov) | `moov_tg` | PIN sur le téléphone | ✅ |
| Côte d'Ivoire | MTN MoMo | `mtn_ci` | PIN sur le téléphone | ✅ |
| Côte d'Ivoire | Moov Money | `moov_ci` | page de l'opérateur | ✅ |
| Côte d'Ivoire | Wave | `wave_ci` | page de l'opérateur | ✅ |
| Côte d'Ivoire | Orange Money | `orange_ci` | page de l'opérateur | ✅ |
| Congo | MTN MoMo (XAF) | `mtn_cg` | PIN sur le téléphone | ✅ |
| Sénégal | Orange Money | `orange_sn` | page de l'opérateur | ✅ |
| Sénégal | Wave | `wave_sn` | page de l'opérateur | ✅ |
| Sénégal | Free Money | `free_sn` | PIN sur le téléphone | ✅ |
| Burkina Faso | Moov Money | `moov_bf` | PIN sur le téléphone | — |
| Burkina Faso | Orange Money | `orange_bf` | code USSD avant l'appel | — |
| Burkina Faso | Wave | `wave_bf` | page de l'opérateur | — |

- **Page de l'opérateur** : si `payment.paymentUrl` est renseigné, envoyez-y le client.
- **Coris** : un premier appel sans `otp` déclenche l'envoi du code par SMS. Rappelez ensuite `requestPayment` avec les mêmes paramètres et `otp`.
- **Orange Burkina Faso** : le client compose `#144*4*6*montant#`, puis vous transmet le code, à passer dans `otp`.
- Les informations de chaque réseau sont exportées : `NETWORKS`, `networksOf('BJ')`, `normalizePhoneNumber('01 97 00 00 00', 'BJ')`.

Montants : de 100 à 2 000 000 XOF en production, de 10 à 1 000 000 en sandbox. Ils sont vérifiés avant l'appel.

## Suivre un paiement

La réponse de `requestPayment` est le plus souvent `PENDING` : le client n'a pas encore validé. Le statut final (`SUCCESSFUL` ou `FAILED`) arrive ensuite, de trois façons :

| Méthode | Pour |
| --- | --- |
| **Webhook** : `createWebhookHandler` | La production : FeexPay vous prévient. |
| **`getTransaction(reference)`** | Le navigateur qui interroge votre API toutes les 3 s pendant que le client valide, et le filet si un webhook se perd. |
| **`waitForFinalStatus(reference)`** | Les scripts et les tests. |

Avant de livrer, vérifiez toujours que `transaction.amount` couvre le prix de la commande et que `transaction.callbackInfo` lui correspond.

## Webhook

FeexPay n'envoie qu'un webhook par transaction, et il n'est **pas signé**. Le gestionnaire :

1. vérifie l'en-tête `Authorization` (en temps constant) ;
2. écarte les événements de l'autre environnement (un événement sandbox reçu en production, par exemple) ;
3. **relit la transaction auprès de l'API de statut**, avec votre clé : le contenu du webhook n'est jamais cru tel quel ;
4. appelle `onPayment` avec la transaction vérifiée.

```ts
// app/api/webhooks/feexpay/route.ts (Next.js App Router)
import { createWebhookHandler } from 'feexpay-server'
import { getFeexPay } from '@/lib/feexpay' // renvoie votre client createFeexPay(…)

export const POST = createWebhookHandler({
  feexpay: getFeexPay, // une fonction : lue au premier webhook, pas pendant `next build`
  secret: () => process.env.FEEXPAY_WEBHOOK_SECRET, // saisi aussi dans le tableau de bord FeexPay
  async onPayment({ transaction }) {
    // Idempotent : la même référence peut arriver deux fois.
    await markOrderPaid(transaction.callbackInfo, transaction.reference, transaction.amount)
  },
})
```

Dans le tableau de bord FeexPay, section **Webhooks** :
- l'URL de cette route ;
- les événements `transaction.successful` et `transaction.failed` ;
- l'authentification `Bearer`, avec la même valeur que `FEEXPAY_WEBHOOK_SECRET` (générez-la avec `openssl rand -hex 32`).

Les codes de réponse suivent les règles de livraison de FeexPay : un 4xx n'est jamais rejoué, un 5xx l'est une fois, 5 s plus tard.

| Réponse | Cas |
| --- | --- |
| `200` | Paiement traité, ou webhook écarté (autre environnement, décaissement, référence inconnue) |
| `401` | Secret absent ou faux |
| `400` | Corps illisible |
| `503` | FeexPay injoignable pendant la vérification, ou transaction encore `PENDING` : FeexPay réessaiera |
| `500` | `onPayment` a levé une erreur : FeexPay réessaiera |

Le gestionnaire prend une `Request` et renvoie une `Response` (API Web standard). Il fonctionne aussi avec Hono, Bun, Deno et Cloudflare Workers.

## Paiement par carte

```ts
const card = await feexpay.createCardPayment({
  amount: 10_000,
  customer: {
    firstName: 'Awa',
    lastName: 'Kone',
    email: 'awa@exemple.com',
    phoneNumber: '+2290197123456',
    city: 'Cotonou',
    zip: '00229',
    country: 'BJ',
  },
  callbackInfo: 'order_42',
  returnUrl: 'https://boutique.exemple/merci',
})
// Redirigez le client vers card.paymentUrl (page FeexPay, 3D Secure)
```

`paymentUrl` est vérifiée : seule la page de paiement FeexPay est acceptée. Une réponse inattendue n'enverra jamais votre client ailleurs. En production, la carte doit d'abord être activée sur la boutique (dossier KYB). Avant ça, FeexPay répond `403` et l'erreur a le type `card_not_authorized`.

## Erreurs

Trois classes d'erreur :

- `FeexPayConfigError` : configuration refusée au démarrage (environnement, clé, boutique).
- `FeexPayValidationError` : paramètre refusé avant l'appel. `error.field` dit lequel. Rien n'a été envoyé.
- `FeexPayError` : réponse ou absence de réponse de FeexPay. Elle porte `status`, `code`, `body` et un `kind` prêt à l'emploi :

| `kind` | Que faire |
| --- | --- |
| `channel_not_configured`, `network_unavailable` | Proposer un autre opérateur |
| `invalid_phone_number`, `invalid_sandbox_number` | Faire corriger le numéro (en sandbox : finir par 00 à 06) |
| `unauthorized`, `forbidden`, `shop_not_found`, `card_not_authorized` | Problème de configuration : alerter l'équipe |
| `timeout`, `network_error`, `server_error` | Voir `outcomeUnknown` ci-dessous |

**`outcomeUnknown`** : la demande a peut-être atteint FeexPay malgré l'erreur (délai dépassé, coupure, 5xx). Le client a peut-être déjà la demande sur son téléphone. Ne relancez pas un second paiement à l'aveugle : cherchez-le d'abord.

```ts
try {
  await feexpay.requestPayment({ ...params, callbackInfo: attemptId })
} catch (error) {
  if (error instanceof FeexPayError && error.outcomeUnknown) {
    const existing = await feexpay.findTransaction({ callbackInfo: attemptId })
    // existing ? suivre cette transaction : demander au client de vérifier son téléphone
  }
}
```

Pour que cette recherche marche, `callbackInfo` doit être un identifiant d'**un seul mot**, propre à chaque tentative (par exemple `order_42:a1b2c3d4`).

## Tester avec le simulateur

`feexpay-server/testing` reproduit la [sandbox FeexPay](https://docs.feexpay.me/?section=sandbox&version=v2) sans réseau ni compte. Il se branche à la place de `fetch`, sans rien modifier globalement.

```ts
import { createFeexPay } from 'feexpay-server'
import { createFeexPayMock, testPhoneNumber } from 'feexpay-server/testing'

const mock = createFeexPayMock()
const feexpay = createFeexPay({ environment: 'sandbox', apiKey: mock.apiKey, shopId: mock.shopId, fetch: mock.fetch })

const payment = await feexpay.requestPayment({ network: 'mtn', phoneNumber: testPhoneNumber('05'), amount: 1000 })
// PENDING, puis SUCCESSFUL à la consultation suivante

// Tester votre route de webhook avec le vrai format FeexPay
const response = await POST(mock.webhookRequest(payment.reference, { secret: 'mon_secret' }))
```

| Le numéro finit par | Résultat |
| --- | --- |
| `00` | `SUCCESSFUL` |
| `01` | `FAILED` (solde insuffisant) |
| `02` | HTTP 503, transaction `FAILED` |
| `03` | `PENDING` puis `FAILED` (délai dépassé) |
| `04` | HTTP 400 `INVALID_PHONE_NUMBER` |
| `05` | `PENDING` puis `SUCCESSFUL` |
| `06` | `PENDING` puis `FAILED` (refusé par le client) |

Pour simuler les incidents :
- `mock.offline = true` coupe le réseau ;
- `mock.latencyMs` ajoute un délai, pour tester `timeoutMs` ;
- `mock.loseNextResponse()` crée la transaction puis perd la réponse ;
- `mock.failNextRequest(404, { message: 'moov channel not configured' })` renvoie une erreur ;
- `mock.tamper(reference, { amount: 1 })` falsifie le statut, pour tester vos contrôles.

## Exemple complet

[`examples/nextjs`](examples/nextjs) contient une boutique Next.js minimale :
- la page de paiement ;
- la route qui lance le paiement ;
- le suivi depuis le navigateur ;
- le webhook ;
- une commande dont le prix est fixé par le serveur.

## Bonnes pratiques

- **Le montant vient de votre base de données**, jamais du navigateur.
- **Variables serveur uniquement** : jamais de `NEXT_PUBLIC_FEEXPAY_…`.
- **Traitement idempotent** : une même référence peut arriver par le webhook, par le suivi et par un nouvel essai.
- **Journaux sans données personnelles** : `maskPhoneNumber('2290197000005')` donne `+229 ••••••••05`.
- **Activez le secret du webhook.** Sans lui, les paiements restent revérifiés, mais n'importe qui peut déclencher ces vérifications.

## Limites connues

- **Pas encore pris en charge** : les décaissements (payout), le solde et l'historique des paiements.
- **Ce paquet est testé contre le simulateur**, pas encore contre FeexPay en conditions réelles. Ses règles suivent la documentation officielle.
- **Retours bienvenus** : si un réseau se comporte autrement chez vous, [ouvrez une issue](https://github.com/i6moons/feexpay-server/issues).

## Contribuer

Les contributions sont les bienvenues : voir [CONTRIBUTING.md](CONTRIBUTING.md). Pour signaler une faille, lisez [SECURITY.md](SECURITY.md).

```sh
npm install
npm test
npm run typecheck
npm run build
```

## Licence

[MIT](LICENSE) © Del Prudence ([@i6moons](https://github.com/i6moons)).

---

### English

`feexpay-server` is a typed, zero-dependency, server-only SDK for the [FeexPay](https://feexpay.me) payment API (West and Central Africa).

- **Mobile Money**: 17 networks across Benin, Togo, Côte d'Ivoire, Congo, Senegal and Burkina Faso.
- **Card payments**, with a strict check of the checkout URL.
- **Webhook handler**: verifies the shared secret, then re-reads every notification from the status API, since webhooks are not signed.
- **Sandbox simulator** for offline tests.

It runs anywhere `fetch` exists: Node.js 20+, Next.js (including Edge), Bun, Deno and Cloudflare Workers. Unlike the official browser SDKs, your `fp_…` key never leaves the server. See the French sections above for the API; code samples are self-explanatory.
