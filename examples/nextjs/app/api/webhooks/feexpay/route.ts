import { createWebhookHandler } from 'feexpay-server'
import { getFeexPay } from '@/lib/feexpay'
import { applyTransaction } from '@/lib/orders'

// URL à saisir dans le tableau de bord FeexPay (section Webhooks) : https://votre-site/api/webhooks/feexpay
// Authentification : Bearer, avec la valeur de FEEXPAY_WEBHOOK_SECRET.
export const POST = createWebhookHandler({
  // Fonctions lues au premier webhook : `next build` n'a pas besoin des variables FeexPay.
  feexpay: getFeexPay,
  secret: () => process.env.FEEXPAY_WEBHOOK_SECRET,
  // La transaction reçue ici a été relue auprès de l'API de statut : le corps du webhook n'est pas cru.
  onPayment: ({ transaction }) => {
    applyTransaction(transaction)
  },
})
