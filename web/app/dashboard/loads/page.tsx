import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { LoadsImportForm } from './loads-import-form'

type SearchParams = {
  driver?: string
  status?: string
  from?: string
  to?: string
}

export default async function LoadsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const { driver, status, from, to } = await searchParams

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
  if (status) {
    query = query.eq('status', status)
  }
  if (from) {
    query = query.gte('pickup_datetime', from)
  }
  if (to) {
    query = query.lte('pickup_datetime', to)
  }

  const { data: loads } = await query

  return (
    <div>
      <h1>Loads</h1>

      <LoadsImportForm />

      <form style={{ margin: '1rem 0', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <select name="driver" defaultValue={driver ?? ''}>
          <option value="">All drivers</option>
          {drivers?.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <select name="status" defaultValue={status ?? ''}>
          <option value="">All statuses</option>
          <option value="booked">Booked</option>
          <option value="in_transit">In transit</option>
          <option value="delivered">Delivered</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <input type="date" name="from" defaultValue={from ?? ''} />
        <input type="date" name="to" defaultValue={to ?? ''} />
        <button type="submit">Filter</button>
      </form>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>Load ID</th>
            <th style={{ textAlign: 'left' }}>Status</th>
            <th style={{ textAlign: 'left' }}>Pickup</th>
            <th style={{ textAlign: 'left' }}>Delivery</th>
            <th style={{ textAlign: 'left' }}>Driver</th>
            <th style={{ textAlign: 'right' }}>Rate</th>
            <th style={{ textAlign: 'right' }}>$/mi</th>
          </tr>
        </thead>
        <tbody>
          {loads?.map((l) => (
            <tr key={l.id}>
              <td>{l.external_load_id}</td>
              <td>{l.status}</td>
              <td>
                {l.pickup_facility_code}
                {l.pickup_datetime ? ` — ${new Date(l.pickup_datetime).toLocaleString()}` : ''}
              </td>
              <td>
                {l.delivery_facility_code}
                {l.delivery_datetime ? ` — ${new Date(l.delivery_datetime).toLocaleString()}` : ''}
              </td>
              <td>
                {l.assigned_driver_name}
                {!l.driver_id ? ' (needs review)' : ''}
              </td>
              <td style={{ textAlign: 'right' }}>
                {l.rate_total != null ? `$${Number(l.rate_total).toFixed(2)}` : ''}
              </td>
              <td style={{ textAlign: 'right' }}>
                {l.rate_per_mile != null ? `$${Number(l.rate_per_mile).toFixed(2)}` : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
