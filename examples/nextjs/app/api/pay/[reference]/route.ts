import { getFeexPay } from '@/lib/feexpay'
import { applyTransaction } from '@/lib/orders'

/**
 * Suivi par le navigateur, toutes les 3 s. C'est aussi un filet si le webhook n'arrive pas :
 * la transaction est relue chez FeexPay, puis appliquée à la commande.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ reference: string }> }) {
  const { reference } = await params
  const transaction = await getFeexPay().getTransaction(reference)
  const order = transaction ? applyTransaction(transaction) : null
  // Une référence qui ne correspond à aucune de nos commandes ne révèle rien.
  if (!transaction || !order) return Response.json({ status: 'UNKNOWN' }, { status: 404 })
  return Response.json({ status: transaction.status, order: order.status })
}
