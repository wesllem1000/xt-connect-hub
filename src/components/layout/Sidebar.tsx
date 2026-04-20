import { NavLink, useNavigate } from 'react-router-dom'
import { Cpu, LogOut, Settings } from 'lucide-react'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth'

type NavItem = {
  to: string
  label: string
  icon: typeof Cpu
  adminOnly?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { to: '/dispositivos', label: 'Dispositivos', icon: Cpu },
  { to: '/admin', label: 'Admin', icon: Settings, adminOnly: true },
]

function getInitials(name: string | null, email: string): string {
  const source = (name && name.trim()) || email
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function Sidebar() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const clearSession = useAuthStore((s) => s.clearSession)

  const items = NAV_ITEMS.filter((i) => !i.adminOnly || user?.role === 'admin')

  function handleLogout() {
    clearSession()
    navigate('/login', { replace: true })
  }

  return (
    <aside className="w-64 border-r bg-white flex flex-col shrink-0">
      <div className="px-6 py-5">
        <h1 className="font-bold text-xl text-primary">XT Conect Hub</h1>
      </div>
      <Separator />
      <nav className="flex-1 px-3 py-4 flex flex-col gap-1">
        {items.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                isActive
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )
            }
          >
            <Icon className="h-4 w-4" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
      <Separator />
      {user && (
        <div className="px-4 py-4 flex items-center gap-3">
          <Avatar className="h-9 w-9">
            <AvatarFallback className="bg-primary/10 text-primary text-xs font-medium">
              {getInitials(user.name, user.email)}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{user.name ?? user.email}</p>
            <p className="text-xs text-muted-foreground truncate">{user.email}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleLogout}
            aria-label="Sair"
            title="Sair"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      )}
    </aside>
  )
}
