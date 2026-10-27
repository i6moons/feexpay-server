import { FeexPayError, FeexPayValidationError, isNetwork } from 'feexpay-server'
import { getFeexPay } from '@/lib/feexpay'
import { getOrder, newAttempt } from '@/lib/orders'

function messageFor(error: FeexPayError): string {
  switch (error.kind) {
    case 'channel_not_configured':
    case 'network_unavailable':
      return 'Ce réseau est indisponible pour le moment. Choisissez-en un autre.'
    case 'invalid_phone_number':
      return "L'opérateur refuse ce numéro. Vérifiez-le."
    case 'invalid_sandbox_number':
      return 'Sandbox : utilisez un numéro de test terminé par 00 à 06.'
    default:
      // Clé refusée, boutique introuvable… : le client n'y peut rien, l'équipe doit le savoir.
      console.error('[FeexPay]', error.kind, error.message)
      return 'Paiement momentanément indisponible. Aucun montant n’a été demandé.'
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const order = typeof body.orderId === 'string' ? getOrder(body.orderId) : null
  if (!order) return Response.json({ error: 'Commande introuvable.' }, { status: 404 })
  if (order.status === 'paid') return Response.json({ error: 'Commande déjà payée.' }, { status: 409 })
  if (!isNetwork(body.network)) return Response.json({ error: 'Réseau inconnu.' }, { status: 400 })

  const feexpay = getFeexPay()
  const attempt = newAttempt(order)
  try {
    const payment = await feexpay.requestPayment({
      network: body.network,
      phoneNumber: String(body.phoneNumber ?? ''),
      amount: order.amount, // le prix vient du serveur, jamais du navigateur
      description: order.label,
      callbackInfo: attempt,
    })
    return Response.json({ reference: payment.reference, status: payment.status, paymentUrl: payment.paymentUrl })
  } catch (error) {
    if (error instanceof FeexPayValidationError) {
      return Response.json({ error: error.message, field: error.field }, { status: 400 })
    }
    if (error instanceof FeexPayError) {
      if (error.outcomeUnknown) {
        // La demande est peut-être déjà sur le téléphone du client : on la cherche avant tout.
        const found = await feexpay.findTransaction({ callbackInfo: attempt }).catch(() => null)
        if (found) return Response.json({ reference: found.reference, status: found.status, paymentUrl: null })
        return Response.json({ error: 'Réponse incertaine de FeexPay. Regardez votre téléphone avant de réessayer.' }, { status: 502 })
      }
      return Response.json({ error: messageFor(error) }, { status: 502 })
    }
    throw error
  }
}
