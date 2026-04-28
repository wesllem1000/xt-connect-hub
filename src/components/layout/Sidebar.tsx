import { NavLink, useNavigate } from 'react-router-dom'
import { Cpu, LogOut, Mail, Package, Settings, X } from 'lucide-react'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { useInboxPendingCount } from '@/hooks/useInboxPendingCount'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth'

type NavItem = {
  to: string
  label: string
  icon: typeof Cpu
  adminOnly?: boolean
  badgeKey?: 'invites'
}

const NAV_ITEMS: NavItem[] = [
  { to: '/dispositivos', label: 'Dispositivos', icon: Cpu },
  { to: '/convites', label: 'Convites', icon: Mail, badgeKey: 'invites' },
  { to: '/admin/produtos', label: 'Produtos', icon: Package, adminOnly: true },
  { to: '/admin', label: 'Admin', icon: Settings, adminOnly: true },
]

function getInitials(name: string | null, email: string): string {
  const source = (name && name.trim()) || email
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

type SidebarProps = {
  mobileOpen?: boolean
  onCloseMobile?: () => void
}

export function Sidebar({ mobileOpen = false, onCloseMobile }: SidebarProps) {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const clearSession = useAuthStore((s) => s.clearSession)
  const invitesCount = useInboxPendingCount()

  const items = NAV_ITEMS.filter((i) => !i.adminOnly || user?.role === 'admin')

  function handleLogout() {
    clearSession()
    navigate('/login', { replace: true })
  }

  return (
    <aside
      aria-label="Navegação principal"
      aria-hidden={!mobileOpen ? undefined : false}
      className={cn(
        // Desktop: sticky no topo, altura da viewport (não rola junto com main)
        'md:sticky md:top-0 md:h-screen md:translate-x-0 md:flex md:w-64 md:shrink-0',
        // Mobile: drawer slide-in; z acima do overlay (40); transições suaves
        'fixed inset-y-0 left-0 z-50 w-[17rem] max-w-[85%] bg-white border-r shadow-xl md:shadow-none',
        'flex flex-col transition-transform duration-200 ease-out',
        mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
      )}
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div className="flex items-center justify-between px-5 py-4 md:py-5">
        <h1 className="font-bold text-xl text-primary">XT Conect Hub</h1>
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden h-9 w-9"
          onClick={onCloseMobile}
          aria-label="Fechar menu"
        >
          <X className="h-5 w-5" />
        </Button>
      </div>
      <Separator />
      <nav className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-1">
        {items.map(({ to, label, icon: Icon, badgeKey }) => {
          const count = badgeKey === 'invites' ? invitesCount : 0
          return (
            <NavLink
              key={to}
              to={to}
              onClick={onCloseMobile}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-md px-3 py-2.5 text-sm min-h-[44px] transition-colors',
                  isActive
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )
              }
            >
              <Icon className="h-4 w-4" />
              <span className="flex-1">{label}</span>
              {count > 0 && (
                <Badge
                  className="h-5 min-w-[1.25rem] px-1.5 justify-center bg-primary hover:bg-primary text-primary-foreground text-xs"
                  aria-label={`${count} pendente${count === 1 ? '' : 's'}`}
                >
                  {count > 99 ? '99+' : count}
                </Badge>
              )}
            </NavLink>
          )
        })}
      </nav>
      <Separator />
      {user && (
        <div
          className="px-4 py-4 flex items-center gap-3"
          style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
        >
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
            className="h-10 w-10"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      )}
    </aside>
  )
}
