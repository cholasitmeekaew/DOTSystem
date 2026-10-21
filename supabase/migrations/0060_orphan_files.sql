-- =============================================================
-- 0060: RPC หา "ไฟล์กำพร้า" ใน Storage (ไม่มี URL อ้างอิงใน DB)
-- =============================================================
-- ไฟล์กำพร้า = ไฟล์ที่อยู่ใน storage.objects แต่ไม่มีตารางไหนอ้างถึง
-- เกิดจาก: ลบแถว/ล้างคอลัมน์ใน DB แล้ว แต่ไฟล์ยังค้างใน bucket
--          (เช่น cleanup รอบก่อน null service_records.evidence_url
--           แต่ลบไฟล์จริงไม่สำเร็จ)
--
-- ใช้ในหน้า Storage: แสดงจำนวน + ขนาด + ปุ่มลบเพื่อคืนพื้นที่
-- =============================================================

create or replace function public.get_orphan_files()
returns table (
  bucket_id text,
  name text,
  file_size bigint
)
language sql
security definer
set search_path = public
as $$
  with refs as (
    select substring(photo_url from '/object/public/([^?]+)') as fp
      from public.officers where photo_url is not null and photo_url <> ''
    union all
    select substring(evidence_url from '/object/public/([^?]+)')
      from public.service_records where evidence_url is not null and evidence_url <> ''
    union all
    select substring(image_url from '/object/public/([^?]+)')
      from public.announcements where image_url is not null and image_url <> ''
    union all
    select substring(image_url from '/object/public/([^?]+)')
      from public.vehicles where image_url is not null and image_url <> ''
    union all
    select substring(image_url from '/object/public/([^?]+)')
      from public.emergency_reports where image_url is not null and image_url <> ''
    union all
    select substring(evidence_url from '/object/public/([^?]+)')
      from public.work_report_cases where evidence_url is not null and evidence_url <> ''
    union all
    select substring(evidence_url from '/object/public/([^?]+)')
      from public.complaints where evidence_url is not null and evidence_url <> ''
    union all
    select substring(content from '/object/public/([^?]+)')
      from public.manual_blocks where type = 'image' and content is not null and content <> ''
  )
  select
    o.bucket_id,
    o.name,
    coalesce((o.metadata->>'size')::bigint, 0) as file_size
  from storage.objects o
  where (o.bucket_id || '/' || o.name) not in (
    select fp from refs where fp is not null
  )
  order by 3 desc;
$$;

grant execute on function public.get_orphan_files() to anon, authenticated;

-- ตรวจสอบ
select bucket_id, count(*) as ไฟล์กำพร้า, sum(file_size) as ขนาดรวม
from public.get_orphan_files()
group by bucket_id
order by ขนาดรวม desc;