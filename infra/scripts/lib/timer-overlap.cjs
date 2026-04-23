// E4.2A — detector de sobreposição de timers (R2, §16.10) — refs #71
//
// Source of truth da lógica. Node-RED carrega via global.get, webapp tem
// mirror em TS em src/features/irrigacao/utils/timerOverlap.ts (qualquer
// mudança aqui deve ser replicada lá).
//
// Input: { existing: [timer, …], proposed: timer }
// Output: { errors: [conflict, …], warnings: [conflict, …] }
//
//   conflict = {
//     with_timer_id, with_timer_name,
//     alvo_tipo, alvo_id,
//     dias: [0..6 mask],
//     overlap_windows: [{ dia, start: "HH:MM", end: "HH:MM" }]
//   }

/** Converte "HH:MM" ou "HH:MM:SS" em minutos desde 00:00. */
function hmToMin(t) {
  if (!t || typeof t !== 'string') return null;
  const m = t.match(/^(\d{2}):(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function minToHm(mins) {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

/**
 * Expande um timer em janelas [start, end] em minutos, por dia da semana
 * (0=domingo). Retorna { windows: [{ dia, start_min, end_min }], is_continuous: bool }.
 *
 * - fixed: 1 janela por dia marcado
 * - cyclic_window: alternância on/off dentro de [hora_inicio, hora_fim]
 * - cyclic_continuous: janela [0, 1440] por dia marcado (24/7) — mutex no mesmo alvo
 */
function expandTimer(t) {
  const dias = [];
  for (let d = 0; d < 7; d++) if (t.dias_semana & (1 << d)) dias.push(d);

  if (t.tipo === 'cyclic_continuous') {
    return {
      is_continuous: true,
      windows: dias.map((dia) => ({ dia, start_min: 0, end_min: 1440 })),
    };
  }

  if (t.tipo === 'fixed') {
    const start = hmToMin(t.hora_inicio);
    const dur = t.duracao_min;
    if (start == null || !Number.isFinite(dur) || dur <= 0) return { is_continuous: false, windows: [] };
    const end = Math.min(1440, start + dur);
    return {
      is_continuous: false,
      windows: dias.map((dia) => ({ dia, start_min: start, end_min: end })),
    };
  }

  if (t.tipo === 'cyclic_window') {
    const wStart = hmToMin(t.hora_inicio);
    const wEnd = hmToMin(t.hora_fim);
    const on = t.on_minutes;
    const off = t.off_minutes;
    if (wStart == null || wEnd == null || !Number.isFinite(on) || !Number.isFinite(off) || on <= 0 || off < 0) {
      return { is_continuous: false, windows: [] };
    }
    if (wEnd <= wStart) return { is_continuous: false, windows: [] };
    const windows = [];
    for (const dia of dias) {
      let cur = wStart;
      while (cur < wEnd) {
        const end = Math.min(wEnd, cur + on);
        windows.push({ dia, start_min: cur, end_min: end });
        cur = end + off;
      }
    }
    return { is_continuous: false, windows };
  }

  return { is_continuous: false, windows: [] };
}

function sameTarget(a, b) {
  if (a.alvo_tipo !== b.alvo_tipo) return false;
  if (a.alvo_tipo === 'pump') return true;
  return a.alvo_id && b.alvo_id && a.alvo_id === b.alvo_id;
}

function intersect(w1, w2) {
  if (w1.dia !== w2.dia) return null;
  const start = Math.max(w1.start_min, w2.start_min);
  const end = Math.min(w1.end_min, w2.end_min);
  if (end <= start) return null;
  return { dia: w1.dia, start_min: start, end_min: end };
}

/**
 * Calcula conflitos entre um timer proposto e a lista existente.
 * Ignora o próprio timer em caso de PATCH (filter pelo id antes de chamar).
 */
function detectOverlap(existing, proposed) {
  const errors = [];
  const warnings = [];

  const pExp = expandTimer(proposed);
  if (pExp.windows.length === 0 && !pExp.is_continuous) {
    // Timer inválido ou sem dias — nada a cruzar (validação de campo
    // separada, não é responsabilidade desta lib).
    return { errors, warnings };
  }

  for (const e of existing) {
    if (!e.ativo) continue; // ignora pausados/inativos? incluído ativo apenas
    const eExp = expandTimer(e);
    const isSameTarget = sameTarget(proposed, e);

    // Regra R2 especial: cyclic_continuous no mesmo alvo é mutex
    if (isSameTarget && (pExp.is_continuous || eExp.is_continuous)) {
      errors.push({
        with_timer_id: e.id,
        with_timer_name: e.nome,
        alvo_tipo: e.alvo_tipo,
        alvo_id: e.alvo_id,
        reason: 'cyclic_continuous_mutex',
        overlap_windows: [],
      });
      continue;
    }

    const intersections = [];
    for (const pw of pExp.windows) {
      for (const ew of eExp.windows) {
        const inter = intersect(pw, ew);
        if (inter) intersections.push({
          dia: inter.dia,
          start: minToHm(inter.start_min),
          end: minToHm(inter.end_min),
        });
      }
    }
    if (intersections.length === 0) continue;

    const conflict = {
      with_timer_id: e.id,
      with_timer_name: e.nome,
      alvo_tipo: e.alvo_tipo,
      alvo_id: e.alvo_id,
      overlap_windows: intersections,
    };

    if (isSameTarget) {
      conflict.reason = 'same_target_overlap';
      errors.push(conflict);
    } else {
      conflict.reason = 'different_target_overlap';
      warnings.push(conflict);
    }
  }

  return { errors, warnings };
}

module.exports = { detectOverlap, expandTimer, hmToMin, minToHm };
