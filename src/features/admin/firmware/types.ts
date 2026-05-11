export type FirmwareReleaseStatus = 'published' | 'deprecated' | 'invalid'

export type FirmwareRelease = {
  id: string
  version: string
  hw_target: string
  url: string
  sha256: string
  size_bytes: number
  uploaded_at: string
  release_notes: string | null
  status: FirmwareReleaseStatus
}

export type OtaUpdateDispatchResponse = {
  cmd_id: string
  issued_at: string
  expires_at: string
  target_version: string
  serial: string
}

export type FirmwareUpdatePhase =
  | 'starting'
  | 'downloading'
  | 'verifying'
  | 'installing'
  | 'rebooting'

export type FirmwareUpdateProgress = {
  phase: FirmwareUpdatePhase
  percent: number
  bytes_downloaded?: number
  bytes_total?: number
  target_version: string
  ts: number  // ms epoch
}

export type FirmwareUpdateTerminal =
  | { kind: 'succeeded'; target_version: string; ts: number }
  | { kind: 'failed'; phase: string; error: string; target_version: string; ts: number }
  | { kind: 'validated'; fw_version: string; ts: number }
  | { kind: 'refused'; reason: string; ts: number }
