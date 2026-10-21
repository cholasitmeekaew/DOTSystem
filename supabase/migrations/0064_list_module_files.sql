-- =============================================================
-- 0064: list_module_files() — 列出 Storage ไฟล์รายโมดูล
-- =============================================================
-- ปัญหา: โหมด "ลบเฉพาะรูปภาพ" เดิมลบได้เฉพาะไฟล์ที่ URL ยังผูกอยู่ใน DB
--   ไฟล์ที่หลุดการผูก (orphan) ในบัคเก็ตของโมดูล จึงลบไม่ได้ → ขึ้น "0 แถว"
--
-- RPC นี้คืนรายชื่อไฟล์จริงใน Storage ของโมดูล (ตาม mapping 0063)
--   กรองตามช่วงวันที่ (created_at ของไฟล์) ได้
--   ให้ฝั่งเว็บเรียก storage.remove() ต่อ
--
-- คืน: bucket_id, name, file_size, uploaded_at
-- =============================================================

create or replace function public.list_module_files(
  p_module_key text,
  p_from date default null,
  p_to   date default null
)
returns table (
  bucket_id   text,
  name        text,
  file_size   bigint,
  uploaded_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    o.bucket_id,
    o.name,
    coalesce((o.metadata->>'size')::bigint, 0) as file_size,
    o.created_at as uploaded_at
  from storage.objects o
  where exists (
    select 1
    from public.storage_module_locations l
    where l.module_key = p_module_key
      and l.bucket_id  = o.bucket_id
      and o.name ~ l.path_pattern
  )
    and (p_from is null or o.created_at >= p_from)
    and (p_to   is null or o.created_at <  (p_to + interval '1 day'))
  order by o.created_at;
$$;

grant execute on function public.list_module_files(text, date, date) to anon, authenticated;

-- ── ตรวจสอบ ──
select * from public.list_module_files('work_reports');
