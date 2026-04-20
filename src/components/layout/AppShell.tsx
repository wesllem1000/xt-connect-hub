import { Outlet } from 'react-router-dom'

import { Sidebar } from './Sidebar'

export function AppShell() {
  return (
    <div className="min-h-screen flex bg-muted/30">
      <Sidebar />
      <main className="flex-1 overflow-auto p-8">
        <Outlet />
      </main>
    </div>
  )
}
