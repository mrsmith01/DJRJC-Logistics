import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { LoadsImportForm } from './loads-import-form'
import { Button, Card, Input, PageHeader, Select, StatusBadge } from '@/components/ui'

type SearchParams = {
  driver?: string
  status?: string
  from?: string
  to?: string
}

const VALID_STATUSES = ['booked', 'in_transit', 'delivered', 'cancelled']

export default async function LoadsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const { driver, status, from, to } = await searchParams
  const validStatus = status && VALID_STATUSES.includes(status) ? status : undefined

  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'owner') {
    redirect('/dashboard')
  }

  const { data: drivers } = await supabase
    .from('profiles')
    .select('id, name')
    .eq('role', 'driver')
    .order('name')

  let query = supabase
    .from('loads')
    .select(
      'id, external_load_id, status, pickup_facility_code, pickup_datetime, delivery_facility_code, delivery_datetime, rate_total, rate_per_mile, assigned_driver_name, driver_id'
    )
    .order('pickup_datetime', { ascending: false, nullsFirst: false })

  if (driver) {
    query = query.eq('driver_id', driver)
  }
  if (validStatus) {
    query = query.eq('status', validStatus)
  }
  if (from) {
    query = query.gte('pickup_datetime', from)
  }
  if (to) {
    query = query.lte('pickup_datetime', to)
  }

  const { data: loads, error: loadsError } = await query

  return (
    <div>
      <PageHeader
        title="Loads"
        description="Import Amazon Relay trip history and track dispatch."
        action={
          <a href="/dashboard/loads/new">
            <Button type="button">Add a Load</Button>
          </a>
        }
      />

      <div className="mb-6">
        <LoadsImportForm />
      </div>

      <Card className="p-5">
        <form className="mb-5 flex flex-wrap items-end gap-3 border-b border-slate-100 pb-5">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-500">Driver</label>
            <Select name="driver" defaultValue={driver ?? ''}>
              <option value="">All drivers</option>
              {drivers?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-500">Status</label>
            <Select name="status" defaultValue={validStatus ?? ''}>
              <option value="">All statuses</option>
              <option value="booked">Booked</option>
              <option value="in_transit">In transit</option>
              <option value="delivered">Delivered</option>
              <option value="cancelled">Cancelled</option>
            </Select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-500">From</label>
            <Input type="date" name="from" defaultValue={from ?? ''} className="w-40" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-500">To</label>
            <Input type="date" name="to" defaultValue={to ?? ''} className="w-40" />
          </div>
          <Button type="submit" variant="secondary">
            Filter
          </Button>
        </form>

        {loadsError && (
          <p className="mb-4 text-sm text-rose-600">Could not load results: {loadsError.message}</p>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-medium uppercase tracking-wide text-slate-500">
                <th className="py-2 pr-4">Load ID</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Pickup</th>
                <th className="py-2 pr-4">Delivery</th>
                <th className="py-2 pr-4">Driver</th>
                <th className="py-2 pr-4 text-right">Rate</th>
                <th className="py-2 text-right">$/mi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loads?.map((l) => (
                <tr key={l.id} className="hover:bg-slate-50">
                  <td className="py-2.5 pr-4 font-medium text-slate-900">{l.external_load_id ?? '—'}</td>
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
                  <td className="py-2.5 pr-4 text-slate-600">
                    {l.assigned_driver_name}
                    {!l.driver_id && (
                      <span className="ml-1.5 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                        needs review
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 pr-4 text-right text-slate-900">
                    {l.rate_total != null ? `$${Number(l.rate_total).toFixed(2)}` : '—'}
                  </td>
                  <td className="py-2.5 text-right text-slate-900">
                    {l.rate_per_mile != null ? `$${Number(l.rate_per_mile).toFixed(2)}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {loads?.length === 0 && (
            <p className="py-8 text-center text-sm text-slate-500">
              No loads yet. Import a Relay trip history CSV to get started.
            </p>
          )}
        </div>
      </Card>
    </div>
  )
}
