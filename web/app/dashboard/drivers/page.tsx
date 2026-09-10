import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { inviteDriver, addTruck } from './actions'

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
      <h1>Drivers &amp; Trucks</h1>

      <section style={{ marginBottom: '2rem' }}>
        <h2>Drivers</h2>
        <ul>
          {drivers?.map((d) => (
            <li key={d.id}>
              {d.name} ({d.email}) — {d.role}
            </li>
          ))}
        </ul>
        <form action={inviteDriver}>
          <input name="name" placeholder="Name" required />
          <input name="email" type="email" placeholder="Email" required />
          <button type="submit">Invite driver</button>
        </form>
      </section>

      <section>
        <h2>Trucks</h2>
        <ul>
          {trucks?.map((t) => (
            <li key={t.id}>
              {t.unit_number} {t.plate ? `(${t.plate})` : ''}
            </li>
          ))}
        </ul>
        <form action={addTruck}>
          <input name="unit_number" placeholder="Unit number" required />
          <input name="plate" placeholder="Plate (optional)" />
          <button type="submit">Add truck</button>
        </form>
      </section>
    </div>
  )
}
