import { Cloud, CloudOff, Cpu, Radio, Wifi, WifiOff, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'

type Indicator = {
  ok: boolean
  label: string
  IconOn: typeof Cpu
  IconOff: typeof Cpu
}

type Props = {
  servidor: boolean
  dispositivoOnline: boolean
  mqtt: boolean
  wifiDevice: boolean
  horaSincronizada: boolean
}

export function IndicadoresStatusBar({
  servidor, dispositivoOnline, mqtt, wifiDevice, horaSincronizada,
}: Props) {
  const items: Indicator[] = [
    { ok: servidor,           label: 'Servidor',     IconOn: Cloud,   IconOff: CloudOff },
    { ok: dispositivoOnline,  label: 'Dispositivo',  IconOn: Cpu,     IconOff: Cpu },
    { ok: mqtt,               label: 'MQTT',         IconOn: Radio,   IconOff: Radio },
    { ok: wifiDevice,         label: 'Wi-Fi device', IconOn: Wifi,    IconOff: WifiOff },
    { ok: horaSincronizada,   label: 'Hora',         IconOn: Clock,   IconOff: Clock },
  ]

  return (
    <div className="flex flex-wrap gap-2">
      {items.map(({ ok, label, IconOn, IconOff }) => {
        const Icon = ok ? IconOn : IconOff
        return (
          <div
            key={label}
            className={cn(
              'flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs',
              ok
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-muted text-muted-foreground',
            )}
            title={`${label}: ${ok ? 'OK' : 'sem contato'}`}
          >
            <Icon className="h-3 w-3" />
            <span>{label}</span>
            <span className={cn(
              'h-1.5 w-1.5 rounded-full',
              ok ? 'bg-emerald-500' : 'bg-muted-foreground/40',
            )} aria-hidden />
          </div>
        )
      })}
    </div>
  )
}
