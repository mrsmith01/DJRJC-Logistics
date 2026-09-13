-- The partial unique index on external_load_id cannot serve as an ON CONFLICT
-- arbiter for `.upsert(..., { onConflict: 'external_load_id' })`, since
-- Supabase's upsert helper cannot express the index's WHERE predicate in the
-- ON CONFLICT clause. Postgres rejects such upserts with 42P10 ("there is no
-- unique or exclusion constraint matching the ON CONFLICT specification").
--
-- Replace the partial index with a plain unique index. A plain unique index
-- on a nullable column still permits multiple NULLs (NULLs are never
-- considered equal to each other in a unique index), so this is a no-op for
-- rows with a null external_load_id. The loads table has 0 rows at the time
-- of this migration, so this is a free, lossless change.
drop index if exists public.loads_external_load_id_key;
create unique index loads_external_load_id_key on public.loads (external_load_id);
