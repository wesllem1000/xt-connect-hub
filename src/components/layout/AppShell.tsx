import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Menu } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useInboxPendingCount } from '@/hooks/useInboxPendingCount'

import { Sidebar } from './Sidebar'

export function AppShell() {
  const [navOpen, setNavOpen] = useState(false)
  const location = useLocation()
  const invitesCount = useInboxPendingCount()

  // Fecha drawer ao navegar (melhora UX mobile)
  useEffect(() => {
    setNavOpen(false)
  }, [location.pathname])

  // ESC fecha drawer
  useEffect(() => {
    if (!navOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setNavOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navOpen])

  // Lock body scroll while drawer open
  useEffect(() => {
    if (!navOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [navOpen])

  return (
    <div className="min-h-screen md:flex bg-muted/30">
      {/* Mobile topbar */}
      <header
        className="md:hidden fixed top-0 inset-x-0 h-14 bg-white border-b z-30 flex items-center gap-2 px-3"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setNavOpen(true)}
          aria-label="Abrir menu"
          aria-expanded={navOpen}
          className="relative"
        >
          <Menu className="h-5 w-5" />
          {invitesCount > 0 && (
            <span
              className="absolute top-1 right-1 h-2 w-2 rounded-full bg-primary"
              aria-hidden
            />
          )}
        </Button>
        <h1 className="font-bold text-primary text-base">XT Conect Hub</h1>
      </header>

      {/* Mobile overlay */}
      {navOpen && (
        <button
          type="button"
          aria-label="Fechar menu"
          className="md:hidden fixed inset-0 bg-black/50 z-40"
          onClick={() => setNavOpen(false)}
        />
      )}

      <Sidebar
        mobileOpen={navOpen}
        onCloseMobile={() => setNavOpen(false)}
      />

      <main
        className="flex-1 min-w-0 p-4 md:p-8 pt-[calc(3.5rem+env(safe-area-inset-top))] md:pt-8"
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
      >
        <Outlet />
      </main>
    </div>
  )
}
