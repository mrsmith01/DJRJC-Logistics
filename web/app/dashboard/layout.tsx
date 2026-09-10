import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { signOut } from '../login/actions'

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

  return (
    <div style={{ fontFamily: 'sans-serif' }}>
      <header
        style={{
          padding: '1rem 2rem',
          borderBottom: '1px solid #ddd',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <strong>DJRJC Logistics</strong>
        <span>
          {profile?.name ?? user.email} ({profile?.role ?? 'unknown'}){' '}
          <form action={signOut} style={{ display: 'inline' }}>
            <button type="submit">Sign out</button>
          </form>
        </span>
      </header>
      <main style={{ padding: '2rem' }}>{children}</main>
    </div>
  )
}
