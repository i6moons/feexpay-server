# Exemple Next.js (App Router)

Une boutique minimale qui encaisse par Mobile Money avec `feexpay-server`.

| Fichier | Rôle |
| --- | --- |
| [`lib/feexpay.ts`](lib/feexpay.ts) | Le client FeexPay, créé à la première requête (`server-only`) |
| [`lib/orders.ts`](lib/orders.ts) | Les commandes (en mémoire pour la démo) et `applyTransaction`, idempotent |
| [`app/api/pay/route.ts`](app/api/pay/route.ts) | Lance le paiement : le prix vient du serveur |
| [`app/api/pay/[reference]/route.ts`](app/api/pay/%5Breference%5D/route.ts) | Suivi depuis le navigateur, et filet si le webhook se perd |
| [`app/api/webhooks/feexpay/route.ts`](app/api/webhooks/feexpay/route.ts) | Le webhook, revérifié auprès de l'API de statut |
| [`app/page.tsx`](app/page.tsx) | Le formulaire : opérateur, numéro, puis attente de la validation |

## Lancer

1. Créez un compte de test sur [sandbox-app.feexpay.me](https://sandbox-app.feexpay.me) et copiez votre clé (`test_key_…`) et l'identifiant de la boutique.
2. Puis :

```sh
# à la racine du dépôt : construire le paquet
npm install && npm run build

# dans ce dossier
cd examples/nextjs
cp .env.example .env.local   # puis remplissez-le
npm install
npm run dev
```

Ouvrez http://localhost:3000.

En sandbox, utilisez un numéro de test : `01 97 00 00 00` réussit tout de suite, `01 97 00 00 05` passe par l'attente, `01 97 00 00 01` échoue.

Pour recevoir les webhooks en local, exposez le port 3000 (par exemple avec `cloudflared tunnel --url http://localhost:3000`). Saisissez ensuite l'URL `…/api/webhooks/feexpay` dans le tableau de bord sandbox, section Webhooks, avec `Bearer` et la valeur de `FEEXPAY_WEBHOOK_SECRET`.
