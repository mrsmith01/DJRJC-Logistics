# DJRJC Logistics Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provision the DJRJC Logistics project's foundation — GitHub repo, Supabase backend (schema + RLS), and a deployed Vercel web skeleton — proving the GitHub↔Vercel↔Supabase chain works end-to-end before any feature work starts.

**Architecture:** A monorepo (`mobile/` added in a later plan, `web/` here) with one Supabase project as the shared backend. This plan does not build features — it creates the repo, the full v1 database schema with RLS, and a minimal Next.js page deployed on Vercel that proves it can talk to Supabase. Every later plan (web dashboard, Amazon Relay import, mobile app) builds directly on top of this.

**Tech Stack:** Next.js (App Router, TypeScript) via `create-next-app`, `@supabase/supabase-js`, Supabase Postgres/Auth/Storage, GitHub, Vercel.

**Spec:** `docs/superpowers/specs/2026-09-09-djrjc-logistics-v1-design.md`

## Global Constraints

- GitHub repo: private, named `DJRJC-Logistics`, under the `mrsmith01` account.
- Supabase project: under the existing `DJRJC` org (org id `brckcpynvtfgqjbdarax`).
- Vercel project: under the existing `DJRJC` team (team id `team_nwPXTclnUvt1lJ43HBCn2gRZ`), root directory `web/`.
- RLS is the actual access-control boundary — every table gets `enable row level security` **and** `force row level security`; no table is left relying on client-side checks alone.
- No public self-signup — accounts are created only by an owner invite or the `on_auth_user_created` trigger reacting to an admin-created auth user (implemented here; actually inviting drivers is a later plan).
- Secrets (`SUPABASE_SERVICE_ROLE_KEY`, etc.) are never committed to git and never used in client-side code.

---

### Task 1: Root repo scaffold

**Files:**
- Create: `.gitignore`
- Create: `README.md`

**Interfaces:**
- Produces: a git-ignored workspace ready for `supabase/` and `web/` to be added in later tasks without accidentally committing secrets or build output.

- [ ] **Step 1: Write `.gitignore`**

```gitignore
# dependencies
node_modules/

# next.js
web/.next/
web/out/

# expo
mobile/.expo/
mobile/dist/

# env files (never commit secrets)
.env
.env.local
**/.env
**/.env.local

# supabase local artifacts
supabase/.branches
supabase/.temp

# misc
.DS_Store
*.log
```

- [ ] **Step 2: Write `README.md`**

```markdown
# DJRJC Logistics

Owner-operator trucking logistics app: a mobile app (Expo) for the owner and
drivers, plus a web back-office dashboard (Next.js), backed by a shared
Supabase project.

See `docs/superpowers/specs/2026-09-09-djrjc-logistics-v1-design.md` for the
full v1 design.

## Layout

- `web/` — Next.js back-office dashboard, deployed to Vercel
- `mobile/` — Expo app for owner/drivers (added in a later plan)
- `supabase/migrations/` — database schema, applied to the hosted Supabase
  project
```

- [ ] **Step 3: Verify and commit**

Run: `git status`
Expected: `.gitignore` and `README.md` listed as untracked (the spec file from brainstorming should already be committed).

```bash
git add .gitignore README.md
git commit -m "Add root .gitignore and README"
```

---

### Task 2: Supabase project + v1 schema with RLS

**Files:**
- Create: `supabase/migrations/20260909120000_initial_schema.sql`

**Interfaces:**
- Consumes: Supabase org id `brckcpynvtfgqjbdarax` (org "DJRJC").
- Produces: a live Supabase project with `profiles`, `trucks`, `loads`, `expenses` tables (RLS enforced) and a `receipts` storage bucket. The project's URL, anon key, and service role key are needed by Task 4 and Task 5.

- [ ] **Step 1: Create the Supabase project**

Use the `mcp__plugin_supabase_supabase__get_cost` tool for a new project in organization `brckcpynvtfgqjbdarax`, then `mcp__plugin_supabase_supabase__confirm_cost` to get a `confirm_cost_id`, then call `mcp__plugin_supabase_supabase__create_project` with:
- `name`: `DJRJC Logistics`
- `organization_id`: `brckcpynvtfgqjbdarax`
- `region`: `us-east-1` (project's primary lanes are in Indiana per the Amazon Relay screenshot in the spec; us-east-1 is the closest standard Supabase region)
- `confirm_cost_id`: from the previous step

Record the returned project ref, API URL, anon key, and (via `mcp__plugin_supabase_supabase__get_publishable_keys` / project settings) the service role key — these are needed in Tasks 4 and 5. Do not commit any of these values to git except the project URL and anon key (both are safe to expose client-side).

Expected: `mcp__plugin_supabase_supabase__get_project` for the new project ref returns `status: ACTIVE_HEALTHY` (may need to poll — new projects take a minute or two to provision).

- [ ] **Step 2: Write the migration file**

```sql
-- 20260909120000_initial_schema.sql

create schema if not exists private;

create type public.user_role as enum ('owner', 'driver');
create type public.load_status as enum ('booked', 'in_transit', 'delivered');
create type public.load_source as enum ('manual', 'amazon_relay_import');
create type public.expense_category as enum ('fuel', 'other');

-- ============================================================
-- profiles
-- ============================================================

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.user_role not null default 'driver',
  name text not null,
  phone text,
  email text not null,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.profiles force row level security;

create or replace function private.is_owner()
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'owner'
  );
$$;

revoke execute on function private.is_owner() from public, anon, authenticated;
grant execute on function private.is_owner() to authenticated;

create policy "profiles_select_self_or_owner"
  on public.profiles for select
  to authenticated
  using (id = (select auth.uid()) or private.is_owner());

create policy "profiles_update_self"
  on public.profiles for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "profiles_owner_all"
  on public.profiles for all
  to authenticated
  using (private.is_owner())
  with check (private.is_owner());

-- Auto-create a profile row whenever an auth user is created (owner
-- bootstrap and driver invites both go through auth.users, carrying
-- role/name in raw_user_meta_data).
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, role, name, email)
  values (
    new.id,
    coalesce((new.raw_user_meta_data ->> 'role')::public.user_role, 'driver'),
    coalesce(new.raw_user_meta_data ->> 'name', new.email),
    new.email
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ============================================================
-- trucks
-- ============================================================

create table public.trucks (
  id bigint generated always as identity primary key,
  unit_number text not null,
  plate text,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index trucks_owner_id_idx on public.trucks (owner_id);

alter table public.trucks enable row level security;
alter table public.trucks force row level security;

create policy "trucks_select_authenticated"
  on public.trucks for select
  to authenticated
  using (true);

create policy "trucks_owner_insert"
  on public.trucks for insert
  to authenticated
  with check (private.is_owner());

create policy "trucks_owner_update"
  on public.trucks for update
  to authenticated
  using (private.is_owner())
  with check (private.is_owner());

create policy "trucks_owner_delete"
  on public.trucks for delete
  to authenticated
  using (private.is_owner());

-- ============================================================
-- loads
-- ============================================================

create table public.loads (
  id bigint generated always as identity primary key,
  driver_id uuid references public.profiles (id) on delete set null,
  truck_id bigint references public.trucks (id) on delete set null,
  external_load_id text,
  source public.load_source not null default 'manual',
  rate_type text,
  status public.load_status not null default 'booked',
  pickup_facility_code text,
  pickup_city text,
  pickup_state text,
  pickup_zip text,
  pickup_datetime timestamptz,
  delivery_facility_code text,
  delivery_city text,
  delivery_state text,
  delivery_zip text,
  delivery_datetime timestamptz,
  equipment_type text,
  distance_miles numeric,
  duration_minutes integer,
  rate_total numeric,
  rate_per_mile numeric,
  assigned_driver_name text,
  notes text,
  created_at timestamptz not null default now()
);

create unique index loads_external_load_id_key
  on public.loads (external_load_id)
  where external_load_id is not null;

create index loads_driver_id_idx on public.loads (driver_id);
create index loads_truck_id_idx on public.loads (truck_id);

alter table public.loads enable row level security;
alter table public.loads force row level security;

create policy "loads_select_own_or_owner"
  on public.loads for select
  to authenticated
  using (driver_id = (select auth.uid()) or private.is_owner());

create policy "loads_owner_insert"
  on public.loads for insert
  to authenticated
  with check (private.is_owner());

create policy "loads_update_own_or_owner"
  on public.loads for update
  to authenticated
  using (driver_id = (select auth.uid()) or private.is_owner())
  with check (driver_id = (select auth.uid()) or private.is_owner());

create policy "loads_owner_delete"
  on public.loads for delete
  to authenticated
  using (private.is_owner());

-- Drivers may only change status/notes on their own loads; every other
-- column (rate, stops, assignment, etc.) requires the owner role. This is
-- enforced in the database, not just hidden in the UI.
create or replace function private.enforce_driver_load_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.is_owner() then
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

create trigger loads_enforce_driver_update
  before update on public.loads
  for each row execute function private.enforce_driver_load_update();

-- ============================================================
-- expenses
-- ============================================================

create table public.expenses (
  id bigint generated always as identity primary key,
  driver_id uuid not null references public.profiles (id) on delete cascade,
  truck_id bigint references public.trucks (id) on delete set null,
  load_id bigint references public.loads (id) on delete set null,
  category public.expense_category not null,
  amount numeric not null,
  odometer numeric,
  state text,
  gallons numeric,
  receipt_photo_url text,
  date date not null default current_date,
  created_at timestamptz not null default now()
);

create index expenses_driver_id_idx on public.expenses (driver_id);
create index expenses_truck_id_idx on public.expenses (truck_id);
create index expenses_load_id_idx on public.expenses (load_id);

alter table public.expenses enable row level security;
alter table public.expenses force row level security;

create policy "expenses_select_own_or_owner"
  on public.expenses for select
  to authenticated
  using (driver_id = (select auth.uid()) or private.is_owner());

create policy "expenses_insert_own_or_owner"
  on public.expenses for insert
  to authenticated
  with check (driver_id = (select auth.uid()) or private.is_owner());

create policy "expenses_update_own_or_owner"
  on public.expenses for update
  to authenticated
  using (driver_id = (select auth.uid()) or private.is_owner())
  with check (driver_id = (select auth.uid()) or private.is_owner());

create policy "expenses_delete_own_or_owner"
  on public.expenses for delete
  to authenticated
  using (driver_id = (select auth.uid()) or private.is_owner());

-- ============================================================
-- storage: receipt photos, stored under receipts/<user_id>/<filename>
-- ============================================================

insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

create policy "receipts_select_own_or_owner"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'receipts'
    and (
      (select auth.uid())::text = (storage.foldername(name))[1]
      or private.is_owner()
    )
  );

create policy "receipts_insert_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'receipts'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

create policy "receipts_delete_own_or_owner"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'receipts'
    and (
      (select auth.uid())::text = (storage.foldername(name))[1]
      or private.is_owner()
    )
  );
```

- [ ] **Step 3: Apply the migration**

Use `mcp__plugin_supabase_supabase__apply_migration` against the new project with `name: "initial_schema"` and the SQL from Step 2.

Run (verification): `mcp__plugin_supabase_supabase__list_tables` on the project.
Expected: `profiles`, `trucks`, `loads`, `expenses` all present, each with `rls_enabled: true`.

- [ ] **Step 4: Check security advisors**

Run: `mcp__plugin_supabase_supabase__get_advisors` with `type: "security"`.
Expected: no lints about missing RLS on `public.profiles`, `public.trucks`, `public.loads`, or `public.expenses`. (Full functional RLS testing — logging in as an owner vs. a driver and confirming row visibility — happens in the web-auth plan once real logins exist; this step only confirms the policies are structurally in place.)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260909120000_initial_schema.sql
git commit -m "Add v1 database schema with RLS (profiles, trucks, loads, expenses)"
```

---

### Task 3: GitHub repository

**Files:** none (no new files; pushes what Tasks 1–2 created)

**Interfaces:**
- Consumes: local git repo from Tasks 1–2 (already has commits).
- Produces: `https://github.com/mrsmith01/DJRJC-Logistics` (private), with `main` pushed — this is what Task 5's Vercel project links to.

- [ ] **Step 1: Create the private repo and push**

```bash
gh repo create DJRJC-Logistics --private --source=. --remote=origin --push
```

- [ ] **Step 2: Verify**

Run: `gh repo view mrsmith01/DJRJC-Logistics --json name,visibility,defaultBranchRef`
Expected: `"name": "DJRJC-Logistics"`, `"visibility": "PRIVATE"`, default branch `main`.

Run: `git log origin/main --oneline`
Expected: the two commits from Tasks 1 and 2 are present on the remote.

---

### Task 4: Next.js web skeleton with a Supabase health check

**Files:**
- Create: `web/` (via `create-next-app`)
- Create: `web/lib/supabase/service-client.ts`
- Modify: `web/app/page.tsx`
- Create: `web/.env.local.example`
- Create: `web/.env.local` (local only — already git-ignored by Task 1's `.gitignore`)

**Interfaces:**
- Consumes: Supabase project URL + service role key from Task 2.
- Produces: `createServiceClient()` in `web/lib/supabase/service-client.ts` — a server-only Supabase client later tasks (CSV import, admin operations) can import. Never used in client components.

- [ ] **Step 1: Scaffold the Next.js app**

```bash
npx create-next-app@latest web --typescript --app --eslint --tailwind --src-dir=false --import-alias "@/*" --use-npm --yes
```

- [ ] **Step 2: Install the Supabase client library**

```bash
cd web && npm install @supabase/supabase-js
```

- [ ] **Step 3: Add environment variable files**

`web/.env.local.example`:

```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

`web/.env.local` (not committed — fill in with the real values from Task 2):

```
SUPABASE_URL=<project API URL from Task 2>
SUPABASE_SERVICE_ROLE_KEY=<service role key from Task 2>
```

- [ ] **Step 4: Write the server-only Supabase client**

```typescript
// web/lib/supabase/service-client.ts
import { createClient } from '@supabase/supabase-js'

export function createServiceClient() {
  const url = process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  })
}
```

- [ ] **Step 5: Replace the home page with a Supabase health check**

```tsx
// web/app/page.tsx
import { createServiceClient } from '@/lib/supabase/service-client'

export default async function HomePage() {
  const supabase = createServiceClient()
  const { count, error } = await supabase
    .from('loads')
    .select('*', { count: 'exact', head: true })

  return (
    <main style={{ fontFamily: 'sans-serif', padding: '2rem' }}>
      <h1>DJRJC Logistics</h1>
      {error ? (
        <p>Supabase connection failed: {error.message}</p>
      ) : (
        <p>Connected to Supabase. Loads in database: {count}</p>
      )}
    </main>
  )
}
```

- [ ] **Step 6: Verify locally**

Run: `npm run build`
Expected: build succeeds with no type errors.

Run: `npm run dev`, then open `http://localhost:3000` in a browser.
Expected: page renders "Connected to Supabase. Loads in database: 0" — confirms `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` are correct and RLS-bypassing server-side access works. Stop the dev server after confirming.

- [ ] **Step 7: Commit and push**

```bash
cd "/mnt/c/Users/eds.dime/Documents/Cursor/DJRJC Logistics"
git add web/.gitignore web/package.json web/package-lock.json web/tsconfig.json web/next.config.ts web/app web/lib web/.env.local.example web/public web/eslint.config.mjs web/postcss.config.mjs
git commit -m "Scaffold Next.js web app with a Supabase connectivity check"
git push
```

(Do not add `web/.env.local` — it's git-ignored and must never be committed.)

---

### Task 5: Vercel project, environment variables, and deployment

**Files:** none (infra only)

**Interfaces:**
- Consumes: GitHub repo from Task 3, Next.js app from Task 4, Supabase credentials from Task 2.
- Produces: a live Vercel deployment URL.

- [ ] **Step 1: Create the Vercel project linked to the GitHub repo**

Use the `mcp__plugin_vercel_vercel__create_git_project` tool (or `vercel link` via CLI if the MCP tool doesn't fit) to create a project under team `team_nwPXTclnUvt1lJ43HBCn2gRZ` ("DJRJC"), linked to `mrsmith01/DJRJC-Logistics`, with root directory `web`. If more detail is needed on the exact flow, consult the `vercel:vercel-cli` and `vercel:env` skills.

- [ ] **Step 2: Set environment variables**

Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (values from Task 2) on the Vercel project for the Production and Preview environments — via `vercel env add` (see the `vercel:env` skill) or the MCP tooling.

- [ ] **Step 3: Deploy**

Trigger a deployment (push already happened in Task 4, so Vercel's git integration should auto-deploy; otherwise use `mcp__plugin_vercel_vercel__deploy_to_vercel` or `vercel --prod`).

- [ ] **Step 4: Verify the live deployment**

Run: `mcp__plugin_vercel_vercel__get_deployment` (or fetch the deployment URL directly) once the build finishes.
Expected: deployment status `READY`, and loading the deployment URL shows "Connected to Supabase. Loads in database: 0" — proving GitHub → Vercel → Supabase all work together in production, not just locally.

If the build fails, check `mcp__plugin_vercel_vercel__get_deployment_build_logs` before making changes.

---

### Task 6: Wrap-up

**Files:**
- Modify: `README.md`

**Interfaces:** none — this task only documents what Tasks 1–5 produced.

- [ ] **Step 1: Add a "Status" section to the README**

```markdown
## Status

Foundation complete: GitHub repo, Supabase project (schema + RLS for
profiles/trucks/loads/expenses), and a Vercel deployment verified to read
from Supabase. No user-facing features yet — see the spec for what's next:
web dashboard (auth, loads, drivers/trucks, Amazon Relay CSV import,
expenses) and the Expo mobile app, each as their own implementation plan.
```

- [ ] **Step 2: Commit and push**

```bash
git add README.md
git commit -m "Document foundation setup status"
git push
```

- [ ] **Step 3: Final check**

Run: `mcp__plugin_supabase_supabase__get_advisors` with `type: "security"` one more time, and re-load the Vercel deployment URL in a browser.
Expected: no new security lints, and the page still shows a successful Supabase connection. Foundation is done — subsequent plans (web dashboard, Amazon Relay import, mobile app) can now be written against this working base.
