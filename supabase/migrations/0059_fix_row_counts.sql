-- =============================================================
-- 0059: แก้ get_storage_usage ให้ได้จำนวนแถว "จริง"
-- =============================================================
-- ปัญหา: เดิมใช้ c.reltuples ซึ่งเป็นค่าประมาณจาก ANALYZE
--   - ตารางที่ยังไม่เคย ANALYZE จะได้ -1 → หน้าเว็บโชว์ "-1", "-4"
--   - ตารางที่มีข้อมูลจริงก็ได้เลขประมาณ (เช่น 844 แต่จริง 794)
--
-- ใหม่: นับด้วย count(*) จริงทีละตาราง (ฐานข้อมูลมีขนาดเล็ก เร็วพอ)
-- =============================================================

create or replace function public.get_storage_usage()
returns table (
  table_name text,
  row_count bigint,
  table_bytes bigint,
  total_bytes bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n bigint;
begin
  for r in
    select
      c.relname::text as tname,
      pg_total_relation_size(c.oid) - pg_indexes_size(c.oid) as tbytes,
      pg_total_relation_size(c.oid) as total
    from pg_class c
    join pg_namespace nsp on nsp.oid = c.relnamespace
    where nsp.nspname = 'public'
      and c.relkind = 'r'
      and c.relname not like 'pg_%'
    order by pg_total_relation_size(c.oid) desc
  loop
    execute format('select count(*) from public.%I', r.tname) into n;

    table_name  := r.tname;
    row_count   := n;
    table_bytes := r.tbytes;
    total_bytes := r.total;
    return next;
  end loop;
end;
$$;

grant execute on function public.get_storage_usage() to anon, authenticated;

-- ตรวจสอบ: ต้องไม่มีค่าติดลบ
select * from public.get_storage_usage() limit 10;