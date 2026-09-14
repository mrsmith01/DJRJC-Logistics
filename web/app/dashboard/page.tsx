import { createClient } from '@/lib/supabase/server'
import { Card, StatusBadge } from '@/components/ui'

export default async function DashboardHomePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data: profile } = user
    ? await supabase.from('profiles').select('name, role').eq('id', user.id).single()
    : { data: null }

  const isOwner = profile?.role === 'owner'

  const { data: myLoads, error: myLoadsError } =
    user && !isOwner
      ? await supabase
          .from('loads')
          .select(
            'id, external_load_id, status, pickup_facility_code, pickup_datetime, delivery_facility_code, delivery_datetime, rate_total'
          )
          .eq('driver_id', user.id)
          .order('pickup_datetime', { ascending: false, nullsFirst: false })
      : { data: null, error: null }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
        Welcome back{profile?.name ? `, ${profile.name}` : ''}
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        {isOwner ? "Here's your dispatch overview." : 'Here are your assigned loads.'}
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

      {!isOwner && (
        <div className="mt-6">
          <Card className="p-5">
            {myLoadsError && (
              <p className="mb-4 text-sm text-rose-600">
                Could not load your loads: {myLoadsError.message}
              </p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs font-medium uppercase tracking-wide text-slate-500">
                    <th className="py-2 pr-4">Load ID</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Pickup</th>
                    <th className="py-2 pr-4">Delivery</th>
                    <th className="py-2 text-right">Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {myLoads?.map((l) => (
                    <tr key={l.id}>
                      <td className="py-2.5 pr-4 font-medium text-slate-900">
                        {l.external_load_id ?? '—'}
                      </td>
                      <td className="py-2.5 pr-4">
                        <StatusBadge status={l.status} />
                      </td>
                      <td className="py-2.5 pr-4 text-slate-600">
                        {l.pickup_facility_code}
                        {l.pickup_datetime && (
                          <span className="block text-xs text-slate-400">
                            {new Date(l.pickup_datetime).toLocaleString()}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 pr-4 text-slate-600">
                        {l.delivery_facility_code}
                        {l.delivery_datetime && (
                          <span className="block text-xs text-slate-400">
                            {new Date(l.delivery_datetime).toLocaleString()}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 text-right text-slate-900">
                        {l.rate_total != null ? `$${Number(l.rate_total).toFixed(2)}` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!myLoadsError && myLoads?.length === 0 && (
                <p className="py-8 text-center text-sm text-slate-500">No loads assigned yet.</p>
              )}
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
