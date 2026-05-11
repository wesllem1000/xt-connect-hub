import { api } from '@/lib/api'
import type { FirmwareRelease, OtaUpdateDispatchResponse } from './types'

export async function listFirmwareReleases(
  hw_target?: string,
): Promise<FirmwareRelease[]> {
  const sp = new URLSearchParams()
  if (hw_target) sp.set('hw_target', hw_target)
  const qs = sp.toString()
  const url = 'admin/firmware' + (qs ? `?${qs}` : '')
  const { releases } = await api.get(url).json<{ releases: FirmwareRelease[] }>()
  return releases
}

export async function dispatchFirmwareUpdate(
  deviceId: string,
  releaseId: string,
): Promise<OtaUpdateDispatchResponse> {
  return api
    .post(`admin/devices/${deviceId}/firmware/update`, {
      json: { release_id: releaseId },
    })
    .json<OtaUpdateDispatchResponse>()
}
