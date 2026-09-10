# DJRJC Logistics

Owner-operator trucking logistics app: a mobile app (Expo) for the owner and
drivers, plus a web back-office dashboard (Next.js), backed by a shared
Supabase project.

See `docs/superpowers/specs/2026-09-09-djrjc-logistics-v1-design.md` for the
full v1 design.

## Status

Foundation complete: GitHub repo (public — required to unblock Vercel Hobby-plan
deployment; no secrets are committed, all credentials live in Vercel
environment variables), Supabase project (schema + RLS for
profiles/trucks/loads/expenses), and a Vercel deployment verified to read
from Supabase.

Live: https://djrjc-logistics-web.vercel.app

No user-facing features yet — see the spec for what's next: web dashboard
(auth, loads, drivers/trucks, Amazon Relay CSV import, expenses) and the
Expo mobile app, each as their own implementation plan.

## Layout

- `web/` — Next.js back-office dashboard, deployed to Vercel
- `mobile/` — Expo app for owner/drivers (added in a later plan)
- `supabase/migrations/` — database schema, applied to the hosted Supabase
  project
