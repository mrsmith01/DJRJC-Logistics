import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { inviteDriver, addTruck } from './actions'
import { Button, Card, Input, Label, PageHeader } from '@/components/ui'

export default async function DriversPage() {
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
    .select('id, name, email, role')
    .order('name')

  const { data: trucks } = await supabase
    .from('trucks')
    .select('id, unit_number, plate')
    .order('unit_number')

  return (
    <div>
      <PageHeader title="Drivers & Trucks" description="Invite drivers and manage your fleet." />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-4 font-semibold text-slate-900">Drivers</h2>
          <ul className="mb-5 divide-y divide-slate-100">
            {drivers?.map((d) => (
              <li key={d.id} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <p className="font-medium text-slate-900">{d.name}</p>
                  <p className="text-slate-500">{d.email}</p>
                </div>
                <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium capitalize text-slate-700">
                  {d.role}
                </span>
              </li>
            ))}
            {drivers?.length === 0 && (
              <li className="py-2 text-sm text-slate-500">No drivers yet.</li>
            )}
          </ul>
          <form action={inviteDriver} className="space-y-3 border-t border-slate-100 pt-4">
            <div>
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" placeholder="Jane Smith" required />
            </div>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" placeholder="jane@example.com" required />
            </div>
            <Button type="submit">Invite driver</Button>
          </form>
        </Card>

        <Card className="p-5">
          <h2 className="mb-4 font-semibold text-slate-900">Trucks</h2>
          <ul className="mb-5 divide-y divide-slate-100">
            {trucks?.map((t) => (
              <li key={t.id} className="py-2 text-sm text-slate-900">
                {t.unit_number} {t.plate ? <span className="text-slate-500">({t.plate})</span> : null}
              </li>
            ))}
            {trucks?.length === 0 && (
              <li className="py-2 text-sm text-slate-500">No trucks yet.</li>
            )}
          </ul>
          <form action={addTruck} className="space-y-3 border-t border-slate-100 pt-4">
            <div>
              <Label htmlFor="unit_number">Unit number</Label>
              <Input id="unit_number" name="unit_number" placeholder="T-101" required />
            </div>
            <div>
              <Label htmlFor="plate">Plate (optional)</Label>
              <Input id="plate" name="plate" placeholder="ABC-1234" />
            </div>
            <Button type="submit">Add truck</Button>
          </form>
        </Card>
      </div>
    </div>
  )
}
