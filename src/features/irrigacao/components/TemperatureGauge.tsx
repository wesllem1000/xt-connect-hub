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
  /** Largura do componente em px. */
  size?: number
  /** Mostra escala numérica (min/limite/max) no rodapé. */
  showScale?: boolean
  /** Faixa visual do gauge. Default 0..100°C. */
  minC?: number
  maxC?: number
  className?: string
}

/**
 * Semicírculo TOP (180°) com 3 zonas coloridas (ok/warn/alert) calculadas
 * a partir do limite e histerese, tick laranja no limite, agulha apontando
 * a leitura atual e display digital ABAIXO do arco. Sem dep externa.
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
  // Geometria SVG (y aumenta pra baixo).
  // Semicírculo TOP: ângulos 180° (esquerda) → 270° (topo) → 360° (direita).
  const padding = 14
  const strokeW = 12
  const cx = size / 2
  const cy = size / 2 + padding / 2 // baseline do semicírculo, deslocado pra
  // dar respiro pra cima do arco
  const radius = size / 2 - padding - strokeW / 2
  const startAngle = 180
  const endAngle = 360
  const totalSpan = endAngle - startAngle // 180

  // Altura do svg = baseline + espaço pro display digital
  const digitalH = Math.round(size * 0.32)
  const svgH = cy + digitalH

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
    // Sweep=1 em SVG (com y invertido) = sentido visual horário, que pelo
    // semicírculo top da esquerda pra direita passa por cima ✓
    return `M ${a.x} ${a.y} A ${r} ${r} 0 ${large} 1 ${b.x} ${b.y}`
  }

  const warnStartC = Math.max(minC, limiteC - histereseC)

  // Zonas — proporcional ao limite, MAS com largura visual minima pra warn
  // (histerese de 3°C numa escala 0-100°C daria ~3° de arco, invisivel).
  // Mantem o desenho honesto sobre limite/alarme; a "zona warn" do gauge e
  // so um aviso visual de proximidade — a logica do alarme no firmware
  // continua usando o warnStartC real.
  const MIN_WARN_DEG = 14
  const naturalWarn =
    valueToAngle(limiteC) - valueToAngle(warnStartC)
  const visualWarnDeg = Math.max(naturalWarn, MIN_WARN_DEG)

  const angOkStart = valueToAngle(minC)
  const angAlertStart = valueToAngle(limiteC)
  const angOkEnd = angAlertStart - visualWarnDeg // warn comeca aqui visualmente
  const angWarnEnd = angAlertStart
  const angAlertEnd = valueToAngle(maxC)

  // Tick do limite (linha cruzando o arco)
  const limitInner = polar(valueToAngle(limiteC), radius - strokeW / 2 - 4)
  const limitOuter = polar(valueToAngle(limiteC), radius + strokeW / 2 + 4)

  // Agulha — só renderiza com leitura
  const needleAngle =
    valueC != null ? valueToAngle(Math.max(minC, Math.min(maxC, valueC))) : null
  const needleTip =
    needleAngle != null ? polar(needleAngle, radius - strokeW / 2 - 6) : null

  // Cores
  const valueIsAlarm =
    alarme || (valueC != null && valueC >= limiteC)
  const valueIsWarn =
    valueC != null && valueC >= warnStartC && !valueIsAlarm

  return (
    <div
      className={cn('inline-flex flex-col items-center select-none', className)}
      style={{ width: size }}
    >
      <svg
        viewBox={`0 0 ${size} ${svgH}`}
        width={size}
        height={svgH}
        aria-label={
          valueC != null
            ? `Temperatura ${valueC.toFixed(1)} graus Celsius`
            : 'Temperatura sem leitura'
        }
      >
        {/* trilho cinza atrás de tudo (caso alguma faixa fique vazia, fica visualmente bonito) */}
        <path
          d={arcPath(startAngle, endAngle, radius)}
          fill="none"
          stroke="hsl(220 13% 91%)"
          strokeWidth={strokeW}
          strokeLinecap="round"
        />

        {/* zona ok (verde) */}
        {angOkEnd > angOkStart && (
          <path
            d={arcPath(angOkStart, angOkEnd, radius)}
            fill="none"
            stroke="hsl(142 71% 45%)"
            strokeWidth={strokeW}
            strokeLinecap="round"
          />
        )}
        {/* zona warn (amarelo) */}
        {angWarnEnd > angOkEnd && (
          <path
            d={arcPath(angOkEnd, angWarnEnd, radius)}
            fill="none"
            stroke="hsl(38 92% 50%)"
            strokeWidth={strokeW}
            strokeLinecap="butt"
          />
        )}
        {/* zona alert (vermelho) */}
        {angAlertEnd > angWarnEnd && (
          <path
            d={arcPath(angWarnEnd, angAlertEnd, radius)}
            fill="none"
            stroke="hsl(0 84% 55%)"
            strokeWidth={strokeW}
            strokeLinecap="round"
          />
        )}

        {/* Tick do limite */}
        <line
          x1={limitInner.x}
          y1={limitInner.y}
          x2={limitOuter.x}
          y2={limitOuter.y}
          stroke="hsl(0 84% 35%)"
          strokeWidth={3}
          strokeLinecap="round"
        />

        {/* Agulha: linha do centro até a ponta + base + tampa */}
        {needleAngle != null && needleTip != null && (
          <>
            <line
              x1={cx}
              y1={cy}
              x2={needleTip.x}
              y2={needleTip.y}
              stroke={
                valueIsAlarm
                  ? 'hsl(0 84% 45%)'
                  : valueIsWarn
                    ? 'hsl(38 92% 45%)'
                    : 'hsl(220 14% 25%)'
              }
              strokeWidth={3}
              strokeLinecap="round"
            />
            <circle cx={cx} cy={cy} r={6} fill="hsl(220 14% 25%)" />
            <circle cx={cx} cy={cy} r={2.5} fill="white" />
          </>
        )}

        {/* Display digital — ABAIXO do baseline do semicírculo */}
        <g>
          <text
            x={cx}
            y={cy + digitalH * 0.62}
            textAnchor="middle"
            className={cn(
              'font-mono font-bold',
              valueIsAlarm
                ? 'fill-red-600'
                : valueIsWarn
                  ? 'fill-amber-600'
                  : 'fill-foreground',
            )}
            style={{ fontSize: size * 0.22 }}
          >
            {valueC != null ? valueC.toFixed(1) : '—'}
          </text>
          <text
            x={cx}
            y={cy + digitalH * 0.92}
            textAnchor="middle"
            className="fill-muted-foreground font-medium"
            style={{ fontSize: size * 0.08, letterSpacing: '0.15em' }}
          >
            °C
          </text>
        </g>
      </svg>

      {showScale && (
        <div
          className="flex items-center justify-between text-[10px] text-muted-foreground -mt-1 font-mono"
          style={{ width: size * 0.88 }}
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
