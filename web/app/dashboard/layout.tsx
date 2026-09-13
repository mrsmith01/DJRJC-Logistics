import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { signOut } from '../login/actions'
import { Button } from '@/components/ui'

const navItems = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/dashboard/loads', label: 'Loads' },
  { href: '/dashboard/drivers', label: 'Drivers & Trucks' },
]

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('name, role')
    .eq('id', user.id)
    .single()

  const isOwner = profile?.role === 'owner'
  const visibleNavItems = isOwner ? navItems : navItems.slice(0, 1)

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-slate-900 px-4 py-6 text-slate-200 md:flex">
        <div className="mb-8 flex items-center gap-2 px-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-sm font-bold text-slate-900">
            D
          </div>
          <span className="text-sm font-semibold text-white">DJRJC Logistics</span>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {visibleNavItems.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="rounded-lg px-3 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
            >
              {item.label}
            </a>
          ))}
        </nav>
      </aside>

      <div className="flex min-h-screen flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
          <span className="text-sm font-semibold text-slate-900 md:hidden">DJRJC Logistics</span>
          <div className="ml-auto flex items-center gap-3">
            <div className="text-right">
              <p className="text-sm font-medium text-slate-900">{profile?.name ?? user.email}</p>
              <p className="text-xs capitalize text-slate-500">{profile?.role ?? 'unknown'}</p>
            </div>
            <form action={signOut}>
              <Button type="submit" variant="secondary" className="px-3 py-1.5 text-xs">
                Sign out
              </Button>
            </form>
          </div>
        </header>
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  )
}
