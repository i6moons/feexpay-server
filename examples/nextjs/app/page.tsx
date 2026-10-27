'use client'

import { useState } from 'react'

const NETWORKS = [
  { id: 'mtn', label: 'MTN MoMo (Bénin)' },
  { id: 'moov', label: 'Moov Money (Bénin)' },
  { id: 'celtiis_bj', label: 'Celtiis Cash (Bénin)' },
  { id: 'mtn_ci', label: "MTN MoMo (Côte d'Ivoire)" },
  { id: 'wave_ci', label: "Wave (Côte d'Ivoire)" },
]

const POLL_EVERY_MS = 3_000
const POLL_FOR_MS = 3 * 60_000

export default function CheckoutPage() {
  const [network, setNetwork] = useState('mtn')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function follow(reference: string) {
    const deadline = Date.now() + POLL_FOR_MS
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_EVERY_MS))
      const response = await fetch(`/api/pay/${encodeURIComponent(reference)}`)
      if (!response.ok) continue
      const { status } = (await response.json()) as { status: string }
      if (status === 'SUCCESSFUL') return setMessage('Paiement reçu. Merci !')
      if (status === 'FAILED') return setMessage('Paiement refusé ou annulé. Vous pouvez réessayer.')
    }
    setMessage('Toujours en attente. Si vous avez validé, la confirmation arrivera dans quelques minutes.')
  }

  async function pay(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setMessage(null)
    try {
      const response = await fetch('/api/pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: 'order_demo', network, phoneNumber }),
      })
      const result = (await response.json()) as { reference?: string; status?: string; paymentUrl?: string | null; error?: string }
      if (!response.ok || !result.reference) return setMessage(result.error ?? 'Paiement impossible.')
      if (result.paymentUrl) return window.location.assign(result.paymentUrl) // Wave, Orange…
      if (result.status === 'SUCCESSFUL') return setMessage('Paiement reçu. Merci !')
      if (result.status === 'FAILED') return setMessage('Paiement refusé. Vous pouvez réessayer.')
      setMessage('Validez le paiement sur votre téléphone (code PIN).')
      await follow(result.reference)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main style={{ maxWidth: 420, margin: '48px auto', padding: 16, fontFamily: 'system-ui, sans-serif' }}>
      <h1>Abonnement Premium · 2 500 FCFA</h1>
      <form onSubmit={pay} style={{ display: 'grid', gap: 12 }}>
        <label>
          Opérateur
          <select value={network} onChange={(e) => setNetwork(e.target.value)} style={{ display: 'block', width: '100%' }}>
            {NETWORKS.map((n) => (
              <option key={n.id} value={n.id}>
                {n.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Numéro Mobile Money
          <input
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
            inputMode="tel"
            placeholder="01 97 00 00 00"
            required
            style={{ display: 'block', width: '100%' }}
          />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? 'Paiement en cours…' : 'Payer'}
        </button>
      </form>
      {message && <p role="status">{message}</p>}
    </main>
  )
}
