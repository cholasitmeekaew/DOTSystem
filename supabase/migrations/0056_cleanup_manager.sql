-- =============================================================
-- 0056: ระบบจัดการลบข้อมูล (Data Cleanup Manager)
-- =============================================================
-- เพิ่ม:
--   1) โหมดลบตามช่วงวันที่ + เลือกโมดูล (Auto-Detect)
--   2) ล็อกโมดูลที่เชื่อมสถิติ/คะแนน (stats_linked) → ลบได้เฉพาะไฟล์รูปภาพ
--      ห้ามลบ Row หรือข้อความใน Database เด็ดขาด
--   3) โมดูลทั่วไป เลือกได้: ลบเฉพาะรูปภาพ หรือ ลบทั้งหมด (Purge)
--
-- ความปลอดภัย:
--   - storage_purge_module() จะ raise exception ถ้าโมดูลเป็น stats_linked
--   - ต้องระบุช่วงวันที่ (ห้าม purge ทั้งตารางโดยไม่ระบุช่วง)
--   - ไฟล์ที่อยู่ใน 'quarantine-trash/' ไม่ถูกแตะโดยฟังก์ชันในไฟล์นี้
-- =============================================================

-- ── 1) เพิ่มคอลัมน์กำกับในทะเบียนโมดูล ──
alter table public.storage_module_registry
  add column if not exists stats_linked boolean not null default false;
alter table public.storage_module_registry
  add column if not exists date_column text;

-- ── 2) ตั้งค่า: โมดูลที่เชื่อมสถิติ/คะแนน = ล็อก (image only) ──
update public.storage_module_registry set date_column = 'created_at', stats_linked = true  where module_key = 'officers';
update public.storage_module_registry set date_column = 'created_at', stats_linked = true  where module_key = 'services';
update public.storage_module_registry set date_column = 'created_at', stats_linked = true  where module_key = 'work_reports';
update public.storage_module_registry set date_column = 'created_at', stats_linked = true  where module_key = 'complaints';
update public.storage_module_registry set date_column = 'created_at', stats_linked = false where module_key = 'announcements';
update public.storage_module_registry set date_column = 'created_at', stats_linked = false where module_key = 'vehicles';
update public.storage_module_registry set date_column = 'created_at', stats_linked = false where module_key = 'emergency';
update public.storage_module_registry set date_column = 'updated_at', stats_linked = false where module_key = 'manual';

-- ── 3) storage_modules() เพิ่ม stats_linked + date_column ──
--    (เปลี่ยน return type → ต้อง drop ก่อน)
drop function if exists public.storage_modules();
create function public.storage_modules()
returns table (
  module_key   text,
  module_label text,
  stats_linked boolean,
  date_column  text
)
language sql
security definer
set search_path = public
as $$
  select module_key, module_label, stats_linked, date_column
  from public.storage_module_registry
  order by sort_order, module_key;
$$;

-- ── 4) ไฟล์ใน Storage ของโมดูลนี้ ตามช่วงวันที่ (ของไฟล์) ──
create or replace function public.storage_module_files(
  p_module_key text,
  p_from       date default null,
  p_to         date default null
)
returns table (
  bucket_id  text,
  file_name  text,
  file_size  bigint,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select o.bucket_id, o.name, coalesce((o.metadata->>'size')::bigint, 0), o.created_at
  from storage.objects o
  where o.name not like 'quarantine-trash/%'
    and (p_from is null or o.created_at::date >= p_from)
    and (p_to   is null or o.created_at::date <= p_to)
    and exists (
      select 1
      from public.storage_module_sources s
      where s.module_key = p_module_key
        and s.bucket_id  = o.bucket_id
        and o.name ~ s.path_pattern
    )
  order by o.created_at;
end;
$$;

-- ── 5) จำนวนแถวใน DB ของโมดูลนี้ ตามช่วงวันที่ ──
create or replace function public.storage_module_row_count(
  p_module_key text,
  p_from       date default null,
  p_to         date default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  rec  record;
  cond text;
  n    bigint;
begin
  select * into rec from public.storage_module_registry r where r.module_key = p_module_key;
  if not found or rec.db_table is null then
    return 0;
  end if;

  cond := 'true';
  if rec.db_column is not null then
    cond := cond || format(' and %I is not null and %I <> ''''', rec.db_column, rec.db_column);
  end if;
  if rec.db_filter is not null and btrim(rec.db_filter) <> '' then
    cond := cond || ' and (' || rec.db_filter || ')';
  end if;
  if rec.date_column is not null then
    if p_from is not null then
      cond := cond || format(' and %I::date >= %L', rec.date_column, p_from);
    end if;
    if p_to is not null then
      cond := cond || format(' and %I::date <= %L', rec.date_column, p_to);
    end if;
  end if;

  execute format('select count(*) from public.%I where %s', rec.db_table, cond) into n;
  return coalesce(n, 0);
end;
$$;

-- ── 6) Purge: ลบแถวใน DB (เฉพาะโมดูลทั่วไป) ──
create or replace function public.storage_purge_module(
  p_module_key text,
  p_from       date default null,
  p_to         date default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  rec  record;
  cond text;
  n    bigint;
begin
  select * into rec from public.storage_module_registry r where r.module_key = p_module_key;
  if not found then
    raise exception 'ไม่พบโมดูล %', p_module_key;
  end if;

  -- 🔒 ล็อกโมดูลที่เชื่อมสถิติ/คะแนน
  if rec.stats_linked then
    raise exception 'โมดูล "%" เชื่อมกับสถิติ/คะแนน — ลบได้เฉพาะไฟล์รูปภาพเท่านั้น', rec.module_label;
  end if;

  -- 🔒 ห้ามลบทั้งตารางโดยไม่ระบุช่วงวันที่
  if p_from is null and p_to is null then
    raise exception 'ต้องระบุช่วงวันที่ก่อนลบ (ห้ามลบทั้งตาราง)';
  end if;

  if rec.db_table is null then
    return 0;
  end if;

  cond := 'true';
  if rec.db_filter is not null and btrim(rec.db_filter) <> '' then
    cond := cond || ' and (' || rec.db_filter || ')';
  end if;
  if rec.date_column is not null then
    if p_from is not null then
      cond := cond || format(' and %I::date >= %L', rec.date_column, p_from);
    end if;
    if p_to is not null then
      cond := cond || format(' and %I::date <= %L', rec.date_column, p_to);
    end if;
  end if;

  execute format('delete from public.%I where %s', rec.db_table, cond);
  get diagnostics n = row_count;
  return coalesce(n, 0);
end;
$$;

-- ── 6.5) ปรับ semantics ของสถิติให้ตรง UI ──
--   row_count    = จำนวนแถวทั้งหมดของตาราง (ตาม filter)
--   db_ref_count = จำนวนแถวที่ "ผูกภาพ" (คอลัมน์รูปไม่ว่าง)
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
  select * into rec from public.storage_module_registry r where r.module_key = p_module_key;
  if not found then
    return;
  end if;

  if rec.db_table is not null then
    -- จำนวนแถวทั้งหมด (ตาม filter เท่านั้น)
    cond := 'true';
    if rec.db_filter is not null and btrim(rec.db_filter) <> '' then
      cond := '(' || rec.db_filter || ')';
    end if;
    execute format('select count(*) from public.%I where %s', rec.db_table, cond) into rc;

    -- จำนวนแถวที่ผูกภาพ
    if rec.db_column is not null then
      cond := format('%I is not null and %I <> ''''', rec.db_column, rec.db_column);
      if rec.db_filter is not null and btrim(rec.db_filter) <> '' then
        cond := cond || ' and (' || rec.db_filter || ')';
      end if;
      execute format('select count(*) from public.%I where %s', rec.db_table, cond) into dref;
    end if;

    execute format('select pg_total_relation_size(%L::regclass)', 'public.' || rec.db_table) into dbytes;
  end if;

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

-- ── 7) Grants ──
grant execute on function public.storage_modules()                              to anon, authenticated;
grant execute on function public.storage_module_files(text, date, date)         to anon, authenticated;
grant execute on function public.storage_module_row_count(text, date, date)     to anon, authenticated;
grant execute on function public.storage_purge_module(text, date, date)         to anon, authenticated;

-- ── 8) ตรวจสอบ ──
select module_key, module_label, stats_linked, date_column
from public.storage_modules();
