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
