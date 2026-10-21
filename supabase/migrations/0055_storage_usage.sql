-- =============================================================
-- 0055: RPC คำนวณพื้นที่จัดเก็บ (Storage Usage)
-- =============================================================
-- คืนรายการตารางทุกตารางใน public schema พร้อม:
--   - จำนวนแถว
--   - ขนาดตาราง (data)
--   - ขนาดรวม (data + indexes)
--
-- เรียกจาก frontend:
--   supabase.rpc('get_storage_usage')
-- =============================================================

create or replace function public.get_storage_usage()
returns table (
  table_name text,
  row_count bigint,
  table_bytes bigint,
  total_bytes bigint
)
language sql
security definer
set search_path = public
as $$
  select
    c.relname::text                              as table_name,
    c.reltuples::bigint                          as row_count,
    pg_total_relation_size(c.oid) - pg_indexes_size(c.oid) as table_bytes,
    pg_total_relation_size(c.oid)                as total_bytes
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and c.relname not like 'pg_%'
  order by pg_total_relation_size(c.oid) desc;
$$;

grant execute on function public.get_storage_usage() to anon, authenticated;


-- =============================================================
-- ตรวจสอบ
-- =============================================================
select * from public.get_storage_usage() limit 10;