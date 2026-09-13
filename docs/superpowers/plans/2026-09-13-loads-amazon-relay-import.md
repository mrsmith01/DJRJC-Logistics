# Loads & Amazon Relay CSV Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the web dashboard a Loads table populated by importing Amazon Relay's Trip History CSV export, with per-row driver matching, dedup on re-upload, and a summary of what happened.

**Architecture:** A Server Action (`importLoads`) reads an uploaded CSV server-side with `csv-parse`, maps each row through a pure mapping module, and upserts onto `public.loads` using the owner's own authenticated Supabase client (RLS already permits this — no service-role client needed). The result renders inline via React's `useActionState`. The `loads` table itself is trimmed first, in a migration, to match what the real CSV can populate and what the owner actually wants tracked.

**Tech Stack:** Next.js App Router (existing `web/` app), `csv-parse` (new dependency), existing `@supabase/ssr` clients.

**Spec:** `docs/superpowers/specs/2026-09-13-loads-amazon-relay-import-design.md`

## Global Constraints

- This plan is import-only — no manual load creation/editing UI, no per-load truck assignment (`truck_id` is dropped from `loads` entirely), no city/state/zip anywhere (the CSV never has it).
- Cancelled rows import **only when `Estimated Cost > 0`**; blank or `0.00` cost → skipped, not imported.
- `pickup_datetime`/`delivery_datetime` come **only from Actual Arrival** at each stop — never Planned, never Departure. Blank Actual Arrival → null, no fallback.
- The real Amazon Relay CSV header has a two-space quirk: `Stop 1  Actual Arrival Date`/`Time` and `Stop 2  Actual Arrival Date`/`Time` have **two spaces** between the stop number and "Actual" (confirmed against the real export; `Stop 1 Planned Arrival Date` etc. have only one space). Column-name strings in code must match exactly.
- No pre-existing test suite in this repo (v1 is a fresh scaffold) — verification is `npm run build` per task plus one real-file manual smoke test at the end, matching how the two prior plans in this repo were verified. Do not introduce a test framework as part of this plan.
- The real sample file for manual testing is `TripsNew.csv` (279 data rows), which lives outside this repo at `/mnt/c/Users/eds.dime/Documents/Cursor/TripsNew.csv` — it is the owner's real business data and must never be copied into the repo or committed.
- `web/app/dashboard/loads/` is a new directory; nothing in it exists yet.

---

### Task 1: Trim `loads` schema for production, add `cancelled` status

**Files:**
- Create: `supabase/migrations/20260913120000_trim_loads_schema_for_production.sql`

**Interfaces:**
- Produces: the final `public.loads` shape every later task assumes: `id, driver_id, external_load_id, status, pickup_facility_code, pickup_datetime, delivery_facility_code, delivery_datetime, distance_miles, rate_total, rate_per_mile, assigned_driver_name, created_at`. `status` can now be `'booked' | 'in_transit' | 'delivered' | 'cancelled'`.

**Why:** The CSV never provides city/state/zip (confirmed against all 279 rows of a real export), and the owner scoped production loads fields down to id/status/stops/rate/driver — see the design spec's Schema changes section. The existing `enforce_driver_load_update()` trigger diffs several columns this migration drops; left unfixed, it would throw `column does not exist` the first time anyone updates a load.

- [ ] **Step 1: Write the migration**

```sql
-- 20260913120000_trim_loads_schema_for_production.sql
--
-- Built against a real Amazon Relay Trip History export (not the Foundation
-- plan's guessed column layout): the CSV never provides city/state/zip for
-- either stop, and the owner scoped production `loads` fields down to
-- id/status/stops/rate/driver. This drops everything else `loads` doesn't
-- need, and adds the 'cancelled' status the real export requires (cancelled
-- trips can still carry a real settled rate, which the owner wants kept).

alter type public.load_status add value 'cancelled';

alter table public.loads
  drop column pickup_city,
  drop column pickup_state,
  drop column pickup_zip,
  drop column delivery_city,
  drop column delivery_state,
  drop column delivery_zip,
  drop column equipment_type,
  drop column duration_minutes,
  drop column rate_type,
  drop column notes,
  drop column truck_id,
  drop column source;

drop type public.load_source;

-- Rewritten to only diff columns that still exist; the previous version
-- referenced every column dropped above.
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
     or new.external_load_id is distinct from old.external_load_id
     or new.pickup_facility_code is distinct from old.pickup_facility_code
     or new.pickup_datetime is distinct from old.pickup_datetime
     or new.delivery_facility_code is distinct from old.delivery_facility_code
     or new.delivery_datetime is distinct from old.delivery_datetime
     or new.distance_miles is distinct from old.distance_miles
     or new.rate_total is distinct from old.rate_total
     or new.rate_per_mile is distinct from old.rate_per_mile
     or new.assigned_driver_name is distinct from old.assigned_driver_name
  then
    raise exception 'drivers may only update status on their own loads';
  end if;

  return new;
end;
$$;
```

- [ ] **Step 2: Apply and verify**

Use `mcp__plugin_supabase_supabase__apply_migration` (project_id `qejkrtyudtegxcwgccsr`, name `trim_loads_schema_for_production`) with the SQL above.

Run (verification), via `mcp__plugin_supabase_supabase__execute_sql`:
```sql
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'loads'
order by column_name;
```
Expected: exactly `assigned_driver_name, created_at, delivery_datetime, delivery_facility_code, distance_miles, driver_id, external_load_id, id, pickup_datetime, pickup_facility_code, rate_per_mile, rate_total, status` — no others.

```sql
select enumlabel from pg_enum e
join pg_type t on e.enumtypid = t.oid
where t.typname = 'load_status'
order by enumlabel;
```
Expected: `booked, cancelled, delivered, in_transit`.

```sql
select prosrc from pg_proc
where proname = 'enforce_driver_load_update' and pronamespace = 'private'::regnamespace;
```
Expected: contains `drivers may only update status on their own loads`; does not contain `truck_id`.

Run `mcp__plugin_supabase_supabase__get_advisors` with `type: "security"`.
Expected: zero lints (RLS policies don't reference any dropped column, so this change doesn't touch them).

- [ ] **Step 3: Commit**

```bash
cd "/mnt/c/Users/eds.dime/Documents/Cursor/DJRJCLogistics"
git add supabase/migrations/20260913120000_trim_loads_schema_for_production.sql
git commit -m "Trim loads schema to production fields, add cancelled status"
git push
```

---

### Task 2: `csv-parse` dependency and shared `requireOwner()` helper

**Files:**
- Create: `web/lib/supabase/require-owner.ts`
- Modify: `web/app/dashboard/drivers/actions.ts`
- Modify: `web/package.json`, `web/package-lock.json`

**Interfaces:**
- Produces: `requireOwner()` from `web/lib/supabase/require-owner.ts`, returning `Promise<{ supabase: SupabaseClient; user: User }>` — used by Task 4's `importLoads` and (after this task) by `drivers/actions.ts`.

**Why:** `drivers/actions.ts` already has a local `requireOwner()`; Task 4 needs the identical check. Extracting it once avoids a second near-duplicate copy.

- [ ] **Step 1: Install `csv-parse`**

```bash
cd "/mnt/c/Users/eds.dime/Documents/Cursor/DJRJCLogistics/web"
npm install csv-parse
```

- [ ] **Step 2: Extract the shared helper**

```typescript
// web/lib/supabase/require-owner.ts
import { createClient } from './server'

export async function requireOwner() {
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

  return { supabase, user }
}
```

- [ ] **Step 3: Update `drivers/actions.ts` to use it**

Replace the full contents of `web/app/dashboard/drivers/actions.ts` with:

```typescript
'use server'

import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/service-client'
import { requireOwner } from '@/lib/supabase/require-owner'

export async function inviteDriver(formData: FormData) {
  await requireOwner()

  const email = formData.get('email')
  const name = formData.get('name')

  if (typeof email !== 'string' || !email || typeof name !== 'string' || !name) {
    throw new Error('Name and email are required')
  }

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
  const { supabase, user } = await requireOwner()

  const unitNumber = formData.get('unit_number')
  const plate = formData.get('plate')

  if (typeof unitNumber !== 'string' || !unitNumber) {
    throw new Error('Unit number is required')
  }

  const { error } = await supabase.from('trucks').insert({
    unit_number: unitNumber,
    plate: typeof plate === 'string' && plate ? plate : null,
    owner_id: user.id,
  })

  if (error) {
    throw new Error(error.message)
  }

  revalidatePath('/dashboard/drivers')
}
```

- [ ] **Step 4: Verify build**

Run: `npm run build` (from `web/`)
Expected: succeeds with no type errors.

- [ ] **Step 5: Commit and push**

```bash
cd "/mnt/c/Users/eds.dime/Documents/Cursor/DJRJCLogistics"
git add web/package.json web/package-lock.json web/lib/supabase/require-owner.ts web/app/dashboard/drivers/actions.ts
git commit -m "Add csv-parse dependency; extract shared requireOwner() helper"
git push
```

---

### Task 3: CSV row-mapping module

**Files:**
- Create: `web/app/dashboard/loads/csv-mapping.ts`
- Test (scratch, not committed): `web/scratch-verify-csv-mapping.ts`

**Interfaces:**
- Produces: `REQUIRED_COLUMNS: readonly string[]`, `type MappedLoad`, `type RowOutcome`, `mapRelayRow(row: Record<string, string>, driverIdByName: Map<string, string>): RowOutcome` — all consumed by Task 4's `importLoads`.

- [ ] **Step 1: Write the mapping module**

```typescript
// web/app/dashboard/loads/csv-mapping.ts

// Exact header strings from a real Amazon Relay Trip History export. Note
// the two-space quirk: "Stop 1  Actual Arrival Date/Time" and
// "Stop 2  Actual Arrival Date/Time" have TWO spaces after the stop number
// (unlike "Stop 1 Planned Arrival Date", which has one). This is not a typo.
export const REQUIRED_COLUMNS = [
  'Load ID',
  'Load Execution Status',
  'Driver Name',
  'Estimate Distance',
  'Estimated Cost',
  'Stop 1',
  'Stop 2',
  'Stop 1 UTC Offset',
  'Stop 2 UTC Offset',
  'Stop 1  Actual Arrival Date',
  'Stop 1  Actual Arrival Time',
  'Stop 2  Actual Arrival Date',
  'Stop 2  Actual Arrival Time',
] as const

const STATUS_MAP: Record<string, 'booked' | 'delivered'> = {
  'Not Started': 'booked',
  Completed: 'delivered',
}

function parseRelayDatetime(
  dateStr: string | undefined,
  timeStr: string | undefined,
  offsetStr: string | undefined
): string | null {
  if (!dateStr || !timeStr || !offsetStr) return null

  const [month, day, year] = dateStr.split('/')
  if (!month || !day || !year) return null

  const offsetHours = Number(offsetStr)
  if (Number.isNaN(offsetHours)) return null

  const sign = offsetHours < 0 ? '-' : '+'
  const absHours = Math.abs(offsetHours)
  const offH = String(Math.trunc(absHours)).padStart(2, '0')
  const offM = String(Math.round((absHours % 1) * 60)).padStart(2, '0')

  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${timeStr}:00${sign}${offH}:${offM}`
}

export type MappedLoad = {
  external_load_id: string
  status: 'booked' | 'delivered' | 'cancelled'
  pickup_facility_code: string | null
  pickup_datetime: string | null
  delivery_facility_code: string | null
  delivery_datetime: string | null
  distance_miles: number | null
  rate_total: number | null
  rate_per_mile: number | null
  assigned_driver_name: string | null
  driver_id: string | null
}

export type RowOutcome =
  | { kind: 'mapped'; load: MappedLoad; needsReview: boolean }
  | { kind: 'skipped_cancelled' }
  | { kind: 'failed'; reason: string }

export function mapRelayRow(
  row: Record<string, string>,
  driverIdByName: Map<string, string>
): RowOutcome {
  const externalLoadId = row['Load ID']?.trim()
  if (!externalLoadId) {
    return { kind: 'failed', reason: 'missing Load ID' }
  }

  const rawStatus = row['Load Execution Status']?.trim()
  const rateTotalRaw = row['Estimated Cost']?.trim()
  const rateTotal = rateTotalRaw ? Number(rateTotalRaw) : null

  let status: MappedLoad['status']
  if (rawStatus === 'Cancelled') {
    if (!rateTotal || rateTotal <= 0) {
      return { kind: 'skipped_cancelled' }
    }
    status = 'cancelled'
  } else if (rawStatus === 'Not Started' || rawStatus === 'Completed') {
    status = STATUS_MAP[rawStatus]
  } else {
    return { kind: 'failed', reason: `unrecognized status "${rawStatus}"` }
  }

  const driverNameRaw = row['Driver Name']?.trim() ?? ''
  const driverId = driverNameRaw
    ? (driverIdByName.get(driverNameRaw.toLowerCase()) ?? null)
    : null

  const distanceRaw = row['Estimate Distance']?.trim()
  const distanceMiles = distanceRaw ? Number(distanceRaw) : null

  const ratePerMile =
    rateTotal && distanceMiles && distanceMiles > 0
      ? rateTotal / distanceMiles
      : null

  const pickupDatetime = parseRelayDatetime(
    row['Stop 1  Actual Arrival Date'],
    row['Stop 1  Actual Arrival Time'],
    row['Stop 1 UTC Offset']
  )
  const deliveryDatetime = parseRelayDatetime(
    row['Stop 2  Actual Arrival Date'],
    row['Stop 2  Actual Arrival Time'],
    row['Stop 2 UTC Offset']
  )

  return {
    kind: 'mapped',
    needsReview: !driverId,
    load: {
      external_load_id: externalLoadId,
      status,
      pickup_facility_code: row['Stop 1']?.trim() || null,
      pickup_datetime: pickupDatetime,
      delivery_facility_code: row['Stop 2']?.trim() || null,
      delivery_datetime: deliveryDatetime,
      distance_miles: distanceMiles,
      rate_total: rateTotal,
      rate_per_mile: ratePerMile,
      assigned_driver_name: driverNameRaw || null,
      driver_id: driverId,
    },
  }
}
```

- [ ] **Step 2: Write a scratch verification script against real rows**

This is a one-off check, not a permanent test suite (see Global Constraints) — write it, run it, delete it. Node 22.6+/24+ runs `.ts` files directly with no build step.

```typescript
// web/scratch-verify-csv-mapping.ts
import assert from 'node:assert/strict'
import { mapRelayRow } from './app/dashboard/loads/csv-mapping'

const drivers = new Map([['earnest smith', 'driver-uuid-1']])

// Completed row, real data from TripsNew.csv
const completed = mapRelayRow(
  {
    'Load ID': '113Z8MDJM',
    'Load Execution Status': 'Completed',
    'Driver Name': 'Earnest Smith',
    'Estimate Distance': '27.04',
    'Estimated Cost': '180.56',
    'Stop 1': 'MQJ5',
    'Stop 1 UTC Offset': '-5',
    'Stop 1  Actual Arrival Date': '03/02/2026',
    'Stop 1  Actual Arrival Time': '01:21',
    'Stop 2': 'DIN4',
    'Stop 2 UTC Offset': '-5',
    'Stop 2  Actual Arrival Date': '03/02/2026',
    'Stop 2  Actual Arrival Time': '02:08',
  },
  drivers
)
assert.equal(completed.kind, 'mapped')
if (completed.kind === 'mapped') {
  assert.equal(completed.load.status, 'delivered')
  assert.equal(completed.load.driver_id, 'driver-uuid-1')
  assert.equal(completed.needsReview, false)
  assert.equal(completed.load.pickup_datetime, '2026-03-02T01:21:00-05:00')
  assert.equal(completed.load.delivery_datetime, '2026-03-02T02:08:00-05:00')
  assert.ok(Math.abs(completed.load.rate_per_mile! - 180.56 / 27.04) < 0.0001)
}

// Not Started row, real data — blank driver, blank actual arrival, blank cost
const notStarted = mapRelayRow(
  {
    'Load ID': '116KKLHRY',
    'Load Execution Status': 'Not Started',
    'Driver Name': '',
    'Estimate Distance': '36.08',
    'Estimated Cost': '',
    'Stop 1': 'MQJ5',
    'Stop 1 UTC Offset': '-5',
    'Stop 1  Actual Arrival Date': '',
    'Stop 1  Actual Arrival Time': '',
    'Stop 2': 'DIN8',
    'Stop 2 UTC Offset': '-5',
    'Stop 2  Actual Arrival Date': '',
    'Stop 2  Actual Arrival Time': '',
  },
  drivers
)
assert.equal(notStarted.kind, 'mapped')
if (notStarted.kind === 'mapped') {
  assert.equal(notStarted.load.status, 'booked')
  assert.equal(notStarted.load.driver_id, null)
  assert.equal(notStarted.needsReview, true)
  assert.equal(notStarted.load.pickup_datetime, null)
  assert.equal(notStarted.load.rate_total, null)
  assert.equal(notStarted.load.rate_per_mile, null)
}

// Cancelled row with a real rate, real data — should import as 'cancelled'
const cancelledWithPay = mapRelayRow(
  {
    'Load ID': '114FDR3P9',
    'Load Execution Status': 'Cancelled',
    'Driver Name': 'Earnest Smith',
    'Estimate Distance': '8.25',
    'Estimated Cost': '155.00',
    'Stop 1': '106_S_GERMAN_CHURCH_RD',
    'Stop 1 UTC Offset': '-5',
    'Stop 1  Actual Arrival Date': '03/06/2026',
    'Stop 1  Actual Arrival Time': '09:00',
    'Stop 2': 'MQJ1',
    'Stop 2 UTC Offset': '-5',
    'Stop 2  Actual Arrival Date': '',
    'Stop 2  Actual Arrival Time': '',
  },
  drivers
)
assert.equal(cancelledWithPay.kind, 'mapped')
if (cancelledWithPay.kind === 'mapped') {
  assert.equal(cancelledWithPay.load.status, 'cancelled')
  assert.equal(cancelledWithPay.load.rate_total, 155)
}

// Cancelled row with no pay — should be skipped entirely
const cancelledNoPay = mapRelayRow(
  {
    'Load ID': '999NOPAY',
    'Load Execution Status': 'Cancelled',
    'Driver Name': 'Earnest Smith',
    'Estimate Distance': '5',
    'Estimated Cost': '0.00',
    'Stop 1': 'MQJ5',
    'Stop 1 UTC Offset': '-5',
    'Stop 1  Actual Arrival Date': '',
    'Stop 1  Actual Arrival Time': '',
    'Stop 2': 'DIN4',
    'Stop 2 UTC Offset': '-5',
    'Stop 2  Actual Arrival Date': '',
    'Stop 2  Actual Arrival Time': '',
  },
  drivers
)
assert.equal(cancelledNoPay.kind, 'skipped_cancelled')

// Unrecognized status — must fail loudly, never guess
const badStatus = mapRelayRow(
  {
    'Load ID': '999BAD',
    'Load Execution Status': 'In Transit',
    'Driver Name': '',
    'Estimate Distance': '',
    'Estimated Cost': '',
    'Stop 1': '',
    'Stop 1 UTC Offset': '',
    'Stop 1  Actual Arrival Date': '',
    'Stop 1  Actual Arrival Time': '',
    'Stop 2': '',
    'Stop 2 UTC Offset': '',
    'Stop 2  Actual Arrival Date': '',
    'Stop 2  Actual Arrival Time': '',
  },
  drivers
)
assert.equal(badStatus.kind, 'failed')

console.log('OK: all csv-mapping checks passed')
```

Run: `cd "/mnt/c/Users/eds.dime/Documents/Cursor/DJRJCLogistics/web" && node scratch-verify-csv-mapping.ts`
Expected: prints `OK: all csv-mapping checks passed` with exit code 0. If any `assert` fails, fix `csv-mapping.ts` (not the script — the script encodes real data and the design spec's rules) and re-run.

- [ ] **Step 3: Delete the scratch script**

```bash
rm "/mnt/c/Users/eds.dime/Documents/Cursor/DJRJCLogistics/web/scratch-verify-csv-mapping.ts"
```

- [ ] **Step 4: Commit**

```bash
cd "/mnt/c/Users/eds.dime/Documents/Cursor/DJRJCLogistics"
git add web/app/dashboard/loads/csv-mapping.ts
git commit -m "Add Amazon Relay CSV row-mapping module"
git push
```

---

### Task 4: `importLoads` Server Action

**Files:**
- Create: `web/app/dashboard/loads/actions.ts`
- Modify: `web/next.config.ts`

**Interfaces:**
- Consumes: `requireOwner()` (Task 2), `REQUIRED_COLUMNS`/`mapRelayRow`/`MappedLoad` (Task 3).
- Produces: `type ImportState`, `importLoads(prevState: ImportState, formData: FormData): Promise<ImportState>` — consumed by Task 5's `LoadsImportForm` via `useActionState`.

**Why the `next.config.ts` change:** Server Actions cap request bodies at 1MB by default (Next.js docs, `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/serverActions.md`). The current real export is ~97KB, but Trip History exports grow over time as more loads accumulate — raising the limit now avoids a confusing failure months from now.

- [ ] **Step 1: Raise the Server Action body size limit**

```typescript
// web/next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
};

export default nextConfig;
```

- [ ] **Step 2: Write the Server Action**

```typescript
// web/app/dashboard/loads/actions.ts
'use server'

import { parse } from 'csv-parse/sync'
import { revalidatePath } from 'next/cache'
import { requireOwner } from '@/lib/supabase/require-owner'
import { REQUIRED_COLUMNS, mapRelayRow, type MappedLoad } from './csv-mapping'

export type ImportState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | {
      status: 'done'
      created: number
      updated: number
      skippedCancelled: number
      needsReview: { externalLoadId: string; driverName: string }[]
      failed: { row: number; reason: string }[]
    }

export async function importLoads(
  _prevState: ImportState,
  formData: FormData
): Promise<ImportState> {
  const { supabase } = await requireOwner()

  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) {
    return { status: 'error', message: 'Choose a CSV file to upload.' }
  }

  const text = await file.text()
  const records: Record<string, string>[] = parse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  })

  if (records.length === 0) {
    return { status: 'error', message: 'The CSV file has no data rows.' }
  }

  const header = Object.keys(records[0])
  const missingColumns = REQUIRED_COLUMNS.filter((c) => !header.includes(c))
  if (missingColumns.length > 0) {
    return {
      status: 'error',
      message: `CSV is missing expected columns: ${missingColumns.join(', ')}`,
    }
  }

  const { data: drivers, error: driversError } = await supabase
    .from('profiles')
    .select('id, name')
    .eq('role', 'driver')

  if (driversError) {
    return { status: 'error', message: driversError.message }
  }

  const driverIdByName = new Map(
    (drivers ?? []).map((d) => [d.name.trim().toLowerCase(), d.id])
  )

  const toUpsert: MappedLoad[] = []
  const needsReview: { externalLoadId: string; driverName: string }[] = []
  const failed: { row: number; reason: string }[] = []
  let skippedCancelled = 0

  records.forEach((row, index) => {
    const outcome = mapRelayRow(row, driverIdByName)

    if (outcome.kind === 'failed') {
      failed.push({ row: index + 2, reason: outcome.reason }) // +2: 1-indexed, plus header row
      return
    }

    if (outcome.kind === 'skipped_cancelled') {
      skippedCancelled += 1
      return
    }

    toUpsert.push(outcome.load)
    if (outcome.needsReview) {
      needsReview.push({
        externalLoadId: outcome.load.external_load_id,
        driverName: outcome.load.assigned_driver_name ?? '(blank)',
      })
    }
  })

  if (toUpsert.length === 0) {
    return { status: 'done', created: 0, updated: 0, skippedCancelled, needsReview, failed }
  }

  const externalIds = toUpsert.map((l) => l.external_load_id)
  const { data: existing, error: existingError } = await supabase
    .from('loads')
    .select('external_load_id')
    .in('external_load_id', externalIds)

  if (existingError) {
    return { status: 'error', message: existingError.message }
  }

  const existingIds = new Set((existing ?? []).map((l) => l.external_load_id))
  const created = toUpsert.filter((l) => !existingIds.has(l.external_load_id)).length
  const updated = toUpsert.length - created

  const { error: upsertError } = await supabase
    .from('loads')
    .upsert(toUpsert, { onConflict: 'external_load_id' })

  if (upsertError) {
    return { status: 'error', message: upsertError.message }
  }

  revalidatePath('/dashboard/loads')

  return { status: 'done', created, updated, skippedCancelled, needsReview, failed }
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build` (from `web/`)
Expected: succeeds with no type errors.

- [ ] **Step 4: Commit and push**

```bash
cd "/mnt/c/Users/eds.dime/Documents/Cursor/DJRJCLogistics"
git add web/next.config.ts web/app/dashboard/loads/actions.ts
git commit -m "Add importLoads Server Action for Amazon Relay CSV import"
git push
```

---

### Task 5: Loads page — table, filters, upload form

**Files:**
- Create: `web/app/dashboard/loads/page.tsx`
- Create: `web/app/dashboard/loads/loads-import-form.tsx`

**Interfaces:**
- Consumes: `createClient()` from `web/lib/supabase/server.ts`, `importLoads`/`ImportState` from Task 4.
- Produces: the `/dashboard/loads` route.

- [ ] **Step 1: Import form + summary display (client component)**

```tsx
// web/app/dashboard/loads/loads-import-form.tsx
'use client'

import { useActionState } from 'react'
import { importLoads, type ImportState } from './actions'

const initialState: ImportState = { status: 'idle' }

export function LoadsImportForm() {
  const [state, formAction, pending] = useActionState(importLoads, initialState)

  return (
    <section style={{ marginBottom: '2rem' }}>
      <h2>Import Amazon Relay Trip History</h2>
      <form action={formAction}>
        <input type="file" name="file" accept=".csv" required />
        <button type="submit" disabled={pending}>
          {pending ? 'Importing…' : 'Import CSV'}
        </button>
      </form>

      {state.status === 'error' && <p style={{ color: 'red' }}>{state.message}</p>}

      {state.status === 'done' && (
        <div>
          <p>
            Created {state.created}, updated {state.updated}, skipped{' '}
            {state.skippedCancelled} cancelled (no pay).
          </p>
          {state.needsReview.length > 0 && (
            <div>
              <strong>Needs driver review ({state.needsReview.length}):</strong>
              <ul>
                {state.needsReview.map((r) => (
                  <li key={r.externalLoadId}>
                    {r.externalLoadId} — {r.driverName}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {state.failed.length > 0 && (
            <div>
              <strong>Failed rows ({state.failed.length}):</strong>
              <ul>
                {state.failed.map((f) => (
                  <li key={f.row}>
                    Row {f.row}: {f.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
```

- [ ] **Step 2: Loads page (server component: auth, filters, table)**

```tsx
// web/app/dashboard/loads/page.tsx
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
```

- [ ] **Step 3: Verify build**

Run: `npm run build` (from `web/`)
Expected: succeeds, `/dashboard/loads` present in the route list.

- [ ] **Step 4: Commit and push**

```bash
cd "/mnt/c/Users/eds.dime/Documents/Cursor/DJRJCLogistics"
git add web/app/dashboard/loads/page.tsx web/app/dashboard/loads/loads-import-form.tsx
git commit -m "Add Loads page with filters and CSV import form"
git push
```

---

### Task 6: Link Loads from the dashboard home page

**Files:**
- Modify: `web/app/dashboard/page.tsx`

**Interfaces:** none — leaf change.

- [ ] **Step 1: Add the link**

```tsx
// web/app/dashboard/page.tsx
export default function DashboardHomePage() {
  return (
    <div>
      <h1>Dashboard</h1>
      <p>
        <a href="/dashboard/drivers">Drivers &amp; Trucks</a>
      </p>
      <p>
        <a href="/dashboard/loads">Loads</a>
      </p>
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
git commit -m "Link Loads page from dashboard home"
git push
```

---

### Task 7: Verify production deployment and real-file import

**Files:** none (infra + manual verification only)

**Interfaces:**
- Consumes: everything from Tasks 1-6.

- [ ] **Step 1: Verify the deployment**

Each prior task's `git push` triggers an automatic Vercel production deployment (confirmed GitHub-integration behavior for this project). Check the latest deployment succeeded:

```bash
cd "/mnt/c/Users/eds.dime/Documents/Cursor/DJRJCLogistics"
vercel ls djrjc-logistics-web --scope djrjc
```
Expected: the most recent deployment shows `● Ready` in Production.

Run:
```bash
curl -s -D - -o /dev/null https://djrjc-logistics-web.vercel.app/dashboard/loads
```
Expected: redirects to `/login` (route exists, auth-gated, same as `/dashboard/drivers`).

- [ ] **Step 2: Manual end-to-end test (owner performs this — requires an authenticated browser session)**

Note in your report, verbatim: "Log in at https://djrjc-logistics-web.vercel.app/dashboard/loads and upload your real Trip History export (e.g. `TripsNew.csv`). Check that: (1) the created/updated/needs-review/skipped-cancelled counts look right against what you know about that file; (2) re-uploading the exact same file reports 0 created and the same updated count as rows imported the first time (dedup); (3) at least one cancelled trip that had a real dollar amount shows up in the table with status `cancelled`; (4) cancelled trips with no listed pay do not appear at all." This cannot be done from here — it needs a real browser session and the real file, which lives outside the repo.

- [ ] **Step 3: Confirm nothing outstanding**

```bash
cd "/mnt/c/Users/eds.dime/Documents/Cursor/DJRJCLogistics"
git status
```
Expected: clean, `origin/main` matches local `HEAD`. No commit needed for this task.
