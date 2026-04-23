// E4.1 — formatters pro módulo IRR-V1

/** Segundos → HH:MM:SS (fixa zero-padding). */
export function formatHMS(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '--:--:--'
  const s = Math.floor(totalSeconds % 60)
  const m = Math.floor((totalSeconds / 60) % 60)
  const h = Math.floor(totalSeconds / 3600)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

/** Cor por temperatura vs limite+histerese (verde/amarelo/vermelho). */
export function colorByTemperature(
  leitura: number | null,
  limite: number,
  histerese: number,
): 'green' | 'yellow' | 'red' | 'muted' {
  if (leitura == null || !Number.isFinite(leitura)) return 'muted'
  if (leitura >= limite) return 'red'
  if (leitura >= limite - histerese) return 'yellow'
  return 'green'
}

/** Bitmask 7-bit → string humana. */
const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab']
export function formatDiasSemana(mask: number): string {
  if (mask === 0) return '—'
  if (mask === 127) return 'Todos os dias'
  if (mask === 0b0111110) return 'Dias úteis' // seg-sex
  if (mask === 0b1000001) return 'Fim de semana'
  const out: string[] = []
  for (let i = 0; i < 7; i++) {
    if (mask & (1 << i)) out.push(DIAS[i])
  }
  return out.join(', ')
}
