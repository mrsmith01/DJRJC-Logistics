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
