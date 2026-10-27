import 'server-only'
import type { Transaction } from 'feexpay-server'

// Démo : un stockage en mémoire, perdu à chaque redémarrage. Remplacez-le par votre base de données.

export interface Order {
  id: string
  label: string
  /** Prix fixé par le serveur : le navigateur ne choisit jamais le montant. */
  amount: number
  status: 'pending' | 'paid' | 'failed'
  /** `callbackInfo` de la dernière tentative, pour relier la transaction FeexPay à la commande. */
  attempt?: string
}

// Sur globalThis : Next.js peut charger ce module une fois par route.
const store = globalThis as typeof globalThis & { __demoOrders?: Map<string, Order> }
const orders = (store.__demoOrders ??= new Map<string, Order>([
  ['order_demo', { id: 'order_demo', label: 'Abonnement Premium', amount: 2500, status: 'pending' }],
]))

export function getOrder(id: string): Order | null {
  return orders.get(id) ?? null
}

/** Une tentative = un identifiant d'un seul mot, pour pouvoir la retrouver avec `findTransaction`. */
export function newAttempt(order: Order): string {
  order.attempt = `${order.id}:${crypto.randomUUID().slice(0, 8)}`
  return order.attempt
}

export function orderOfAttempt(attempt: unknown): Order | null {
  if (typeof attempt !== 'string') return null
  const order = orders.get(attempt.split(':')[0] ?? '')
  return order && order.attempt === attempt ? order : null
}

/**
 * Applique une transaction relue auprès de FeexPay. Idempotent : le webhook et le suivi du
 * navigateur peuvent tous deux l'appeler pour la même transaction.
 */
export function applyTransaction(transaction: Transaction): Order | null {
  const order = orderOfAttempt(transaction.callbackInfo)
  if (!order || order.status === 'paid') return order
  if (transaction.status === 'SUCCESSFUL') {
    if (transaction.amount >= order.amount) order.status = 'paid'
    else console.error(`Paiement ${transaction.reference} inférieur au prix de ${order.id} : à vérifier.`)
  } else if (transaction.status === 'FAILED') {
    order.status = 'failed'
  }
  return order
}
