import { QueryClient } from '@tanstack/react-query'

/**
 * Singleton exposto pra que módulos fora da árvore React (ex.: mqttClient)
 * possam disparar invalidate queries em eventos externos.
 */
export const queryClient = new QueryClient()
