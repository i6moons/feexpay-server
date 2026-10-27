# Contribuer

Merci de votre aide ! Issues et pull requests en français ou en anglais.

## Démarrer

```sh
git clone https://github.com/i6moons/feexpay-server.git
cd feexpay-server
npm install
npm test
```

Avant d'ouvrir une pull request : `npm run typecheck`, `npm test` et `npm run build` doivent passer.

## Les règles du projet

1. **Chaque comportement s'appuie sur une source.** Citez la section de la [documentation FeexPay](https://docs.feexpay.me) dans un commentaire. Si c'est un comportement observé et non documenté, dites-le (« observé en production le … »).
2. **Zéro dépendance d'exécution.** `fetch` et les API Web standard suffisent : le paquet doit tourner sur Node, Edge, Bun et Deno.
3. **Un test par comportement**, avec le simulateur (`src/testing.ts`). S'il ne sait pas reproduire un cas, enrichissez-le en suivant la section « Sandbox » de la documentation.
4. **La clé ne sort jamais** : pas dans un message, pas dans un objet renvoyé, pas dans un journal.

## Un réseau se comporte autrement chez vous ?

Ouvrez une issue avec :
- le réseau (`network`) ;
- l'environnement (sandbox ou live) ;
- la requête et la réponse, **sans la clé et avec le numéro masqué** (`maskPhoneNumber`).

Ces retours sont précieux : la documentation ne couvre pas tout.
