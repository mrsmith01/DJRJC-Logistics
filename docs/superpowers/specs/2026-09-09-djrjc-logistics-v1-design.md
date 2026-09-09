# DJRJC Logistics — v1 Design

Status: approved for planning
Date: 2026-09-09

## Purpose

DJRJC is an owner-operator trucking business running loads primarily through
Amazon Relay. This project builds a mobile app (for the owner and drivers on
the road) plus a web back-office dashboard (for the owner/dispatch) to manage
loads and expenses, backed by a shared Supabase project. Most loads currently
come from Amazon Relay's load board, so importing Relay's trip history and
presenting loads in a format the owner already recognizes from the Relay app
is a first-class part of v1, not an add-on.

## Scope decomposition

Owner-operator trucking software can span dispatch, invoicing, fuel/expense
tracking, IFTA reporting, maintenance logs, document management, and more.
This spec covers **v1 only**:

- Loads & Dispatch (including Amazon Relay CSV import)
- Expenses & Fuel

Explicitly out of scope for v1 (future specs, brainstormed separately when
we get there):

- Invoicing & Settlements
- Document management beyond expense/fuel receipt photos
- Maintenance logs & IFTA reporting
- Any load-board integration beyond Amazon Relay CSV import (e.g. DAT,
  Truckstop, or live API integration instead of CSV)

## Users & roles

Two roles, enforced via Postgres Row-Level Security (RLS), not just client
checks:

- **owner** — full access to all loads, expenses, drivers, and trucks.
- **driver** — access limited to their own assigned loads and their own
  logged expenses.

Account creation is invite-only: the owner adds a driver's email from the web
dashboard, Supabase Auth sends an invite email, the driver sets a password on
first login. There is no public self-signup.

## Architecture

Monorepo `DJRJC-Logistics` on GitHub (private, under the `mrsmith01`
account):

```
DJRJC-Logistics/
  mobile/    Expo (React Native + TypeScript) — driver-facing app
  web/       Next.js (App Router, TypeScript) — owner/dispatch dashboard
  supabase/  migrations + config, managed via Supabase CLI
```

- **Backend:** one Supabase project ("DJRJC Logistics") under the existing
  `DJRJC` Supabase org — Postgres, Auth, and Storage (for receipt photos).
  Both apps talk to the same Supabase project via `@supabase/supabase-js`.
- **Mobile:** Expo app, published to iOS & Android app stores over time
  (TestFlight/internal track first). Uses device camera for receipt/fuel
  photo capture.
- **Web:** Next.js app deployed to Vercel under the existing `DJRJC` Vercel
  team, project root `web/`.
- Shared TypeScript types are generated from the Supabase schema and used by
  both `mobile/` and `web/`.

## Data model (v1)

`profiles`
- `id` (uuid, references `auth.users`)
- `role` (`owner` | `driver`)
- `name`, `phone`, `email`

`trucks`
- `id`, `unit_number`, `plate`, `owner_id`

`loads`
- `id`
- `driver_id` (nullable until assigned), `truck_id` (nullable)
- `external_load_id` (text, nullable) — Amazon Relay's load ID, e.g.
  `114JK3HVB`; unique when present, used to dedupe re-imports
- `source` (`manual` | `amazon_relay_import`)
- `rate_type` (text, e.g. `Spot`)
- `status` (`booked` | `in_transit` | `delivered`)
- `pickup_facility_code`, `pickup_city`, `pickup_state`, `pickup_zip`,
  `pickup_datetime`
- `delivery_facility_code`, `delivery_city`, `delivery_state`,
  `delivery_zip`, `delivery_datetime`
- `equipment_type` (text, e.g. `53' Trailer`, `53' Container`)
- `distance_miles` (numeric, nullable)
- `duration_minutes` (integer, nullable)
- `rate_total` (numeric, nullable)
- `rate_per_mile` (numeric, nullable)
- `assigned_driver_name` (text, nullable) — raw name from the imported CSV,
  kept even after matching to `driver_id` for audit/troubleshooting
- `notes` (text, nullable)

`expenses`
- `id`, `driver_id`, `truck_id`, `load_id` (nullable)
- `category` (`fuel` | `other`)
- `amount` (numeric)
- `odometer` (numeric, nullable)
- `state` (text, nullable) — captured now for future IFTA use, not used by
  any IFTA feature in v1
- `gallons` (numeric, nullable — fuel only)
- `receipt_photo_url` (text, nullable — Supabase Storage path)
- `date`

RLS: owner role can read/write all rows; driver role can read/write only
rows where `driver_id = auth.uid()` (loads) or `driver_id = auth.uid()`
(expenses). Drivers cannot see other drivers' data.

## Amazon Relay import

Amazon Relay's carrier portal (relay.amazon.com) has a built-in Trip
History → CSV export — no scraping or OCR needed.

Flow (owner-only, from the web dashboard):

1. Owner exports Trip History as CSV from the Relay portal and uploads it
   in the DJRJC Logistics web dashboard.
2. Server-side parsing (a Next.js API route or Supabase Edge Function) maps
   CSV columns to the `loads` schema above.
3. Matching: `assigned_driver_name` from the CSV is matched against existing
   `profiles` by name; unmatched rows are flagged for the owner to assign a
   driver manually after import.
4. Dedup: rows are upserted on `external_load_id`, so re-uploading an
   overlapping export updates existing rows instead of duplicating them.
5. Import summary shown to the owner: counts of created / updated / needs
   driver review, plus a list of any rows that failed to parse.

The exact Relay CSV column layout will be confirmed against a real export
file during implementation (format may vary slightly by account); the
mapping step should be written to tolerate minor column differences and
fail loudly (surfaced in the import summary) rather than silently
mis-mapping data.

## App surfaces (v1)

**Mobile (drivers, and usable by the owner too since roles differ by
account not by app):**
- Login (invite-based, no self-signup)
- Load list — cards mirroring the Amazon Relay layout: load ID, Stop 1 →
  Stop 2 (facility/city/state/zip + scheduled time), equipment badge,
  rate total + $/mile, status
- Load detail — same info plus a status update action
  (booked → in_transit → delivered)
- Expenses — list + add expense/fuel purchase with camera receipt capture

**Web (owner/dispatch):**
- Login
- Loads table — same fields as the mobile cards, filterable by driver,
  date, and status; CSV import button and import summary view
- Drivers & trucks management — invite a driver, add/edit a truck
- Expenses view — filter by driver/truck/date, view receipt photos

## Error handling

- RLS is the actual access-control boundary; client-side role checks are UX
  only, never trusted for security.
- Given inconsistent cell coverage on the road, v1 does not implement full
  offline-sync. Failed writes show a clear error with a retry action. Full
  offline support is a candidate for a later phase if it proves necessary.
- CSV import failures are surfaced per-row in the import summary rather than
  aborting the whole import or failing silently.
- Form validation happens client-side for UX and is backed by Postgres
  constraints (NOT NULL, enums via check constraints) server-side.

## Testing

- No pre-existing test suite to extend; v1 is a fresh scaffold.
- Manual smoke testing before considering any milestone done: web dashboard
  exercised in a real browser (login, load CRUD, CSV import against a real
  or representative export file, expense entry), mobile app exercised in
  Expo Go/simulator (login, load list/detail, expense entry with photo
  capture).
- RLS policies get a basic sanity check (owner sees all rows, a driver
  account only sees their own) before being considered complete, since a
  broken policy is a data-leak bug, not just a UX bug.

## Provisioning

1. Local folder `DJRJC Logistics` created, git initialized (done).
2. Scaffold the monorepo (`mobile/`, `web/`, `supabase/`).
3. Create private GitHub repo `DJRJC-Logistics` under `mrsmith01`; push
   initial scaffold.
4. Create a Supabase project ("DJRJC Logistics") under the `DJRJC` org;
   apply the initial migration (tables + RLS policies above).
5. Create a Vercel project under the `DJRJC` team, linked to the GitHub
   repo's `web/` directory; wire Supabase URL/anon key as environment
   variables.
6. Configure the mobile app's Supabase environment variables (not
   committed to git).
7. Boot both apps locally and verify core flows before calling v1 done.
