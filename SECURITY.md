# Sécurité

## Signaler une faille dans feexpay-server

N'ouvrez pas d'issue publique. Utilisez le signalement privé de GitHub : onglet **Security** du dépôt, puis **Report a vulnerability**.

Décrivez la version concernée, le scénario et son impact. Vous recevrez une réponse sous 7 jours. Les correctifs de sécurité sont publiés en priorité, avec une mention dans le [CHANGELOG](CHANGELOG.md), et votre nom si vous le souhaitez.

## Faille dans FeexPay lui-même

Si le problème concerne la plateforme FeexPay (API, tableau de bord, SDK officiels) et non ce paquet, écrivez à FeexPay : support@feexpay.com (adresse donnée dans leur [documentation](https://docs.feexpay.me/?section=security&version=v2)).

## Ce que le paquet garantit

- La clé d'API n'est jamais écrite dans un message d'erreur ni renvoyée dans un objet.
- `createFeexPay` refuse de démarrer dans un navigateur, sauf option `dangerouslyAllowBrowser`.
- Le webhook compare le secret en temps constant et ne croit jamais son contenu : chaque transaction est relue auprès de l'API de statut.
- `paymentUrl` (carte) n'accepte que les hôtes FeexPay documentés ; les autres URL renvoyées doivent être en https.
- Aucune dépendance d'exécution : rien d'autre que votre code et ce paquet ne touche à la clé.
