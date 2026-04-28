import { cn } from '@/lib/utils'

type Props = {
  /** Leitura atual em °C. null/undefined = sem leitura ainda. */
  valueC: number | null | undefined
  /** Limite de alarme em °C — desenha um tick laranja no arco. */
  limiteC: number
  /** Histerese em °C — desenha zona de warn (limite-histerese..limite). */
  histereseC?: number
  /** true se há alarme ativo (override visual independente da leitura). */
  alarme?: boolean
  /** Tamanho do componente em px (height = width). */
  size?: number
  /** Mostra escala numérica (min/limite/max) no rodapé do arco. */
  showScale?: boolean
  /** Faixa visual do gauge. Default 0..100°C. */
  minC?: number
  maxC?: number
  className?: string
}

/**
 * Gauge circular semi-aberto (270°) + display digital no centro.
 * Sem dependência externa — SVG inline. O arco é colorido por faixa:
 *   verde (< limite-histerese), amarelo (limite-histerese..limite), vermelho (>= limite).
 */
export function TemperatureGauge({
  valueC,
  limiteC,
  histereseC = 5,
  alarme = false,
  size = 200,
  showScale = true,
  minC = 0,
  maxC = 100,
  className,
}: Props) {
  // Geometria: arco de 240° abrindo pra baixo (-120° a +120° do topo).
  const cx = size / 2
  const cy = size / 2
  const radius = size / 2 - 18
  const strokeW = 14
  const startAngle = -210 // graus (-210 = 150° em sentido horário a partir do topo, fica no canto inferior esquerdo)
  const endAngle = 30 // canto inferior direito
  const totalSpan = endAngle - startAngle // 240°

  function valueToAngle(v: number): number {
    const t = Math.max(0, Math.min(1, (v - minC) / (maxC - minC)))
    return startAngle + t * totalSpan
  }

  function polar(angleDeg: number, r: number) {
    const a = (angleDeg * Math.PI) / 180
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }
  }

  function arcPath(fromDeg: number, toDeg: number, r: number): string {
    const a = polar(fromDeg, r)
    const b = polar(toDeg, r)
    const large = Math.abs(toDeg - fromDeg) > 180 ? 1 : 0
    const sweep = toDeg > fromDeg ? 1 : 0
    return `M ${a.x} ${a.y} A ${r} ${r} 0 ${large} ${sweep} ${b.x} ${b.y}`
  }

  const warnStartC = Math.max(minC, limiteC - histereseC)

  // Faixas do trilho colorido (sempre visíveis como background do gauge).
  const angOk = [valueToAngle(minC), valueToAngle(warnStartC)]
  const angWarn = [valueToAngle(warnStartC), valueToAngle(limiteC)]
  const angAlert = [valueToAngle(limiteC), valueToAngle(maxC)]

  // Posição da agulha. Se sem leitura, mantém no início (mostra "—" digital).
  const needleAngle =
    valueC != null ? valueToAngle(Math.max(minC, Math.min(maxC, valueC))) : null

  // Tick marker do limite (linha curta atravessando o arco, laranja)
  const limitInner = polar(valueToAngle(limiteC), radius - strokeW / 2 - 4)
  const limitOuter = polar(valueToAngle(limiteC), radius + strokeW / 2 + 4)

  // Cor do display digital
  const valueIsAlarm =
    alarme || (valueC != null && valueC >= limiteC)
  const valueIsWarn = valueC != null && valueC >= warnStartC && !valueIsAlarm

  return (
    <div
      className={cn('inline-flex flex-col items-center select-none', className)}
      style={{ width: size }}
    >
      <div className="relative" style={{ width: size, height: size * 0.78 }}>
        <svg
          viewBox={`0 0 ${size} ${size * 0.78}`}
          width={size}
          height={size * 0.78}
          aria-label={
            valueC != null
              ? `Temperatura ${valueC.toFixed(1)} graus Celsius`
              : 'Temperatura sem leitura'
          }
        >
          {/* Trilho — segmentos coloridos */}
          <path
            d={arcPath(angOk[0], angOk[1], radius)}
            fill="none"
            stroke="hsl(142 71% 45%)"
            strokeWidth={strokeW}
            strokeLinecap="round"
            opacity="0.85"
          />
          <path
            d={arcPath(angWarn[0], angWarn[1], radius)}
            fill="none"
            stroke="hsl(38 92% 50%)"
            strokeWidth={strokeW}
            strokeLinecap="butt"
            opacity="0.85"
          />
          <path
            d={arcPath(angAlert[0], angAlert[1], radius)}
            fill="none"
            stroke="hsl(0 84% 55%)"
            strokeWidth={strokeW}
            strokeLinecap="round"
            opacity="0.85"
          />

          {/* Tick do limite */}
          <line
            x1={limitInner.x}
            y1={limitInner.y}
            x2={limitOuter.x}
            y2={limitOuter.y}
            stroke="hsl(0 84% 50%)"
            strokeWidth={3}
            strokeLinecap="round"
          />

          {/* Agulha (só quando há leitura) */}
          {needleAngle != null && (
            <>
              <line
                x1={cx}
                y1={cy}
                x2={polar(needleAngle, radius - strokeW - 2).x}
                y2={polar(needleAngle, radius - strokeW - 2).y}
                stroke={
                  valueIsAlarm
                    ? 'hsl(0 84% 50%)'
                    : valueIsWarn
                      ? 'hsl(38 92% 50%)'
                      : 'hsl(220 14% 30%)'
                }
                strokeWidth={3}
                strokeLinecap="round"
              />
              <circle cx={cx} cy={cy} r={6} fill="hsl(220 14% 30%)" />
              <circle cx={cx} cy={cy} r={2.5} fill="white" />
            </>
          )}
        </svg>

        {/* Display digital — sobreposto, abaixo do centro */}
        <div
          className="absolute inset-x-0 flex flex-col items-center pointer-events-none"
          style={{ top: '52%' }}
        >
          <div
            className={cn(
              'font-mono tabular-nums leading-none',
              valueIsAlarm
                ? 'text-red-600'
                : valueIsWarn
                  ? 'text-amber-600'
                  : 'text-foreground',
            )}
            style={{ fontSize: size * 0.22 }}
          >
            {valueC != null ? valueC.toFixed(1) : '—'}
          </div>
          <div
            className="text-muted-foreground font-medium tracking-widest mt-1"
            style={{ fontSize: size * 0.07 }}
          >
            °C
          </div>
        </div>
      </div>

      {showScale && (
        <div
          className="flex items-center justify-between text-[10px] text-muted-foreground mt-1 font-mono"
          style={{ width: size * 0.85 }}
        >
          <span>{minC}°</span>
          <span className="text-red-600 font-semibold">
            limite {limiteC.toFixed(0)}°
          </span>
          <span>{maxC}°</span>
        </div>
      )}
    </div>
  )
}
