-- =============================================================
-- 0055: ระบบพื้นที่จัดเก็บใหม่ (Storage Guard System)
-- =============================================================
-- สร้างใหม่ทั้งหมด แยกขาดจากระบบเก่า (ตัด RPC/ตารางเดิมออกหมดแล้ว)
--
-- 3 ฟีเจอร์:
--   A) Storage Chart & Breakdown  → storage_quota() + storage_module_stats()
--   B) Safe Cleanup & Quarantine  → storage_all_files() + storage_module_refs()
--                                   + storage_quarantine_files() + storage_log_quarantine()
--   C) Data Protection Guard      → query แยกต่อโมดูล (ไม่มี loop ข้ามโมดูลใน DB)
--
-- หลักการสำคัญ:
--   - เปอร์เซ็นต์พื้นที่คำนวณจาก Quota จริงในตาราง storage_quota (ไม่ hardcode ฝั่งเว็บ)
--   - storage_module_stats() รับ 1 โมดูล คืนค่าของโมดูลนั้นเท่านั้น
--   - ไฟล์ที่กักกันอยู่ในโฟลเดอร์ 'quarantine-trash/' เท่านั้น
-- =============================================================

-- ── 0) เคลียร์ RPC เก่าของระบบ Storage เดิม (ถ้ามี) ──
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'get_storage_usage', 'get_storage_file_stats', 'get_module_image_stats',
        'get_orphan_files', 'get_module_file_stats', 'get_module_storage_stats',
        'list_module_files'
      )
  loop
    execute 'drop function if exists ' || f.sig || ' cascade';
  end loop;
end;
$$;

drop table if exists public.storage_module_sources cascade;
drop table if exists public.storage_module_locations cascade;
drop table if exists public.storage_module_registry cascade;

-- ── 1) ตาราง Quota (แหล่งความจริงของโควตา) ──
create table if not exists public.storage_quota (
  id          smallint primary key default 1,
  quota_bytes bigint not null check (quota_bytes > 0),
  updated_at  timestamptz not null default now()
);

insert into public.storage_quota (id, quota_bytes)
values (1, 1073741824)          -- Supabase Free tier = 1 GB (แก้ได้ในตาราง)
on conflict (id) do nothing;

-- ── 2) ทะเบียนโมดูล (1 แถว/โมดูล) ──
create table if not exists public.storage_module_registry (
  module_key   text primary key,
  module_label text not null,
  db_table     text,
  db_column    text,
  db_filter    text,
  sort_order   int not null default 0
);

-- ── 3) แหล่งไฟล์ของแต่ละโมดูล (bucket + pattern) ──
create table if not exists public.storage_module_sources (
  id           bigserial primary key,
  module_key   text not null references public.storage_module_registry(module_key) on delete cascade,
  bucket_id    text not null,
  path_pattern text not null,
  unique (module_key, bucket_id, path_pattern)
);

-- ── 4) บันทึกการกักกันไฟล์ ──
create table if not exists public.storage_quarantine_log (
  id              bigserial primary key,
  bucket_id       text not null,
  original_name   text not null,
  quarantine_name text not null,
  file_size       bigint not null default 0,
  quarantined_at  timestamptz not null default now()
);

-- ── 5) Seed โมดูล ──
insert into public.storage_module_registry
  (module_key, module_label, db_table, db_column, db_filter, sort_order)
values
  ('officers',     'เจ้าหน้าที่',        'officers',           'photo_url',    'status <> ''deleted''', 10),
  ('services',     'เคส / บริการ',        'service_records',    'evidence_url', null,                    20),
  ('work_reports', 'รายงานปฏิบัติงาน',     'work_report_cases',  'evidence_url', null,                    30),
  ('announcements','ประกาศ / ข่าวสาร',     'announcements',      'image_url',    null,                    40),
  ('complaints',   'ร้องเรียน',           'complaints',         'evidence_url', null,                    50),
  ('vehicles',     'ยานพาหนะ / ใบอนุญาต', 'vehicles',           'image_url',    null,                    60),
  ('emergency',    'แจ้งเหตุฉุกเฉิน',      'emergency_reports',  'image_url',    null,                    70),
  ('manual',       'คู่มือ',              'manual_blocks',      'content',      'type = ''image''',      80)
on conflict (module_key) do update set
  module_label = excluded.module_label,
  db_table     = excluded.db_table,
  db_column    = excluded.db_column,
  db_filter    = excluded.db_filter,
  sort_order   = excluded.sort_order;

-- ── 6) Seed แหล่งไฟล์ ──
insert into public.storage_module_sources (module_key, bucket_id, path_pattern)
values
  ('officers',      'officer-photos', '^officers/[^/]+$'),
  ('officers',      'dot-uploads',    '^officers/[^/]+$'),
  ('services',      'evidence',       '^evidence/[^/]+$'),
  ('services',      'dot-uploads',    '^evidence/[^/]+$'),
  ('services',      'evidence',       '^evidence/services/.*'),
  ('work_reports',  'evidence',       '^evidence/work_reports/.*'),
  ('announcements', 'announcements',  '^announcements/[^/]+$'),
  ('announcements', 'dot-uploads',    '^announcements/[^/]+$'),
  ('vehicles',      'vehicles',       '^vehicles/[^/]+$'),
  ('vehicles',      'dot-uploads',    '^vehicles/[^/]+$'),
  ('manual',        'manual',         '^manual/[^/]+$'),
  ('manual',        'dot-uploads',    '^manual/[^/]+$'),
  ('emergency',     'evidence',       '^evidence/emergency/.*')
on conflict (module_key, bucket_id, path_pattern) do nothing;

-- =============================================================
-- RPC: A) Chart & Breakdown
-- =============================================================

-- โควตา + ใช้ไปจริง (คำนวณจาก Storage จริง ไม่ hardcode)
create or replace function public.storage_quota()
returns table (quota_bytes bigint, used_bytes bigint)
language sql
security definer
set search_path = public
as $$
  select
    coalesce((select quota_bytes from public.storage_quota where id = 1), 1073741824),
    coalesce((select sum((o.metadata->>'size')::bigint) from storage.objects o), 0);
$$;

-- รายชื่อโมดูล (ให้เว็บยิงสถิติแยกทีละโมดูล)
create or replace function public.storage_modules()
returns table (module_key text, module_label text)
language sql
security definer
set search_path = public
as $$
  select module_key, module_label
  from public.storage_module_registry
  order by sort_order, module_key;
$$;

-- สถิติของโมดูลเดียวเท่านั้น (ไม่มี loop ข้ามโมดูล)
create or replace function public.storage_module_stats(p_module_key text)
returns table (
  module_key   text,
  module_label text,
  row_count    bigint,
  db_bytes     bigint,
  db_ref_count bigint,
  file_count   bigint,
  file_bytes   bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  rec    record;
  rc     bigint := 0;
  dbytes bigint := 0;
  dref   bigint := 0;
  fcount bigint := 0;
  fbytes bigint := 0;
  cond   text;
begin
  select * into rec
  from public.storage_module_registry r
  where r.module_key = p_module_key;

  if not found then
    return;
  end if;

  if rec.db_table is not null then
    cond := 'true';
    if rec.db_column is not null then
      cond := format('%I is not null and %I <> ''''', rec.db_column, rec.db_column);
      if rec.db_filter is not null and btrim(rec.db_filter) <> '' then
        cond := cond || ' and (' || rec.db_filter || ')';
      end if;
    elsif rec.db_filter is not null and btrim(rec.db_filter) <> '' then
      cond := '(' || rec.db_filter || ')';
    end if;

    execute format('select count(*) from public.%I where %s', rec.db_table, cond)
      into rc;

    if rec.db_column is not null then
      dref := rc;
    end if;

    execute format('select pg_total_relation_size(%L::regclass)', 'public.' || rec.db_table)
      into dbytes;
  end if;

  -- เฉพาะไฟล์ใน bucket/โฟลเดอร์ของโมดูลนี้
  select count(*), coalesce(sum((o.metadata->>'size')::bigint), 0)
    into fcount, fbytes
  from storage.objects o
  where exists (
    select 1
    from public.storage_module_sources s
    where s.module_key = rec.module_key
      and s.bucket_id  = o.bucket_id
      and o.name ~ s.path_pattern
  );

  module_key   := rec.module_key;
  module_label := rec.module_label;
  row_count    := coalesce(rc, 0);
  db_bytes     := coalesce(dbytes, 0);
  db_ref_count := coalesce(dref, 0);
  file_count   := coalesce(fcount, 0);
  file_bytes   := coalesce(fbytes, 0);
  return next;
end;
$$;

-- =============================================================
-- RPC: B) Safe Cleanup & Quarantine
-- =============================================================

-- ไฟล์ทั้งหมดใน Storage (ยกเว้นที่อยู่ในโฟลเดอร์กักกันแล้ว)
create or replace function public.storage_all_files()
returns table (
  bucket_id  text,
  file_name  text,
  file_size  bigint,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select o.bucket_id, o.name, coalesce((o.metadata->>'size')::bigint, 0), o.created_at
  from storage.objects o
  where o.name not like 'quarantine-trash/%'
  order by o.created_at;
$$;

-- path ที่โมดูลนี้ "อ้างถึง" ใน DB (ใช้ตรวจไฟล์กำพร้าแบบแยกโมดูล)
create or replace function public.storage_module_refs(p_module_key text)
returns table (bucket_id text, path text)
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
  v   text;
  u   text;
  b   text;
  p   text;
  cond text;
begin
  select * into rec from public.storage_module_registry r where r.module_key = p_module_key;
  if not found then return; end if;
  if rec.db_table is null or rec.db_column is null then return; end if;

  cond := format('%I is not null and %I <> ''''', rec.db_column, rec.db_column);
  if rec.db_filter is not null and btrim(rec.db_filter) <> '' then
    cond := cond || ' and (' || rec.db_filter || ')';
  end if;

  for v in execute format('select distinct %I from public.%I where %s',
                          rec.db_column, rec.db_table, cond)
  loop
    if position('/object/public/' in v) > 0 then
      u := substring(v from position('/object/public/' in v) + length('/object/public/'));
      b := split_part(u, '/', 1);
      p := substring(u from position('/' in u) + 1);
      if b <> '' and p <> '' and p <> u then
        bucket_id := b;
        path := p;
        return next;
      end if;
    end if;
  end loop;
end;
$$;

-- ไฟล์ที่อยู่ในโฟลเดอร์กักกัน
create or replace function public.storage_quarantine_files()
returns table (
  bucket_id  text,
  file_name  text,
  file_size  bigint,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select o.bucket_id, o.name, coalesce((o.metadata->>'size')::bigint, 0), o.created_at
  from storage.objects o
  where o.name like 'quarantine-trash/%'
  order by o.created_at;
$$;

-- บันทึกการย้ายเข้าโฟลเดอร์กักกัน
create or replace function public.storage_log_quarantine(
  p_bucket_id       text,
  p_original_name   text,
  p_quarantine_name text,
  p_file_size       bigint
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id bigint;
begin
  insert into public.storage_quarantine_log
    (bucket_id, original_name, quarantine_name, file_size)
  values
    (p_bucket_id, p_original_name, p_quarantine_name, coalesce(p_file_size, 0))
  returning id into new_id;
  return new_id;
end;
$$;

-- =============================================================
-- Grants
-- =============================================================
grant execute on function public.storage_quota()                                         to anon, authenticated;
grant execute on function public.storage_modules()                                       to anon, authenticated;
grant execute on function public.storage_module_stats(text)                              to anon, authenticated;
grant execute on function public.storage_all_files()                                     to anon, authenticated;
grant execute on function public.storage_module_refs(text)                               to anon, authenticated;
grant execute on function public.storage_quarantine_files()                              to anon, authenticated;
grant execute on function public.storage_log_quarantine(text, text, text, bigint)        to anon, authenticated;

-- =============================================================
-- ตรวจสอบ
-- =============================================================
select * from public.storage_quota();
select * from public.storage_modules();
