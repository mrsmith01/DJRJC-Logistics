import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createLoad } from '../actions'
import { Button, Input, Label, PageHeader, Select } from '@/components/ui'

export default async function NewLoadPage() {
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

  return (
    <div>
      <PageHeader title="Add a Load" description="Manually create a load record." />

      <form
        action={createLoad}
        className="max-w-2xl space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="external_load_id">Load ID (optional)</Label>
            <Input id="external_load_id" name="external_load_id" placeholder="e.g. 114JK3HVB" />
          </div>
          <div>
            <Label htmlFor="status">Status</Label>
            <Select id="status" name="status" defaultValue="booked" className="w-full">
              <option value="booked">Booked</option>
              <option value="in_transit">In transit</option>
              <option value="delivered">Delivered</option>
              <option value="cancelled">Cancelled</option>
            </Select>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="pickup_facility_code">Pickup facility</Label>
            <Input
              id="pickup_facility_code"
              name="pickup_facility_code"
              placeholder="e.g. MQJ5"
              required
            />
          </div>
          <div>
            <Label htmlFor="pickup_datetime">Pickup date/time</Label>
            <Input id="pickup_datetime" name="pickup_datetime" type="datetime-local" />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="delivery_facility_code">Delivery facility</Label>
            <Input
              id="delivery_facility_code"
              name="delivery_facility_code"
              placeholder="e.g. DIN4"
              required
            />
          </div>
          <div>
            <Label htmlFor="delivery_datetime">Delivery date/time</Label>
            <Input id="delivery_datetime" name="delivery_datetime" type="datetime-local" />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="distance_miles">Distance (miles)</Label>
            <Input id="distance_miles" name="distance_miles" type="number" step="0.1" min="0" />
          </div>
          <div>
            <Label htmlFor="rate_total">Rate ($)</Label>
            <Input id="rate_total" name="rate_total" type="number" step="0.01" min="0" />
          </div>
          <div>
            <Label htmlFor="driver_id">Driver (optional)</Label>
            <Select id="driver_id" name="driver_id" defaultValue="" className="w-full">
              <option value="">Unassigned</option>
              {drivers?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <Button type="submit">Create load</Button>
      </form>
    </div>
  )
}
