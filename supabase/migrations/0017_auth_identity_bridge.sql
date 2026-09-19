-- =============================================================
-- DOTSystem — Supabase Auth identity bridge
-- Migration 0017
--
-- This migration prepares the database for trusted Supabase Auth
-- without breaking the current localStorage login yet.
--
-- Next step: create/link one auth.users account per officer and set
-- officers.auth_user_id. After that, RPCs can use auth.uid() instead
-- of trusting officer_id/rank values sent by the browser.
-- =============================================================

alter table public.officers
  add column if not exists auth_user_id uuid;

create unique index if not exists officers_auth_user_id_uidx
  on public.officers(auth_user_id)
  where auth_user_id is not null;

-- Return the currently authenticated officer from the trusted
-- Supabase Auth identity. Returns no row for anonymous users or when
-- the auth account has not been linked yet.
drop function if exists public.get_current_officer();

create or replace function public.get_current_officer()
returns table (
  id uuid,
  username text,
  name text,
  rank text,
  department text,
  status text,
  is_on_duty boolean,
  photo_url text,
  auth_user_id uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select
    o.id,
    o.username,
    o.name,
    o.rank,
    o.department,
    o.status,
    o.is_on_duty,
    o.photo_url,
    o.auth_user_id
  from public.officers o
  where o.auth_user_id = auth.uid()
    and o.status = 'active';
$$;

revoke all on function public.get_current_officer() from public;
grant execute on function public.get_current_officer() to authenticated;

-- Trusted authorization helpers for the next RPC migration.
drop function if exists public.current_officer_id();
create or replace function public.current_officer_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select o.id
  from public.officers o
  where o.auth_user_id = auth.uid()
    and o.status = 'active'
  limit 1;
$$;

revoke all on function public.current_officer_id() from public;
grant execute on function public.current_officer_id() to authenticated;

drop function if exists public.current_officer_rank();
create or replace function public.current_officer_rank()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select o.rank
  from public.officers o
  where o.auth_user_id = auth.uid()
    and o.status = 'active'
  limit 1;
$$;

revoke all on function public.current_officer_rank() from public;
grant execute on function public.current_officer_rank() to authenticated;

-- Prevent clients from setting auth_user_id directly through normal
-- table writes once RLS is restored. The actual linking will be done
-- by a trusted admin/server-side operation in the next phase.
comment on column public.officers.auth_user_id is
  'Trusted Supabase Auth user UUID. Must only be populated by a trusted admin/server-side operation.';
