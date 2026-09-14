# Add a Load & Driver Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner manually create a load (not just via CSV import) from a new "Add a Load" page, and give each driver their own read-only view of their assigned loads on the dashboard home page — both sorted most-recent-first.

**Architecture:** A new Server Action (`createLoad`) alongside the existing `importLoads` in `web/app/dashboard/loads/actions.ts`, backing a new owner-only page at `/dashboard/loads/new`. The driver-facing view extends the existing `/dashboard` home page's already-role-branching logic — no new route — querying `loads` filtered to `driver_id = auth.uid()`; RLS (`loads_select_own_or_owner`, unchanged) is the actual access boundary, the query filter is just efficiency, matching this app's established "RLS is the real access boundary, not client logic" principle.

**Tech Stack:** Next.js App Router (existing `web/` app), existing `@supabase/ssr` clients, existing `web/components/ui.tsx` kit.

**Spec:** No separate spec doc — this is a small, two-part addition to the already-shipped Loads feature (`docs/superpowers/specs/2026-09-13-loads-amazon-relay-import-design.md`), filling a gap that spec explicitly called out as out of scope at the time ("No manual load creation/editing UI").

## Global Constraints

- `loads` schema (post-trim, current production shape): `id, driver_id, external_load_id, status, pickup_facility_code, pickup_datetime, delivery_facility_code, delivery_datetime, distance_miles, rate_total, rate_per_mile, assigned_driver_name, created_at`. No other columns exist — do not reference `truck_id`, `equipment_type`, `rate_type`, `notes`, or `source` (all dropped in an earlier migration).
- `rate_per_mile` is always computed server-side (`rate_total / distance_miles` when both present and `distance_miles > 0`, else `null`) — never a user-entered field. This matches the CSV import path's existing behavior in `web/app/dashboard/loads/csv-mapping.ts`.
- Sort order for both the new driver view and the (already-correct) admin Loads table: `pickup_datetime` descending, nulls last — i.e. `.order('pickup_datetime', { ascending: false, nullsFirst: false })`.
- `status` is one of exactly `'booked' | 'in_transit' | 'delivered' | 'cancelled'` (the `load_status` enum) — validate against this exact set, never trust the raw form value.
- No pre-existing automated test suite — verification is `npm run build` per task, plus Task 3's live-database checks against real RLS policies using disposable test data (created and fully deleted within that task).
- We are working directly on `main` (established convention for this repo — every prior plan was executed this way, commit + push per task, auto-deploy to production on push).

---

### Task 1: "Add a Load" page and `createLoad` Server Action

**Files:**
- Create: `web/app/dashboard/loads/new/page.tsx`
- Modify: `web/app/dashboard/loads/actions.ts` (add `createLoad`, add `redirect` import)
- Modify: `web/app/dashboard/loads/page.tsx` (add an "Add a Load" button next to the page header)

**Interfaces:**
- Consumes: `requireOwner()` from `@/lib/supabase/require-owner`, `createClient()` from `@/lib/supabase/server`, `Button`/`Input`/`Label`/`PageHeader`/`Select` from `@/components/ui` (all already exist, exact shapes are in this task's code below — do not guess their props).
- Produces: `createLoad(formData: FormData)` — a plain (non-`useActionState`) Server Action, consumed only by this task's own form. No other task depends on its export.

- [ ] **Step 1: Add `createLoad` to `web/app/dashboard/loads/actions.ts`**

Add this import at the top (alongside the existing `revalidatePath` import from `next/cache`):

```typescript
import { redirect } from 'next/navigation'
```

Add this export anywhere in the file (e.g., after `importLoads`):

```typescript
export async function createLoad(formData: FormData) {
  const { supabase } = await requireOwner()

  const externalLoadIdRaw = formData.get('external_load_id')
  const externalLoadId =
    typeof externalLoadIdRaw === 'string' && externalLoadIdRaw.trim()
      ? externalLoadIdRaw.trim()
      : null

  const status = formData.get('status')
  if (status !== 'booked' && status !== 'in_transit' && status !== 'delivered' && status !== 'cancelled') {
    throw new Error('Invalid status')
  }

  const pickupFacilityCodeRaw = formData.get('pickup_facility_code')
  if (typeof pickupFacilityCodeRaw !== 'string' || !pickupFacilityCodeRaw.trim()) {
    throw new Error('Pickup facility is required')
  }
  const pickupFacilityCode = pickupFacilityCodeRaw.trim()

  const deliveryFacilityCodeRaw = formData.get('delivery_facility_code')
  if (typeof deliveryFacilityCodeRaw !== 'string' || !deliveryFacilityCodeRaw.trim()) {
    throw new Error('Delivery facility is required')
  }
  const deliveryFacilityCode = deliveryFacilityCodeRaw.trim()

  const pickupDatetimeRaw = formData.get('pickup_datetime')
  const pickupDatetime =
    typeof pickupDatetimeRaw === 'string' && pickupDatetimeRaw
      ? new Date(pickupDatetimeRaw).toISOString()
      : null

  const deliveryDatetimeRaw = formData.get('delivery_datetime')
  const deliveryDatetime =
    typeof deliveryDatetimeRaw === 'string' && deliveryDatetimeRaw
      ? new Date(deliveryDatetimeRaw).toISOString()
      : null

  const distanceRaw = formData.get('distance_miles')
  const distanceMiles = typeof distanceRaw === 'string' && distanceRaw ? Number(distanceRaw) : null

  const rateRaw = formData.get('rate_total')
  const rateTotal = typeof rateRaw === 'string' && rateRaw ? Number(rateRaw) : null

  const ratePerMile =
    rateTotal && distanceMiles && distanceMiles > 0 ? rateTotal / distanceMiles : null

  const driverIdRaw = formData.get('driver_id')
  const driverId = typeof driverIdRaw === 'string' && driverIdRaw ? driverIdRaw : null

  let assignedDriverName: string | null = null
  if (driverId) {
    const { data: driverProfile } = await supabase
      .from('profiles')
      .select('name')
      .eq('id', driverId)
      .single()
    assignedDriverName = driverProfile?.name ?? null
  }

  const { error } = await supabase.from('loads').insert({
    external_load_id: externalLoadId,
    status,
    pickup_facility_code: pickupFacilityCode,
    pickup_datetime: pickupDatetime,
    delivery_facility_code: deliveryFacilityCode,
    delivery_datetime: deliveryDatetime,
    distance_miles: distanceMiles,
    rate_total: rateTotal,
    rate_per_mile: ratePerMile,
    driver_id: driverId,
    assigned_driver_name: assignedDriverName,
  })

  if (error) {
    throw new Error(error.message)
  }

  redirect('/dashboard/loads')
}
```

- [ ] **Step 2: Create the page**

```tsx
// web/app/dashboard/loads/new/page.tsx
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
```

- [ ] **Step 3: Link to it from the Loads page**

In `web/app/dashboard/loads/page.tsx`, find this existing block:

```tsx
      <PageHeader title="Loads" description="Import Amazon Relay trip history and track dispatch." />
```

Replace it with:

```tsx
      <PageHeader
        title="Loads"
        description="Import Amazon Relay trip history and track dispatch."
        action={
          <a href="/dashboard/loads/new">
            <Button type="button">Add a Load</Button>
          </a>
        }
      />
```

`Button` is already imported in this file (`import { Button, Card, Input, PageHeader, Select, StatusBadge } from '@/components/ui'`) — do not add a duplicate import.

- [ ] **Step 4: Verify build**

Run: `npm run build` (from `web/`)
Expected: succeeds, `/dashboard/loads/new` present in the route list.

- [ ] **Step 5: Commit and push**

```bash
cd "/mnt/c/Users/eds.dime/Documents/Cursor/DJRJCLogistics"
git add web/app/dashboard/loads/actions.ts web/app/dashboard/loads/new web/app/dashboard/loads/page.tsx
git commit -m "Add manual Add-a-Load page and createLoad action"
git push
```

---

### Task 2: Driver dashboard — own-loads view

**Files:**
- Modify: `web/app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `Card`, `StatusBadge` from `@/components/ui` (already exist).
- Produces: nothing consumed by other tasks — this is a leaf change to a page already used by both roles.

**Why here, not a new route:** `/dashboard` already branches on `isOwner` to show different content per role (owner sees admin nav cards; driver currently sees a static "Your account is set up" line). This task replaces that static line with the driver's own loads. Because it's the same URL rendering different content per authenticated session, a driver can only ever see their own view — there is no separate URL to guard.

- [ ] **Step 1: Replace the file**

```tsx
// web/app/dashboard/page.tsx
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

  const { data: myLoads } =
    user && !isOwner
      ? await supabase
          .from('loads')
          .select(
            'id, external_load_id, status, pickup_facility_code, pickup_datetime, delivery_facility_code, delivery_datetime, rate_total'
          )
          .eq('driver_id', user.id)
          .order('pickup_datetime', { ascending: false, nullsFirst: false })
      : { data: null }

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
              {myLoads?.length === 0 && (
                <p className="py-8 text-center text-sm text-slate-500">No loads assigned yet.</p>
              )}
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build` (from `web/`)
Expected: succeeds.

- [ ] **Step 3: Commit and push**

```bash
cd "/mnt/c/Users/eds.dime/Documents/Cursor/DJRJCLogistics"
git add web/app/dashboard/page.tsx
git commit -m "Add driver-facing loads view to dashboard home"
git push
```

---

### Task 3: Verify against the live database with real RLS sessions

**Files:** none (verification only — a scratch script, run then deleted, per this repo's established convention)

**Interfaces:**
- Consumes: the live `loads` table and its RLS policies (unchanged by Tasks 1-2), the real production Supabase project.

**Why this matters:** Task 1's `createLoad` and Task 2's driver query both rely on RLS to be the actual security boundary (this app's own stated principle). Reading the code is not enough to prove RLS behaves as expected — prior work in this project has already found real bugs (a broken upsert arbiter, a delete-error-message mismatch) that only showed up under a genuine authenticated session against the live database. This task does the same here, before shipping.

- [ ] **Step 1: Write and run the verification script**

```javascript
// web/scratch-verify-load-rls.mjs — read SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY from web/.env.local before running
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFlamtydHl1ZHRlZ3hjd2djY3NyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg5ODkwNjAsImV4cCI6MjEwNDU2NTA2MH0.3U2XT4BfCoypSG2TbOyG-CunFBlDn0mRXt_AUanZg8s'

const serviceClient = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

function check(label, condition) {
  console.log(`${condition ? 'PASS' : 'FAIL'}: ${label}`)
  if (!condition) process.exitCode = 1
}

async function realSessionClient(email, password) {
  const tokenRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }).then((r) => r.json())

  if (!tokenRes.access_token) {
    throw new Error(`login failed for ${email}: ${JSON.stringify(tokenRes)}`)
  }

  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${tokenRes.access_token}` } },
  })
}

const PASSWORD = 'verify-test-password-123'

// Set up: one throwaway owner, two throwaway drivers
const { data: ownerCreated } = await serviceClient.auth.admin.createUser({
  email: 'load-verify-owner@example.com',
  password: PASSWORD,
  email_confirm: true,
})
const ownerId = ownerCreated.user.id
await serviceClient.from('profiles').update({ role: 'owner' }).eq('id', ownerId)

const { data: driverACreated } = await serviceClient.auth.admin.createUser({
  email: 'load-verify-driver-a@example.com',
  password: PASSWORD,
  email_confirm: true,
  user_metadata: { name: 'Driver A' },
})
const driverAId = driverACreated.user.id

const { data: driverBCreated } = await serviceClient.auth.admin.createUser({
  email: 'load-verify-driver-b@example.com',
  password: PASSWORD,
  email_confirm: true,
  user_metadata: { name: 'Driver B' },
})
const driverBId = driverBCreated.user.id

const ownerSession = await realSessionClient('load-verify-owner@example.com', PASSWORD)
const driverASession = await realSessionClient('load-verify-driver-a@example.com', PASSWORD)

// 1. Owner can create a load (mirrors createLoad's insert), assigned to Driver A,
//    with rate_per_mile computed the same way createLoad computes it.
const rateTotal = 500
const distanceMiles = 250
const { data: ownerInsert, error: ownerInsertErr } = await ownerSession
  .from('loads')
  .insert({
    external_load_id: 'VERIFY-LOAD-1',
    status: 'booked',
    pickup_facility_code: 'TEST1',
    delivery_facility_code: 'TEST2',
    distance_miles: distanceMiles,
    rate_total: rateTotal,
    rate_per_mile: rateTotal / distanceMiles,
    driver_id: driverAId,
    assigned_driver_name: 'Driver A',
  })
  .select('id, rate_per_mile')
  .single()
check('owner can insert a manual load', !ownerInsertErr && !!ownerInsert)
check('rate_per_mile computed correctly (500/250=2)', ownerInsert?.rate_per_mile === 2)
const loadId = ownerInsert?.id

// 2. A driver CANNOT insert a load directly (RLS: loads_owner_insert requires is_owner())
const { error: driverInsertErr } = await driverASession.from('loads').insert({
  external_load_id: 'VERIFY-LOAD-DRIVER-ATTEMPT',
  status: 'booked',
  pickup_facility_code: 'X',
  delivery_facility_code: 'Y',
  driver_id: driverAId,
})
check('driver cannot insert a load directly (RLS blocks it)', !!driverInsertErr)

// 3. Driver A sees their own assigned load
const { data: driverAOwnLoads } = await driverASession
  .from('loads')
  .select('id')
  .eq('driver_id', driverAId)
check('driver A sees their own assigned load', driverAOwnLoads?.some((l) => l.id === loadId))

// 4. Driver A queries ALL loads (no filter) — RLS must still only return their own,
//    proving the dashboard's data boundary is the policy, not the query filter.
const { data: driverAAllLoadsQuery } = await driverASession.from('loads').select('id, driver_id')
check(
  'RLS restricts an unfiltered query to only the driver\'s own rows',
  (driverAAllLoadsQuery ?? []).every((l) => l.driver_id === driverAId)
)

// 5. Driver B (uninvolved) sees zero loads
const driverBSession = await realSessionClient('load-verify-driver-b@example.com', PASSWORD)
const { data: driverBLoads } = await driverBSession.from('loads').select('id')
check('an unrelated driver sees none of these loads', (driverBLoads ?? []).length === 0)

// --- cleanup ---
await serviceClient.from('loads').delete().eq('id', loadId)
await serviceClient.auth.admin.deleteUser(driverAId)
await serviceClient.auth.admin.deleteUser(driverBId)
await serviceClient.auth.admin.deleteUser(ownerId)

const { data: leftoverLoad } = await serviceClient
  .from('loads')
  .select('id')
  .eq('external_load_id', 'VERIFY-LOAD-1')
  .maybeSingle()
check('cleanup: no leftover test load', !leftoverLoad)

console.log('\nDone.')
```

Run: `cd "/mnt/c/Users/eds.dime/Documents/Cursor/DJRJCLogistics/web" && node --env-file=.env.local scratch-verify-load-rls.mjs`

Expected: every line prints `PASS`. If anything prints `FAIL`, that is a real bug in Task 1 or Task 2's code (or in the assumed RLS policies) — stop and report it rather than editing the test to make it pass.

- [ ] **Step 2: Delete the scratch script**

```bash
rm "/mnt/c/Users/eds.dime/Documents/Cursor/DJRJCLogistics/web/scratch-verify-load-rls.mjs"
```

No commit for this task — nothing here belongs in the repo, matching this project's established convention for one-off verification scripts (e.g. the Foundation plan's owner-bootstrap script, the Loads plan's csv-mapping check).

---

### Task 4: Final build, deploy, and production verification

**Files:** none (infra + verification only)

**Interfaces:**
- Consumes: everything from Tasks 1-3.

- [ ] **Step 1: Confirm a clean tree and full build**

```bash
cd "/mnt/c/Users/eds.dime/Documents/Cursor/DJRJCLogistics"
git status
cd web && npm run build
```

Expected: `git status` shows nothing outstanding (Tasks 1-2 already committed and pushed; Task 3 left no files behind). Build succeeds, route list includes `/dashboard/loads/new`.

- [ ] **Step 2: Verify the production deployment**

Each prior task's `git push` triggers an automatic Vercel production deployment (confirmed GitHub-integration behavior for this project).

```bash
cd "/mnt/c/Users/eds.dime/Documents/Cursor/DJRJCLogistics"
vercel ls djrjc-logistics-web --scope djrjc
```
Expected: the most recent deployment shows `● Ready` in Production.

```bash
curl -s -D - -o /dev/null https://djrjc-logistics-web.vercel.app/dashboard/loads/new
```
Expected: redirects to `/login` (route exists, auth-gated, same pattern as every other `/dashboard/*` route).

- [ ] **Step 3: Report**

Note in your report: manual end-to-end confirmation (actually adding a load through the real UI, and a real driver logging in to see their dashboard) requires a browser session, which is outside what this task can do — Task 3 already proved the underlying RLS/data-correctness live, so this is UI-polish confirmation only, not a blocker.
