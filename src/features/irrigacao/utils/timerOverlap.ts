// E4.2A — mirror client-side de infra/scripts/lib/timer-overlap.cjs
// Qualquer mudança lá deve ser replicada aqui.

import type { IrrigationTimer, TimerAlvoTipo } from '../types'

export type OverlapWindow = {
  dia: number // 0=dom .. 6=sab
  start: string // "HH:MM"
  end: string
}

export type TimerConflict = {
  with_timer_id: string
  with_timer_name: string
  alvo_tipo: TimerAlvoTipo
  alvo_id: string | null
  reason: 'same_target_overlap' | 'different_target_overlap' | 'cyclic_continuous_mutex'
  overlap_windows: OverlapWindow[]
}

export type OverlapResult = {
  errors: TimerConflict[]
  warnings: TimerConflict[]
}

function hmToMin(t: string | null | undefined): number | null {
  if (!t || typeof t !== 'string') return null
  const m = t.match(/^(\d{2}):(\d{2})(?::\d{2})?$/)
  if (!m) return null
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10)
}

function minToHm(mins: number): string {
  const h = Math.floor(mins / 60) % 24
  const m = mins % 60
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0')
}

type ExpandedWindows = {
  is_continuous: boolean
  windows: Array<{ dia: number; start_min: number; end_min: number }>
}

function expandTimer(t: Partial<IrrigationTimer>): ExpandedWindows {
  const dias: number[] = []
  const mask = t.dias_semana ?? 0
  for (let d = 0; d < 7; d++) if (mask & (1 << d)) dias.push(d)

  if (t.tipo === 'cyclic_continuous') {
    return {
      is_continuous: true,
      windows: dias.map((dia) => ({ dia, start_min: 0, end_min: 1440 })),
    }
  }

  if (t.tipo === 'fixed') {
    const start = hmToMin(t.hora_inicio ?? null)
    const dur = t.duracao_min ?? 0
    if (start == null || !Number.isFinite(dur) || dur <= 0) {
      return { is_continuous: false, windows: [] }
    }
    const end = Math.min(1440, start + dur)
    return {
      is_continuous: false,
      windows: dias.map((dia) => ({ dia, start_min: start, end_min: end })),
    }
  }

  if (t.tipo === 'cyclic_window') {
    const wStart = hmToMin(t.hora_inicio ?? null)
    const wEnd = hmToMin(t.hora_fim ?? null)
    const on = t.on_minutes ?? 0
    const off = t.off_minutes ?? 0
    if (wStart == null || wEnd == null || !Number.isFinite(on) || !Number.isFinite(off) || on <= 0 || off < 0 || wEnd <= wStart) {
      return { is_continuous: false, windows: [] }
    }
    const windows = []
    for (const dia of dias) {
      let cur = wStart
      while (cur < wEnd) {
        const end = Math.min(wEnd, cur + on)
        windows.push({ dia, start_min: cur, end_min: end })
        cur = end + off
      }
    }
    return { is_continuous: false, windows }
  }

  return { is_continuous: false, windows: [] }
}

function sameTarget(a: Partial<IrrigationTimer>, b: Partial<IrrigationTimer>): boolean {
  if (a.alvo_tipo !== b.alvo_tipo) return false
  if (a.alvo_tipo === 'pump') return true
  return Boolean(a.alvo_id && b.alvo_id && a.alvo_id === b.alvo_id)
}

function intersect(
  w1: { dia: number; start_min: number; end_min: number },
  w2: { dia: number; start_min: number; end_min: number },
): { dia: number; start_min: number; end_min: number } | null {
  if (w1.dia !== w2.dia) return null
  const start = Math.max(w1.start_min, w2.start_min)
  const end = Math.min(w1.end_min, w2.end_min)
  if (end <= start) return null
  return { dia: w1.dia, start_min: start, end_min: end }
}

export function detectOverlap(
  existing: IrrigationTimer[],
  proposed: Partial<IrrigationTimer>,
): OverlapResult {
  const errors: TimerConflict[] = []
  const warnings: TimerConflict[] = []

  const pExp = expandTimer(proposed)
  if (pExp.windows.length === 0 && !pExp.is_continuous) return { errors, warnings }

  for (const e of existing) {
    if (!e.ativo) continue
    const eExp = expandTimer(e)
    const isSame = sameTarget(proposed, e)

    if (isSame && (pExp.is_continuous || eExp.is_continuous)) {
      errors.push({
        with_timer_id: e.id,
        with_timer_name: e.nome,
        alvo_tipo: e.alvo_tipo,
        alvo_id: e.alvo_id,
        reason: 'cyclic_continuous_mutex',
        overlap_windows: [],
      })
      continue
    }

    const intersections: OverlapWindow[] = []
    for (const pw of pExp.windows) {
      for (const ew of eExp.windows) {
        const inter = intersect(pw, ew)
        if (inter) intersections.push({ dia: inter.dia, start: minToHm(inter.start_min), end: minToHm(inter.end_min) })
      }
    }
    if (intersections.length === 0) continue

    const conflict: TimerConflict = {
      with_timer_id: e.id,
      with_timer_name: e.nome,
      alvo_tipo: e.alvo_tipo,
      alvo_id: e.alvo_id,
      reason: isSame ? 'same_target_overlap' : 'different_target_overlap',
      overlap_windows: intersections,
    }
    if (isSame) errors.push(conflict)
    else warnings.push(conflict)
  }

  return { errors, warnings }
}
