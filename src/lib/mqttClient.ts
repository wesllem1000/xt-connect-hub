import mqtt, { type MqttClient } from 'mqtt'

import { queryClient } from '@/lib/queryClient'

let client: MqttClient | null = null
const subs = new Map<string, Set<(payload: unknown) => void>>()

// Evita storm: só invalida se a última reconexão foi há >= 1.5s.
let lastReconnectInvalidate = 0

function ensureClient(): MqttClient {
  if (client) return client
  const url = import.meta.env.VITE_MQTT_WSS_URL
  const username = import.meta.env.VITE_MQTT_USER
  const password = import.meta.env.VITE_MQTT_PASSWORD
  if (!url || !username || !password) {
    throw new Error('MQTT WSS env vars ausentes (VITE_MQTT_WSS_URL/USER/PASSWORD)')
  }
  const c = mqtt.connect(url, {
    username,
    password,
    reconnectPeriod: 3000,
    connectTimeout: 10000,
    clean: true,
    protocolVersion: 4,
  })
  c.on('message', (topic, payload) => {
    const handlers = subs.get(topic)
    if (!handlers || handlers.size === 0) return
    let parsed: unknown = null
    try {
      parsed = JSON.parse(payload.toString())
    } catch {
      parsed = payload.toString()
    }
    handlers.forEach((h) => {
      try { h(parsed) } catch { /* swallow handler errors */ }
    })
  })
  c.on('error', (err) => {
    console.warn('[mqtt] error:', err.message)
  })
  // Ao (re)conectar depois de uma desconexão, força refetch da lista de
  // dispositivos pra ressincronizar is_online/last_seen que podem ter mudado
  // enquanto o WebSocket estava fora do ar (ex: sweeper rodou durante tab
  // em background).
  c.on('connect', () => {
    const now = Date.now()
    if (now - lastReconnectInvalidate < 1500) return
    lastReconnectInvalidate = now
    queryClient.invalidateQueries({ queryKey: ['dispositivos'] })
  })
  client = c
  return c
}

export function subscribeTopic(topic: string, handler: (payload: unknown) => void): () => void {
  const c = ensureClient()
  let set = subs.get(topic)
  if (!set) {
    set = new Set()
    subs.set(topic, set)
    c.subscribe(topic, { qos: 0 }, (err) => {
      if (err) console.warn('[mqtt] subscribe failed:', topic, err.message)
    })
  }
  set.add(handler)
  return () => {
    const s = subs.get(topic)
    if (!s) return
    s.delete(handler)
    if (s.size === 0) {
      subs.delete(topic)
      c.unsubscribe(topic)
    }
  }
}
