import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service-client'
import {
  addTruck,
  assignTruckDriver,
  createDriverWithPassword,
  deleteUser,
  inviteDriver,
  resendInvite,
  setUserActive,
  setUserPassword,
  updateUserProfile,
} from './actions'
import { Button, Card, Input, Label, PageHeader, Select } from '@/components/ui'
import { ConfirmSubmitButton } from '@/components/confirm-submit-button'

type AuthStatus = {
  confirmed: boolean
  deactivated: boolean
}

export default async function AdminPage() {
  const supabase = await createClient()

  const {
    data: { user: currentUser },
  } = await supabase.auth.getUser()

  if (!currentUser) {
    redirect('/login')
  }

  const { data: currentProfile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', currentUser.id)
    .single()

  if (currentProfile?.role !== 'owner') {
    redirect('/dashboard')
  }

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, name, email, phone, role')
    .order('name')

  const { data: trucks } = await supabase
    .from('trucks')
    .select('id, unit_number, plate, driver_id')
    .order('unit_number')

  const serviceClient = createServiceClient()
  const { data: authUsers } = await serviceClient.auth.admin.listUsers({ perPage: 200 })

  const authStatusById = new Map<string, AuthStatus>(
    (authUsers?.users ?? []).map((u) => [
      u.id,
      {
        confirmed: u.email_confirmed_at != null,
        deactivated: u.banned_until != null && new Date(u.banned_until) > new Date(),
      },
    ])
  )

  const drivers = (profiles ?? []).filter((p) => p.role === 'driver')

  return (
    <div className="space-y-6">
      <PageHeader
        title="Admin"
        description="Manage user accounts, access, and your fleet."
      />

      <Card className="p-5">
        <h2 className="mb-4 font-semibold text-slate-900">Add a driver</h2>
        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-medium text-slate-700">Invite by email</h3>
            <form action={inviteDriver} className="space-y-3">
              <div>
                <Label htmlFor="invite-name">Name</Label>
                <Input id="invite-name" name="name" placeholder="Jane Smith" required />
              </div>
              <div>
                <Label htmlFor="invite-email">Email</Label>
                <Input
                  id="invite-email"
                  name="email"
                  type="email"
                  placeholder="jane@example.com"
                  required
                />
              </div>
              <Button type="submit">Send invite</Button>
            </form>
          </div>
          <div>
            <h3 className="mb-2 text-sm font-medium text-slate-700">
              Create with password
              <span className="ml-1.5 font-normal text-slate-500">
                (works even if email delivery is down)
              </span>
            </h3>
            <form action={createDriverWithPassword} className="space-y-3">
              <div>
                <Label htmlFor="create-name">Name</Label>
                <Input id="create-name" name="name" placeholder="Jane Smith" required />
              </div>
              <div>
                <Label htmlFor="create-email">Email</Label>
                <Input
                  id="create-email"
                  name="email"
                  type="email"
                  placeholder="jane@example.com"
                  required
                />
              </div>
              <div>
                <Label htmlFor="create-password">Initial password</Label>
                <Input
                  id="create-password"
                  name="password"
                  type="password"
                  minLength={8}
                  required
                />
              </div>
              <Button type="submit" variant="secondary">
                Create driver
              </Button>
            </form>
          </div>
        </div>
      </Card>

      <div>
        <h2 className="mb-3 font-semibold text-slate-900">Users</h2>
        <div className="space-y-4">
          {profiles?.map((p) => {
            const status = authStatusById.get(p.id)
            const isSelf = p.id === currentUser.id

            return (
              <Card key={p.id} className="p-5">
                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <span className="font-medium text-slate-900">{p.name}</span>
                  <span className="text-sm text-slate-500">{p.email}</span>
                  {status?.deactivated && (
                    <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-medium text-rose-700">
                      deactivated
                    </span>
                  )}
                  {status && !status.confirmed && (
                    <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                      invite pending
                    </span>
                  )}
                  {isSelf && (
                    <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
                      you
                    </span>
                  )}
                </div>

                <div className="grid gap-6 lg:grid-cols-3">
                  <form action={updateUserProfile} className="space-y-3 lg:col-span-1">
                    <input type="hidden" name="user_id" value={p.id} />
                    <div>
                      <Label htmlFor={`name-${p.id}`}>Name</Label>
                      <Input id={`name-${p.id}`} name="name" defaultValue={p.name} required />
                    </div>
                    <div>
                      <Label htmlFor={`phone-${p.id}`}>Phone</Label>
                      <Input id={`phone-${p.id}`} name="phone" defaultValue={p.phone ?? ''} />
                    </div>
                    <div>
                      <Label htmlFor={`role-${p.id}`}>Role</Label>
                      <Select
                        id={`role-${p.id}`}
                        name="role"
                        defaultValue={p.role}
                        disabled={isSelf}
                        className="w-full"
                      >
                        <option value="owner">Owner</option>
                        <option value="driver">Driver</option>
                      </Select>
                    </div>
                    <Button type="submit" variant="secondary">
                      Save changes
                    </Button>
                  </form>

                  <form action={setUserPassword} className="space-y-3 lg:col-span-1">
                    <input type="hidden" name="user_id" value={p.id} />
                    <Label htmlFor={`password-${p.id}`}>Set password</Label>
                    <Input
                      id={`password-${p.id}`}
                      name="password"
                      type="password"
                      minLength={8}
                      placeholder="New password"
                      required
                    />
                    <Button type="submit" variant="secondary">
                      Set password
                    </Button>
                  </form>

                  <div className="flex flex-col justify-between gap-3 lg:col-span-1">
                    {status && !status.confirmed && (
                      <form action={resendInvite}>
                        <input type="hidden" name="email" value={p.email} />
                        <Button type="submit" variant="secondary" className="w-full">
                          Resend invite email
                        </Button>
                      </form>
                    )}

                    {!isSelf && (
                      <form action={setUserActive}>
                        <input type="hidden" name="user_id" value={p.id} />
                        <input
                          type="hidden"
                          name="active"
                          value={status?.deactivated ? 'true' : 'false'}
                        />
                        {status?.deactivated ? (
                          <Button type="submit" variant="secondary" className="w-full">
                            Reactivate
                          </Button>
                        ) : (
                          <ConfirmSubmitButton
                            confirmMessage={`Deactivate ${p.name}? They will no longer be able to sign in.`}
                            className="w-full"
                          >
                            Deactivate
                          </ConfirmSubmitButton>
                        )}
                      </form>
                    )}

                    {!isSelf && (
                      <form action={deleteUser}>
                        <input type="hidden" name="user_id" value={p.id} />
                        <ConfirmSubmitButton
                          confirmMessage={`Permanently remove ${p.name}? This cannot be undone.`}
                          className="w-full border-rose-200 text-rose-700 hover:bg-rose-50"
                        >
                          Remove
                        </ConfirmSubmitButton>
                      </form>
                    )}
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      </div>

      <Card className="p-5">
        <h2 className="mb-4 font-semibold text-slate-900">Trucks</h2>
        <div className="mb-5 space-y-3 divide-y divide-slate-100">
          {trucks?.map((t) => (
            <div key={t.id} className="flex flex-wrap items-center justify-between gap-3 pt-3 first:pt-0">
              <div className="text-sm text-slate-900">
                {t.unit_number} {t.plate ? <span className="text-slate-500">({t.plate})</span> : null}
              </div>
              <form action={assignTruckDriver} className="flex items-center gap-2">
                <input type="hidden" name="truck_id" value={t.id} />
                <Select name="driver_id" defaultValue={t.driver_id ?? ''}>
                  <option value="">Unassigned</option>
                  {drivers.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
                <Button type="submit" variant="secondary">
                  Assign
                </Button>
              </form>
            </div>
          ))}
          {trucks?.length === 0 && <p className="pt-3 text-sm text-slate-500">No trucks yet.</p>}
        </div>
        <form action={addTruck} className="flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4">
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
  )
}
