# Loads & Amazon Relay CSV Import — Design

Status: approved for planning
Date: 2026-09-13

## Purpose

Second of the three remaining web-dashboard plans (after
`2026-09-10-web-auth-foundation.md`, before Expenses — see that plan's
intro). Delivers the "Loads & Dispatch" half of v1 scope from
`2026-09-09-djrjc-logistics-v1-design.md`: a Loads table on the web
dashboard, populated primarily by importing Amazon Relay's Trip History
CSV export, with manual per-row driver assignment for anything the
importer can't match.

This design was built against a real export (`TripsNew.csv`, 279 data
rows), not the v1 spec's guess at the column layout. The real file
differs from that guess in ways that changed the data model — see
below.

## Schema changes

The v1 spec assumed the Relay CSV would carry city/state/zip for each
stop. It doesn't — the real export only has facility codes (e.g.
`MQJ5`) and a UTC offset, nothing else geographic. Combined with the
owner's explicit call to keep `loads` limited to what the business
actually uses, `public.loads` is trimmed from its Foundation-plan shape
down to:

```sql
create table public.loads (
  id bigint generated always as identity primary key,
  driver_id uuid references public.profiles (id) on delete set null,
  external_load_id text,                    -- Relay's Load ID; dedupe key
  status public.load_status not null default 'booked',
  pickup_facility_code text,
  pickup_datetime timestamptz,
  delivery_facility_code text,
  delivery_datetime timestamptz,
  distance_miles numeric,                   -- kept only to derive rate_per_mile
  rate_total numeric,
  rate_per_mile numeric,
  assigned_driver_name text,                -- raw CSV name, kept for audit
  created_at timestamptz not null default now()
);
```

Dropped from the Foundation-plan schema, and why:

- `pickup_city`, `pickup_state`, `pickup_zip`, `delivery_city`,
  `delivery_state`, `delivery_zip` — the CSV never populates these;
  confirmed against all 279 rows of a real export, not just the header.
- `equipment_type`, `rate_type`, `duration_minutes`, `notes` — outside
  the field list the owner wants tracked in production.
- `truck_id` — nothing in the CSV maps reliably to `trucks.unit_number`,
  and the owner confirmed dropping per-load truck association entirely
  rather than keeping an always-null column. The `trucks` table itself
  is untouched; loads and trucks are simply unrelated now. If per-load
  truck tracking is wanted later, it needs its own design.
- `source` — with manual-vs-imported no longer needing to be
  distinguished (this plan is import-only; see Out of scope), the
  column has no reader. The now-unused `public.load_source` enum type
  is dropped in the same migration.

`public.loads` currently has 0 rows (verified), so this is a lossless
change — no backfill or data-migration concerns.

**`load_status` gets a new value: `'cancelled'`.** The real export
contains cancelled trips that still carry a real rate (Estimated Cost),
which the owner wants preserved for their records — see the cancelled-row
rule below.

**The `enforce_driver_load_update()` trigger must be rewritten** in the
same migration. Its body does an explicit column-by-column diff
(`new.x is distinct from old.x`) that currently references several
columns this migration drops (`truck_id`, `rate_type`,
`pickup_city`/`state`/`zip`, `delivery_city`/`state`/`zip`,
`equipment_type`, `duration_minutes`). Postgres does not statically
validate plpgsql function bodies against table schema at `DROP COLUMN`
time, so the migration would apply silently and then this trigger would
throw `column does not exist` the first time anyone updates a load. The
rewritten version only diffs the columns that survive: `driver_id`,
`external_load_id`, `pickup_facility_code`, `pickup_datetime`,
`delivery_facility_code`, `delivery_datetime`, `distance_miles`,
`rate_total`, `rate_per_mile`, `assigned_driver_name`. (`status` is
intentionally excluded from the diff — drivers are allowed to change
it, same as before.)

## CSV column mapping

| CSV column(s) | → | Rule |
|---|---|---|
| `Load ID` | `external_load_id` | required; blank → row fails (see Error handling) |
| `Load Execution Status` | `status` | `Not Started`→`booked`, `Completed`→`delivered`, `Cancelled`→`cancelled` **only when** `Estimated Cost` > 0; `Cancelled` with blank or `0.00` cost → row skipped (not imported), counted separately in the summary; any other value → row fails, never guessed |
| `Driver Name` | `assigned_driver_name` (always) + `driver_id` | case-insensitive, trimmed match against `profiles.name` where `role = 'driver'`; blank or no match → `driver_id` null, row flagged "needs driver review" (row still imports) |
| `Estimate Distance` | `distance_miles` | numeric; blank → null |
| `Estimated Cost` | `rate_total` | numeric; blank → null |
| — | `rate_per_mile` | computed: `rate_total / distance_miles` when both present and `distance_miles > 0`, else null |
| `Stop 1` | `pickup_facility_code` | as-is |
| `Stop 2` | `delivery_facility_code` | as-is |
| `Stop 1 Actual Arrival Date` + `Time` + `Stop 1 UTC Offset` | `pickup_datetime` | combined into a timestamptz with the row's fixed offset; **blank Actual Arrival → null** (no fallback to Planned, per owner's call — an unexecuted stop simply has no datetime yet) |
| `Stop 2 Actual Arrival Date` + `Time` + `Stop 2 UTC Offset` | `delivery_datetime` | same rule |
| everything else (Block ID, Trip ID, Trip Stage, Facility Sequence, Transit Operator Type, Equipment Type, Trailer ID, Tractor Vehicle ID, Unit, Rate Type, Currency, Truck Filter, Operator ID, Shipper Account, Sub Carrier, CR_ID, Port Appointment\*, Spot Work, Contract\*, Domicile/Route, \*Planned\*, \*Departure\*) | — | ignored; no surviving schema field for them |

## Import architecture

A Server Action, not a Supabase Edge Function — consistent with every
other mutation in this app (`inviteDriver`, `addTruck`), no new
infrastructure. Flow:

1. Owner uploads the CSV via a file input on `/dashboard/loads`.
2. The Server Action reads the file server-side and parses it with
   `csv-parse` (new dependency in `web/package.json` — handles quoted
   fields with embedded commas correctly; a naive `.split(',')` would
   silently corrupt any such row).
3. Each row is mapped per the table above using the owner's own
   authenticated Supabase client (`createClient()` from
   `web/lib/supabase/server.ts`) — RLS already permits this for the
   owner role (`private.is_owner()`), so no service-role client is
   needed for this flow.
4. Rows upsert on `external_load_id` (existing unique index) —
   re-uploading an overlapping export updates existing rows instead of
   duplicating them, per the v1 spec.
5. The action returns a summary object, rendered inline by the calling
   client component via React's `useActionState` (new pattern for this
   codebase — the standard way to surface a Server Action's return
   value without a redirect; existing actions like `inviteDriver` only
   `revalidatePath` because they don't need to show a result).

No new table stores import history — the summary is shown once, for
the upload that just ran, matching the v1 spec's scope (YAGNI: nothing
today asks for a history of past imports).

## Error handling / import summary

Rendered after each upload:

- **Created** — count of new rows inserted.
- **Updated** — count of existing rows (matched by `external_load_id`)
  that were updated.
- **Needs driver review** — count of rows imported with `driver_id`
  null (blank name or no match), listed with their `external_load_id`
  and the raw `assigned_driver_name` so the owner can act on them.
- **Skipped (cancelled, no pay)** — count of `Cancelled` rows with no
  listed pay amount, intentionally not imported.
- **Failed** — rows that could not be mapped at all (missing `Load ID`,
  or an unrecognized `Load Execution Status`), each listed with its row
  number and the specific reason. The import never aborts partway or
  fails silently — every row lands in exactly one bucket above.

## Loads table UI

`/dashboard/loads`, owner-only (same `requireOwner()` pattern as the
Drivers & Trucks page):

- Upload form at the top (file input + submit), summary renders below
  it after a run.
- Table below: `external_load_id`, status, pickup/delivery facility +
  datetime, driver (assigned name), rate total, $/mile — filterable by
  driver, status, and date range (client-side filtering over the
  server-fetched rows; no need for server-side pagination at this
  data volume).

Drivers do not get a loads list in this plan — the v1 spec assigns that
to the mobile app, out of scope here.

## Out of scope (acknowledged gaps, not fixed by this plan)

- **No manual load creation/editing UI.** This plan is import-only. The
  `source` column's removal means there's no longer a way to even
  distinguish a manually-entered load from an imported one — if manual
  entry is wanted later, it needs its own design (likely reintroducing
  a source-like distinction).
- **No per-load truck assignment** — `truck_id` was dropped from
  `loads` entirely (see Schema changes).
- **No geographic data** (city/state/zip) on any load — facility codes
  only, since that's all the CSV provides.

## Testing

No pre-existing test suite (v1 is a fresh scaffold, per the v1 design
spec). Manual smoke testing before considering this plan done:

- Upload a real Relay export (`TripsNew.csv`) end-to-end; verify the
  created/updated/needs-review/skipped/failed counts match manual
  spot-checks of the file.
- Re-upload the same file; verify the second run reports 0 created,
  279 (or fewer, minus skips/fails) updated — dedup works.
- Verify a `Cancelled` row with `Estimated Cost > 0` imports with
  `status = 'cancelled'` and the correct `rate_total`.
- Verify a `Cancelled` row with `0.00`/blank cost does not appear in
  `loads` at all.
- RLS sanity check: with a driver test account, confirm they can only
  see loads where `driver_id` matches them, per existing
  `loads_select_own_or_owner` policy (unchanged by this plan).
