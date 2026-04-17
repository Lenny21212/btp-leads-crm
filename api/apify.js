// api/apify.js — Proxy Vercel pour contourner le CORS vers Apify
// Le navigateur appelle /api/apify, ce serveur appelle Apify

const APIFY_BASE = 'https://api.apify.com/v2'

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    return res.status(200).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { action, apiKey, actorId, input, runId, datasetId } = req.body

  // Apify utilise ~ comme separateur dans les URLs d'API (pas /)
  const safeActorId = (actorId || '').replace('/', '~')

  try {
    if (action === 'start') {
      // Lance un acteur
      const response = await fetch(`${APIFY_BASE}/acts/${safeActorId}/runs?token=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      const data = await response.json()
      return res.status(200).json(data)
    }

    if (action === 'status') {
      // Vérifie le statut d'un run
      const response = await fetch(`${APIFY_BASE}/actor-runs/${runId}?token=${apiKey}`)
      const data = await response.json()
      return res.status(200).json(data)
    }

    if (action === 'results') {
      // Récupère les résultats d'un dataset
      const response = await fetch(
        `${APIFY_BASE}/datasets/${datasetId}/items?token=${apiKey}&format=json&clean=true`
      )
      const data = await response.json()
      return res.status(200).json(data)
    }

    return res.status(400).json({ error: 'Action inconnue' })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
