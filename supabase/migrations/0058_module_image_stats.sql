-- =============================================================
-- 0058: RPC สถิติรูปภาพรายโมดูล (นับจากตารางจริง ไม่แชร์ bucket)
-- =============================================================
-- ปัญหาเดิม:
--   หน้า Storage ดึงสถิติจาก storage.objects ราย bucket แล้วแปะให้โมดูล
--   ผลคือโมดูลที่ใช้ bucket เดียวกัน (services / work_reports / emergency
--   ใช้ 'evidence' ทั้งหมด) แสดงเลขเดียวกันมั่วซั่ว
--
-- วิธีใหม่:
--   นับ URL รูปจริง จากคอลัมน์รูปของ "ตารางในโมดูลนั้นๆ" เท่านั้น
--   แล้วจับคู่ URL → storage.objects เพื่อเอาขนาดไฟล์จริง
--   โมดูลหนึ่งๆ จึงแยกอิสระ ไม่แชร์ตัวเลขกัน
-- =============================================================

create or replace function public.get_module_image_stats()
returns table (
  module_key text,
  img_count bigint,
  img_bytes bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  pair record;
  q text;
  cnt bigint;
  byt bigint;
begin
  /* ── คู่ (โมดูล, ตาราง, คอลัมน์รูป, ตัดแถวลบแล้ว?) ──
       filter_deleted = true เมื่อตารางมีคอลัมน์ status และใช้ soft-delete
       เช่น officers: นับเฉพาะ status <> 'deleted' → ตรงกับหน้าจัดการจริง */
  for pair in
    select * from (values
      ('officers',     'officers',          'photo_url',    true),
      ('services',     'service_records',   'evidence_url', true),
      ('announcements','announcements',     'image_url',    false),
      ('vehicles',     'vehicles',          'image_url',    false),
      ('emergency',    'emergency_reports', 'image_url',    false),
      ('work_reports', 'work_report_cases', 'evidence_url', false),
      ('complaints',   'complaints',        'evidence_url', false)
    ) as v(module_key, tbl, col, filter_deleted)
  loop
    /* นับ URL ที่ไม่ว่าง + บวกขนาดไฟล์จริงจาก storage.objects
       URL รูปแบบ: .../storage/v1/object/public/<bucket>/<path>
       ตัด <bucket>/<path> ออกมาจับคู่กับ storage.objects */
    q := format(
      'select count(*)::bigint,
              coalesce(sum(
                (select (o.metadata->>''size'')::bigint
                 from storage.objects o
                 where o.bucket_id = split_part(u.fp, ''/'', 1)
                   and o.name = substring(u.fp from position(''/'' in u.fp) + 1))
              ), 0)::bigint
       from (
         select substring(%1$I from ''/object/public/([^?]+)'') as fp
         from public.%2$I
         where %1$I is not null and %1$I <> ''''%3$s
       ) u',
      pair.col, pair.tbl,
      case when pair.filter_deleted then ' and status <> ''deleted''' else '' end
    );
    execute q into cnt, byt;

    module_key := pair.module_key;
    img_count  := coalesce(cnt, 0);
    img_bytes  := coalesce(byt, 0);
    return next;
  end loop;

  /* ── โมดูลคู่มือ: รูปอยู่ใน manual_blocks.content (type='image') ── */
  execute $inner$
    select count(*)::bigint,
           coalesce(sum(
             (select (o.metadata->>'size')::bigint
              from storage.objects o
              where o.bucket_id = split_part(u.fp, '/', 1)
                and o.name = substring(u.fp from position('/' in u.fp) + 1))
           ), 0)::bigint
    from (
      select substring(content from '/object/public/([^?]+)') as fp
      from public.manual_blocks
      where type = 'image' and content is not null and content <> ''
    ) u
  $inner$ into cnt, byt;

  module_key := 'manual';
  img_count  := coalesce(cnt, 0);
  img_bytes  := coalesce(byt, 0);
  return next;
end;
$$;

grant execute on function public.get_module_image_stats() to anon, authenticated;


-- =============================================================
-- ตรวจสอบ
-- =============================================================
select * from public.get_module_image_stats() order by img_bytes desc;