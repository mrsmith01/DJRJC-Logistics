import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui'

export default async function DashboardHomePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data: profile } = user
    ? await supabase.from('profiles').select('name, role').eq('id', user.id).single()
    : { data: null }

  const isOwner = profile?.role === 'owner'

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
        Welcome back{profile?.name ? `, ${profile.name}` : ''}
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        {isOwner ? "Here's your dispatch overview." : 'Your account is set up.'}
      </p>

      {isOwner && (
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <a href="/dashboard/loads">
            <Card className="p-5 transition-shadow hover:shadow-md">
              <h2 className="font-semibold text-slate-900">Loads</h2>
              <p className="mt-1 text-sm text-slate-500">
                View loads, filter by driver or status, and import Amazon Relay trip history.
              </p>
            </Card>
          </a>
          <a href="/dashboard/admin">
            <Card className="p-5 transition-shadow hover:shadow-md">
              <h2 className="font-semibold text-slate-900">Admin</h2>
              <p className="mt-1 text-sm text-slate-500">
                Manage users, access, drivers, and your truck fleet.
              </p>
            </Card>
          </a>
        </div>
      )}
    </div>
  )
}
