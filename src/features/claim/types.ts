export type ClaimSerialInput = {
  serial: string
  pairing_code: string
}

export type ClaimTokenInput = {
  claim_token: string
}

export type ClaimInput = ClaimSerialInput | ClaimTokenInput

export type ClaimedDispositivo = {
  id: string
  serial: string
  status: string
  modelo_nome: string | null
  owner_email: string | null
  nome?: string | null
}

export type ClaimResponse = {
  dispositivo: ClaimedDispositivo
}

export type PreviewClaimResponse = {
  serial: string
  status: string
  modelo: {
    id: string
    nome: string | null
    prefixo: string | null
    major_version: string | null
    icone: string | null
  } | null
}

export const SERIAL_REGEX = /^[A-Z]{3}-V\d+(\.\d+)*-\d{5}$/
export const PAIRING_ALPHABET = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/
