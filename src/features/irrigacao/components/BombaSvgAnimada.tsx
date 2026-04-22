import { formatHMS } from '../utils/formatters'

type Props = {
  ligada: boolean
  /**
   * 'ligada_ha' = contador crescente (bomba manual); valor em segundos.
   * 'desliga_em' = countdown (ligada por automação); valor em segundos.
   */
  mode?: 'ligada_ha' | 'desliga_em' | null
  seconds?: number
  size?: number
}

/**
 * Bomba: anel externo animado rotacionando quando ligada (verde).
 * Contador central NÃO rotaciona — é um <g> separado.
 * Desligada: anel estático cinza, contador parado em 00:00:00.
 */
export function BombaSvgAnimada({
  ligada,
  mode,
  seconds,
  size = 220,
}: Props) {
  const ringColor = ligada ? '#16a34a' /* emerald-600 */ : '#6b7280' /* gray-500 */
  const labelColor = ligada ? 'text-emerald-700' : 'text-muted-foreground'

  const counterLabel =
    mode === 'ligada_ha' ? 'Ligada há'
    : mode === 'desliga_em' ? 'Desliga em'
    : ''

  const counterValue = seconds != null ? formatHMS(seconds) : '00:00:00'

  return (
    <div className="flex flex-col items-center">
      <svg
        viewBox="0 0 100 100"
        width={size}
        height={size}
        aria-label={ligada ? 'Bomba ligada' : 'Bomba desligada'}
        role="img"
      >
        <defs>
          <style>{`
            .xt-bomba-ring {
              transform-origin: 50% 50%;
              ${ligada ? 'animation: xt-bomba-spin 2.2s linear infinite;' : ''}
            }
            @keyframes xt-bomba-spin {
              from { transform: rotate(0deg); }
              to   { transform: rotate(360deg); }
            }
          `}</style>
        </defs>

        {/* Anel externo — único elemento que rotaciona */}
        <g className="xt-bomba-ring">
          <circle
            cx="50" cy="50" r="42"
            fill="none"
            stroke={ringColor}
            strokeWidth="4"
            strokeDasharray="8 4"
            opacity={ligada ? 1 : 0.5}
          />
        </g>

        {/* Miolo fixo: não rotaciona */}
        <g>
          <circle
            cx="50" cy="50" r="34"
            fill={ligada ? '#dcfce7' /* emerald-100 */ : '#f3f4f6' /* gray-100 */}
            stroke={ringColor}
            strokeWidth="1.5"
          />
        </g>
      </svg>

      <div className="mt-3 text-center">
        {counterLabel && (
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            {counterLabel}
          </div>
        )}
        <div
          className={`font-mono text-2xl sm:text-3xl font-semibold tabular-nums ${labelColor}`}
        >
          {counterValue}
        </div>
      </div>
    </div>
  )
}
