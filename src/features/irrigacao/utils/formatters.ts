// E4.1 — formatters pro módulo IRR-V1

import type { IrrigationSector, IrrigationTimer, TimerTipo } from '../types'

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

export type NextTimerEvent = {
  timerId: string
  timerName: string
  tipo: TimerTipo
  targetLabel: string
  fireAt: Date
  /** Para cyclic_continuous quando hoje está no mask: timer já está ciclando. */
  runningNow: boolean
}

function parseHm(t: string | null | undefined): { h: number; m: number } | null {
  if (!t || typeof t !== 'string') return null
  const m = /^(\d{1,2}):(\d{2})/.exec(t)
  if (!m) return null
  const h = Number(m[1])
  const mi = Number(m[2])
  if (!Number.isFinite(h) || !Number.isFinite(mi)) return null
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null
  return { h, m: mi }
}

/**
 * Próximo disparo do timer a partir de `now`.
 * - fixed/cyclic_window: hora_inicio no próximo dia permitido (mask de dias_semana).
 * - cyclic_continuous: se hoje está no mask, retorna runningNow=true (já ciclando);
 *   senão, próximo dia permitido às 00:00.
 */
export function nextTimerFire(
  t: IrrigationTimer,
  now: Date = new Date(),
): NextTimerEvent | null {
  if (!t.ativo || t.pausado) return null
  if (!t.dias_semana) return null

  const todayDow = now.getDay()

  if (t.tipo === 'cyclic_continuous') {
    if (t.dias_semana & (1 << todayDow)) {
      return {
        timerId: t.id,
        timerName: t.nome,
        tipo: t.tipo,
        targetLabel: '',
        fireAt: now,
        runningNow: true,
      }
    }
    for (let i = 1; i <= 7; i++) {
      const d = (todayDow + i) % 7
      if (t.dias_semana & (1 << d)) {
        const target = new Date(now)
        target.setDate(target.getDate() + i)
        target.setHours(0, 0, 0, 0)
        return {
          timerId: t.id,
          timerName: t.nome,
          tipo: t.tipo,
          targetLabel: '',
          fireAt: target,
          runningNow: false,
        }
      }
    }
    return null
  }

  const hm = parseHm(t.hora_inicio)
  if (!hm) return null

  for (let i = 0; i <= 7; i++) {
    const d = (todayDow + i) % 7
    if (!(t.dias_semana & (1 << d))) continue
    const target = new Date(now)
    target.setDate(target.getDate() + i)
    target.setHours(hm.h, hm.m, 0, 0)
    if (target.getTime() > now.getTime()) {
      return {
        timerId: t.id,
        timerName: t.nome,
        tipo: t.tipo,
        targetLabel: '',
        fireAt: target,
        runningNow: false,
      }
    }
  }
  return null
}

export function getNextTimerEvents(
  timers: IrrigationTimer[],
  sectors: IrrigationSector[],
  n: number,
  now: Date = new Date(),
): NextTimerEvent[] {
  const sectorById = new Map(sectors.map((s) => [s.id, s]))
  const evs: NextTimerEvent[] = []
  for (const t of timers) {
    const ev = nextTimerFire(t, now)
    if (!ev) continue
    let label = 'Bomba'
    if (t.alvo_tipo === 'sector' && t.alvo_id) {
      const s = sectorById.get(t.alvo_id)
      label = s ? `Setor ${s.numero} · ${s.nome}` : 'Setor'
    }
    ev.targetLabel = label
    evs.push(ev)
  }
  evs.sort((a, b) => {
    if (a.runningNow && !b.runningNow) return -1
    if (!a.runningNow && b.runningNow) return 1
    return a.fireAt.getTime() - b.fireAt.getTime()
  })
  return evs.slice(0, n)
}

const DIAS_LONGOS = [
  'domingo',
  'segunda',
  'terça',
  'quarta',
  'quinta',
  'sexta',
  'sábado',
]

/** "hoje 14:30", "amanhã 06:00", "quinta 14:30" ou "DD/MM HH:MM" se >7 dias. */
export function formatFireAt(fireAt: Date, now: Date = new Date()): string {
  const a = new Date(now)
  a.setHours(0, 0, 0, 0)
  const b = new Date(fireAt)
  b.setHours(0, 0, 0, 0)
  const diffDays = Math.round((b.getTime() - a.getTime()) / 86400000)
  const hh = String(fireAt.getHours()).padStart(2, '0')
  const mm = String(fireAt.getMinutes()).padStart(2, '0')
  const hm = `${hh}:${mm}`
  if (diffDays <= 0) return `hoje ${hm}`
  if (diffDays === 1) return `amanhã ${hm}`
  if (diffDays < 7) return `${DIAS_LONGOS[fireAt.getDay()]} ${hm}`
  const dd = String(fireAt.getDate()).padStart(2, '0')
  const mo = String(fireAt.getMonth() + 1).padStart(2, '0')
  return `${dd}/${mo} ${hm}`
}
