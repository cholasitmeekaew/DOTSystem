-- =============================================================
-- 0050: รหัสเจ้าหน้าที่ (officer_code)
-- =============================================================
-- เดิมรหัสอยู่ปนในชื่อ เช่น "CDT-01 bunyasak82"
-- ตัดรหัสไม่ได้ → ค้นหา/อ้างอิง/แสดงผลทำได้ยาก
--
-- แยกเป็นคอลัมน์เฉพาะ ชื่อเก็บแค่ชื่อจริง
--
-- ⚠ ข้อมูลชื่อเดิมไม่ถูกแก้อัตโนมัติ
--   เพราะ "CDT-01 bunyasak82" อาจตั้งใจให้เป็นชื่อเต็ม
--   ต้องให้หัวหน้ากรมตรวจทานชอบก่อนแยก
-- =============================================================

alter table public.officers
  add column if not exists officer_code text;

comment on column public.officers.officer_code is
  'รหัสเจ้าหน้าที่ เช่น CDT-01, DTI-02 (แยกจากชื่อ)';


-- ---------------------------------------------------------------
-- เติมรหัสให้เจ้าหน้าที่ที่ยังไม่มี
--
-- ดึงจากชื่อเดิม เฉพาะที่หน้าตามด้วยรหัสลักษณะ XXX-99
-- เช่น "CDT-01 bunyasak82" → "CDT-01"
--
-- ถ้าชื่อไม่มีรหัส จะได้ NULL แล้วหัวหน้ากรมกรอกเอง
-- ---------------------------------------------------------------
update public.officers
set officer_code = upper(substring(name from '^\s*([A-Za-z]+-\d+)\s'))
where officer_code is null
  and name ~ '^\s*[A-Za-z]+-\d+\s';


-- ---------------------------------------------------------------
-- ป้องกันรหัสซ้ำ (เว้นว่างได้ เพราะคนใหม่ยังไม่ได้กรอก)
-- ---------------------------------------------------------------
create unique index if not exists officers_officer_code_uniq
  on public.officers (officer_code)
  where officer_code is not null and officer_code <> '';

-- บังคับรูปแบบ: อักษร-ตัวเลข เช่น CDT-01
alter table public.officers
  drop constraint if exists officers_officer_code_format;

alter table public.officers
  add constraint officers_officer_code_format
  check (officer_code is null or officer_code ~ '^[A-Za-z]+-[0-9]+$');


-- ---------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------
select
  count(*)                                              as ทั้งหมด,
  count(officer_code)                                   as มีรหัสแล้ว,
  count(*) filter (where officer_code is null)           as ยังไม่มีรหัส
from public.officers
where status <> 'deleted';

select name, officer_code
from public.officers
where officer_code is null and status <> 'deleted'
order by name;