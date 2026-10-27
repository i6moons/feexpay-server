# Changelog

## 0.1.0 (2026-10-27)

Première version.

- `createFeexPay` : client serveur, garde-fous sur l'environnement, la clé et l'exécution dans un navigateur.
- Mobile Money sur 17 réseaux (Bénin, Togo, Côte d'Ivoire, Congo, Sénégal, Burkina Faso) :
  - `requestPayment`, avec la validation des numéros et des montants ;
  - le parcours Coris en deux étapes et l'OTP d'Orange Burkina Faso.
- Suivi des paiements : `getTransaction`, `findTransaction` (par `callback_info` ou `description`), `waitForFinalStatus`.
- Carte bancaire : `createCardPayment`, avec la vérification de la page de paiement.
- `resendWebhook`.
- Webhook : `createWebhookHandler` (format `Request`/`Response`), qui vérifie le secret et relit chaque transaction auprès de l'API de statut.
- Erreurs typées : `FeexPayError` (avec `kind` et `outcomeUnknown`), `FeexPayConfigError`, `FeexPayValidationError`.
- `feexpay-server/testing` : simulateur de la sandbox FeexPay.
- Exemple Next.js (App Router).
