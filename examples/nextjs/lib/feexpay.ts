import 'server-only'
import { createFeexPay, type FeexPay } from 'feexpay-server'

let client: FeexPay | undefined

/** Créé à la première requête : `next build` n'a pas besoin des variables FeexPay. */
export function getFeexPay(): FeexPay {
  return (client ??= createFeexPay({
    environment: process.env.FEEXPAY_ENV as 'sandbox' | 'live',
    apiKey: process.env.FEEXPAY_API_KEY ?? '',
    shopId: process.env.FEEXPAY_SHOP_ID ?? '',
  }))
}
