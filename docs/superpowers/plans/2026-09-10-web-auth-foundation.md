# Web Auth Foundation & Drivers/Trucks Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the web dashboard real, session-based Supabase Auth (login/logout, protected routes) and owner-only Drivers & Trucks management, replacing the unauthenticated diagnostic home page from the Foundation plan. This is the first of three remaining web-dashboard plans (this one, then Loads + Amazon Relay import, then Expenses) — each needs real logins to be meaningful, so this comes first.

**Architecture:** Standard Supabase + Next.js App Router SSR auth pattern (`@supabase/ssr`): a browser client, a server client backed by cookies, and Next.js middleware that refreshes the session and gate-keeps `/dashboard/*`. Server Actions handle sign-in/out and owner-only mutations (invite driver, add truck), using the existing server-only service-role client from the Foundation plan for the one operation that needs to bypass RLS (inviting a new auth user).

**Tech Stack:** Next.js App Router (existing `web/` app), `@supabase/ssr`, Supabase Auth admin API.

**Spec:** `docs/superpowers/specs/2026-09-09-djrjc-logistics-v1-design.md`

## Global Constraints

- No public self-signup — every account is created via `auth.admin.inviteUserByEmail`, never a client-facing sign-up form. (The Foundation plan's `private.handle_new_user()` trigger now hard-codes `role='driver'` regardless of client-supplied metadata, so even if a self-signup path existed, it could not grant `owner`.)
- RLS is the real access boundary; Server Actions that need owner-only behavior must still re-check the caller's role server-side (`requireOwner()` below) — RLS blocks unauthorized *data* access, but a Server Action can still be *invoked* by anyone, so it must check itself before doing anything privileged.
- The service-role client (`web/lib/supabase/service-client.ts`, `import "server-only"`) is only ever used from Server Actions, never from a Server/Client Component that renders to the browser.
- Env vars: `NEXT_PUBLIC_SUPABASE_URL` = `https://qejkrtyudtegxcwgccsr.supabase.co`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFlamtydHl1ZHRlZ3hjd2djY3NyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg5ODkwNjAsImV4cCI6MjEwNDU2NTA2MH0.3U2XT4BfCoypSG2TbOyG-CunFBlDn0mRXt_AUanZg8s` (both safe for client-side exposure — this is the `anon` key, not the service role key).
- Owner's own login email: `edsmith1324@gmail.com` (user-confirmed).

---

### Task 1: Fix service-role trigger bypass

**Files:**
- Create: `supabase/migrations/20260910120000_fix_service_role_trigger_bypass.sql`

**Interfaces:**
- Produces: corrected `private.enforce_driver_load_update()` and `private.enforce_profile_self_update()` that Task 6 (owner bootstrap) and any future service-role write (e.g. Amazon Relay CSV import in a later plan) depend on working.

**Why:** Both trigger functions currently only bypass their restriction when `private.is_owner()` is true, which checks `auth.uid()` against `profiles.role`. A service-role connection (used by `createServiceClient()`, by `execute_sql`, and by the Auth admin API under the hood) has no `auth.uid()` at all — `auth.uid()` returns `NULL` for it. Today that means a service-role-initiated update to `profiles.role` (needed to bootstrap the owner in Task 6) or to any non-status `loads` column (needed by the future CSV-import plan) gets rejected by these triggers, even though service-role access is supposed to be fully trusted (it already bypasses RLS entirely). Fix: also allow through when `auth.uid() IS NULL`.

- [ ] **Step 1: Write the migration**

```sql
-- 20260910120000_fix_service_role_trigger_bypass.sql

create or replace function private.enforce_driver_load_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.is_owner() or (select auth.uid()) is null then
    return new;
  end if;

  if new.driver_id is distinct from old.driver_id
     or new.truck_id is distinct from old.truck_id
     or new.external_load_id is distinct from old.external_load_id
     or new.source is distinct from old.source
     or new.rate_type is distinct from old.rate_type
     or new.pickup_facility_code is distinct from old.pickup_facility_code
     or new.pickup_city is distinct from old.pickup_city
     or new.pickup_state is distinct from old.pickup_state
     or new.pickup_zip is distinct from old.pickup_zip
     or new.pickup_datetime is distinct from old.pickup_datetime
     or new.delivery_facility_code is distinct from old.delivery_facility_code
     or new.delivery_city is distinct from old.delivery_city
     or new.delivery_state is distinct from old.delivery_state
     or new.delivery_zip is distinct from old.delivery_zip
     or new.delivery_datetime is distinct from old.delivery_datetime
     or new.equipment_type is distinct from old.equipment_type
     or new.distance_miles is distinct from old.distance_miles
     or new.duration_minutes is distinct from old.duration_minutes
     or new.rate_total is distinct from old.rate_total
     or new.rate_per_mile is distinct from old.rate_per_mile
     or new.assigned_driver_name is distinct from old.assigned_driver_name
  then
    raise exception 'drivers may only update status and notes on their own loads';
  end if;

  return new;
end;
$$;

create or replace function private.enforce_profile_self_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.is_owner() or (select auth.uid()) is null then
    return new;
  end if;

  if new.id is distinct from old.id
     or new.role is distinct from old.role
     or new.email is distinct from old.email
  then
    raise exception 'only an owner may change id, role, or email on a profile';
  end if;

  return new;
end;
$$;
```

- [ ] **Step 2: Apply and verify**

Use `mcp__plugin_supabase_supabase__apply_migration` (project_id `qejkrtyudtegxcwgccsr`, name `fix_service_role_trigger_bypass`) with the SQL above.

Run (verification): `mcp__plugin_supabase_supabase__execute_sql` with:
```sql
select prosrc from pg_proc where proname = 'enforce_profile_self_update' and pronamespace = 'private'::regnamespace;
```
Expected: the returned function body contains `(select auth.uid()) is null`.

Run: `mcp__plugin_supabase_supabase__get_advisors` with `type: "security"`.
Expected: zero lints (same as before — this change doesn't alter RLS, only trigger logic).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260910120000_fix_service_role_trigger_bypass.sql
git commit -m "Fix service-role bypass in profile/load update-restriction triggers"
git push
```

---

### Task 2: Supabase SSR client helpers and auth middleware

**Files:**
- Create: `web/lib/supabase/client.ts`
- Create: `web/lib/supabase/server.ts`
- Create: `web/lib/supabase/middleware.ts`
- Create: `web/middleware.ts`
- Modify: `web/.env.local.example`
- Modify: `web/.env.local` (local only, git-ignored)

**Interfaces:**
- Produces: `createClient()` (browser, from `web/lib/supabase/client.ts`) and `createClient()` (server/async, from `web/lib/supabase/server.ts`) — both used by every later task in this plan and the two plans after it. `updateSession(request)` from `web/lib/supabase/middleware.ts`, used only by `web/middleware.ts`.

- [ ] **Step 1: Install `@supabase/ssr`**

```bash
cd web && npm install @supabase/ssr
```

- [ ] **Step 2: Add the public env vars**

`web/.env.local.example` (add two lines to the existing file):
```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

`web/.env.local` (git-ignored — add these two lines to the existing file, keep the existing `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` lines as they are):
```
NEXT_PUBLIC_SUPABASE_URL=https://qejkrtyudtegxcwgccsr.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFlamtydHl1ZHRlZ3hjd2djY3NyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg5ODkwNjAsImV4cCI6MjEwNDU2NTA2MH0.3U2XT4BfCoypSG2TbOyG-CunFBlDn0mRXt_AUanZg8s
```

- [ ] **Step 3: Browser client**

```typescript
// web/lib/supabase/client.ts
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
```

- [ ] **Step 4: Server client**

```typescript
// web/lib/supabase/server.ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Called from a Server Component render; middleware refreshes
            // the session on the next request instead.
          }
        },
      },
    }
  )
}
```

- [ ] **Step 5: Middleware session-refresh helper**

```typescript
// web/lib/supabase/middleware.ts
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user && request.nextUrl.pathname.startsWith('/dashboard')) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
```

- [ ] **Step 6: Wire up Next.js middleware**

```typescript
// web/middleware.ts
import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function middleware(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
```

- [ ] **Step 7: Verify build**

Run: `npm run build`
Expected: succeeds with no type errors (the app doesn't use these clients yet, but they must compile).

- [ ] **Step 8: Commit and push**

```bash
cd "/mnt/c/Users/eds.dime/Documents/Cursor/DJRJCLogistics"
git add web/package.json web/package-lock.json web/lib/supabase/client.ts web/lib/supabase/server.ts web/lib/supabase/middleware.ts web/middleware.ts web/.env.local.example
git commit -m "Add Supabase SSR client helpers and session-refresh middleware"
git push
```

(Do not add `web/.env.local`.)

---

### Task 3: Login page and sign-in/sign-out Server Actions

**Files:**
- Create: `web/app/login/actions.ts`
- Create: `web/app/login/page.tsx`

**Interfaces:**
- Consumes: `createClient()` from `web/lib/supabase/server.ts` (Task 2).
- Produces: `signOut()` from `web/app/login/actions.ts`, imported by Task 4's dashboard layout for the sign-out button.

- [ ] **Step 1: Server actions**

```typescript
// web/app/login/actions.ts
'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export async function signIn(formData: FormData) {
  const supabase = await createClient()

  const email = formData.get('email') as string
  const password = formData.get('password') as string

  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`)
  }

  revalidatePath('/', 'layout')
  redirect('/dashboard')
}

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  revalidatePath('/', 'layout')
  redirect('/login')
}
```

- [ ] **Step 2: Login page**

```tsx
// web/app/login/page.tsx
import { signIn } from './actions'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams

  return (
    <main style={{ fontFamily: 'sans-serif', padding: '2rem', maxWidth: 400 }}>
      <h1>DJRJC Logistics</h1>
      <form action={signIn}>
        <div style={{ marginBottom: '1rem' }}>
          <label htmlFor="email">Email</label>
          <br />
          <input id="email" name="email" type="email" required style={{ width: '100%' }} />
        </div>
        <div style={{ marginBottom: '1rem' }}>
          <label htmlFor="password">Password</label>
          <br />
          <input
            id="password"
            name="password"
            type="password"
            required
            style={{ width: '100%' }}
          />
        </div>
        {error && <p style={{ color: 'red' }}>{error}</p>}
        <button type="submit">Sign in</button>
      </form>
    </main>
  )
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: succeeds, `/login` shows as a route in the build output.

- [ ] **Step 4: Commit and push**

```bash
cd "/mnt/c/Users/eds.dime/Documents/Cursor/DJRJCLogistics"
git add web/app/login
git commit -m "Add login page and sign-in/sign-out server actions"
git push
```

---

### Task 4: Authenticated dashboard shell, retire the public health-check page

**Files:**
- Create: `web/app/dashboard/layout.tsx`
- Create: `web/app/dashboard/page.tsx`
- Modify: `web/app/page.tsx`

**Interfaces:**
- Consumes: `createClient()` from `web/lib/supabase/server.ts` (Task 2), `signOut` from `web/app/login/actions.ts` (Task 3).
- Produces: the `/dashboard` route tree that Task 5's Drivers & Trucks page nests under.

**Why replace `web/app/page.tsx`:** the Foundation plan's health-check page used the service-role client to run an unauthenticated, publicly-reachable Supabase query — fine as a one-time connectivity proof, but flagged in the Foundation plan's final review (finding I4) as not a pattern to keep once real auth exists. This task retires it in favor of a simple authenticated/unauthenticated redirect.

- [ ] **Step 1: Dashboard layout (auth-gated shell)**

```tsx
// web/app/dashboard/layout.tsx
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
```

- [ ] **Step 2: Dashboard home page**

```tsx
// web/app/dashboard/page.tsx
export default function DashboardHomePage() {
  return (
    <div>
      <h1>Dashboard</h1>
      <p>
        <a href="/dashboard/drivers">Drivers &amp; Trucks</a>
      </p>
    </div>
  )
}
```

- [ ] **Step 3: Replace the root page with an auth redirect**

```tsx
// web/app/page.tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function HomePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  redirect(user ? '/dashboard' : '/login')
}
```

This removes the `createServiceClient()` import and the `loads` count query from `page.tsx` entirely — `web/lib/supabase/service-client.ts` itself stays (Task 5 of this plan uses it from a Server Action).

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: succeeds; route list shows `/`, `/login`, `/dashboard` (all dynamic — auth-dependent).

- [ ] **Step 5: Commit and push**

```bash
cd "/mnt/c/Users/eds.dime/Documents/Cursor/DJRJCLogistics"
git add web/app/dashboard web/app/page.tsx
git commit -m "Add authenticated dashboard shell, retire public health-check page"
git push
```

---

### Task 5: Drivers & Trucks management (owner-only)

**Files:**
- Create: `web/app/dashboard/drivers/actions.ts`
- Create: `web/app/dashboard/drivers/page.tsx`

**Interfaces:**
- Consumes: `createClient()` from `web/lib/supabase/server.ts`, `createServiceClient()` from `web/lib/supabase/service-client.ts` (both from earlier work), Task 1's trigger fix (needed for the service-role-driven parts of the invite flow to behave correctly under RLS-adjacent triggers — though note `trucks`/`profiles` inserts here go through the normal `createClient()` server client, not the service client, so this task mainly benefits from Task 1 indirectly via Task 6).
- Produces: nothing consumed by later tasks in this plan; this is a leaf feature.

- [ ] **Step 1: Server actions**

```typescript
// web/app/dashboard/drivers/actions.ts
'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service-client'

async function requireOwner() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw new Error('Not authenticated')
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'owner') {
    throw new Error('Only the owner can perform this action')
  }
}

export async function inviteDriver(formData: FormData) {
  await requireOwner()

  const email = formData.get('email') as string
  const name = formData.get('name') as string

  const serviceClient = createServiceClient()
  const { error } = await serviceClient.auth.admin.inviteUserByEmail(email, {
    data: { name },
  })

  if (error) {
    throw new Error(error.message)
  }

  revalidatePath('/dashboard/drivers')
}

export async function addTruck(formData: FormData) {
  await requireOwner()

  const unitNumber = formData.get('unit_number') as string
  const plate = formData.get('plate') as string

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { error } = await supabase.from('trucks').insert({
    unit_number: unitNumber,
    plate: plate || null,
    owner_id: user!.id,
  })

  if (error) {
    throw new Error(error.message)
  }

  revalidatePath('/dashboard/drivers')
}
```

- [ ] **Step 2: Drivers & Trucks page**

```tsx
// web/app/dashboard/drivers/page.tsx
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
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: succeeds, `/dashboard/drivers` present in route list.

- [ ] **Step 4: Commit and push**

```bash
cd "/mnt/c/Users/eds.dime/Documents/Cursor/DJRJCLogistics"
git add web/app/dashboard/drivers
git commit -m "Add owner-only Drivers & Trucks management"
git push
```

---

### Task 6: Bootstrap the owner account

**Files:** none committed (a temporary local script, deleted after use — see below)

**Interfaces:**
- Consumes: Task 1's trigger fix (required — without it, the role-promotion update in Step 2 below is rejected), `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` from `web/.env.local`.
- Produces: a real `owner`-role account at `edsmith1324@gmail.com` that Task 7's verification and all later plans depend on for testing.

- [ ] **Step 1: Invite the owner's own account**

There's no MCP tool for `auth.admin.inviteUserByEmail` — write a temporary script, run it once, then delete it (don't commit it; this is a one-off bootstrap operation, not an app feature).

```javascript
// scratch script, e.g. /tmp/bootstrap-owner.mjs — read SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY from web/.env.local before running
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
)

const { data, error } = await supabase.auth.admin.inviteUserByEmail(
  'edsmith1324@gmail.com',
  { data: { name: 'Ed Smith' } }
)

if (error) {
  console.error('invite failed:', error)
  process.exit(1)
}

console.log('invited user id:', data.user.id)
```

Run it from `web/` with the env vars loaded, e.g.:
```bash
cd web && node --env-file=.env.local /tmp/bootstrap-owner.mjs
```

Record the printed user id — needed for Step 2.

- [ ] **Step 2: Promote that account to owner**

Use `mcp__plugin_supabase_supabase__execute_sql` (project_id `qejkrtyudtegxcwgccsr`):
```sql
update public.profiles
set role = 'owner'
where email = 'edsmith1324@gmail.com';
```

- [ ] **Step 3: Verify**

Run `execute_sql`:
```sql
select id, email, role, name from public.profiles where email = 'edsmith1324@gmail.com';
```
Expected: one row, `role = 'owner'`, `name = 'Ed Smith'`.

- [ ] **Step 4: Clean up the scratch script**

```bash
rm /tmp/bootstrap-owner.mjs
```

No commit for this task — nothing here belongs in the repo. Note in your report that the user needs to check `edsmith1324@gmail.com` for the Supabase invite email and follow its link to set a password before they can sign in.

---

### Task 7: Deploy env vars and verify in production

**Files:** none (infra only)

**Interfaces:**
- Consumes: everything from Tasks 1-6.
- Produces: a live, auth-gated production deployment.

- [ ] **Step 1: Set the two new env vars on Vercel**

Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (values from this plan's Global Constraints) on the `djrjc-logistics-web` Vercel project (`prj_KkHoNqzbYxVspAUaBFNYvrkbxqbx`, team `djrjc`) for Production and Preview — via `vercel env add` (see the `vercel:env` skill) or the MCP tooling. These are safe to expose (the anon key), unlike the existing `SUPABASE_SERVICE_ROLE_KEY`.

- [ ] **Step 2: Redeploy**

```bash
cd "/mnt/c/Users/eds.dime/Documents/Cursor/DJRJCLogistics"
vercel --prod --yes --scope djrjc
```

- [ ] **Step 3: Verify**

Fetch the production URL (`https://djrjc-logistics-web.vercel.app`) unauthenticated.
Expected: HTTP redirect to `/login`, login page renders (not the old "Connected to Supabase" text — that page is gone).

Note in your report: full sign-in verification (submitting real credentials and reaching `/dashboard`) requires the owner to have completed Task 6's invite-email flow (set a password) first — that's a manual step for the user, not something this task can do. If Task 6 already reports the invite was sent, mention that end-to-end login is ready for the user to try, but don't block this task on it.

- [ ] **Step 4: Commit anything outstanding and push**

If Steps 1-3 didn't require code changes (they shouldn't), there's nothing to commit here — just confirm `git status` is clean and `origin/main` matches local `HEAD`.
