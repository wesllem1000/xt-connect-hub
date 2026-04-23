import { api } from '@/lib/api'
import type { ClaimInput, ClaimResponse, PreviewClaimResponse } from './types'

export async function claimDispositivo(input: ClaimInput): Promise<ClaimResponse> {
  return api.post('dispositivos/claim', { json: input }).json<ClaimResponse>()
}

export async function previewClaim(params: {
  token?: string
  serial?: string
  pairing_code?: string
}): Promise<PreviewClaimResponse> {
  const sp = new URLSearchParams()
  if (params.token) sp.set('token', params.token)
  if (params.serial) sp.set('serial', params.serial)
  if (params.pairing_code) sp.set('pairing_code', params.pairing_code)
  return api
    .get('dispositivos/preview-claim?' + sp.toString())
    .json<PreviewClaimResponse>()
}
