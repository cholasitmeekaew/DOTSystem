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
--
-- ⚠ ไม่บังคับ UNIQUE
--   ข้อมูลจริงมีรหัสซ้ำอยู่แล้ว (DOT-03 สองคน) ถ้าใส่ unique index
--   สคริปต์ทั้งไฟล์จะ error และถูก rollback หมด → คอลัมน์จะไม่ถูกสร้างเลย
--   จึงใช้ index ธรรมดาแทน แล้วให้หัวหน้ากรมแก้รหัสซ้ำผ่านหน้าจัดการเจ้าหน้าที่
--   (คิวรายการที่ต้องแก้อยู่ท้ายไฟล์นี้)
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
-- ไม่ลบรหัสออกจากชื่อ — ปล่อยให้ตรวจทีละคน
-- ---------------------------------------------------------------
update public.officers
set officer_code = upper(substring(name from '^\s*([A-Za-z]+-\d+)\s'))
where officer_code is null
  and name ~ '^\s*[A-Za-z]+-\d+\s';


-- ---------------------------------------------------------------
-- บังคับรูปแบบ: อักษร-ตัวเลข เช่น CDT-01
-- (NULL ผ่าน เพราะคนที่ยังไม่กรอกรหัสยังว่างอยู่)
-- ---------------------------------------------------------------
alter table public.officers
  drop constraint if exists officers_officer_code_format;

alter table public.officers
  add constraint officers_officer_code_format
  check (officer_code is null or officer_code ~ '^[A-Za-z]+-[0-9]+$');


-- ---------------------------------------------------------------
-- ดัชนีธรรมดา (ไม่ unique — เพราะข้อมูลมีรหัสซ้ำอยู่แล้ว)
-- ใช้ค้นหา/กรองรายชื่อตามรหัส
-- ---------------------------------------------------------------
create index if not exists officers_officer_code_idx
  on public.officers (officer_code);


-- =============================================================
-- รายการที่หัวหน้ากรมต้องตรวจทาน
-- =============================================================

-- 1) รหัสซ้ำ — ต้องแก้ให้เหลือรหัสเดียวต่อหนึ่งคน
select
  officer_code,
  count(*) as จำนวนคน,
  string_agg(name, ' | ' order by sort_order) as ชื่อ
from public.officers
where status <> 'deleted' and officer_code is not null
group by officer_code
having count(*) > 1
order by officer_code;

-- 2) ยังไม่มีรหัส — ต้องกรอกเอง
select name, rank
from public.officers
where status <> 'deleted' and officer_code is null
order by sort_order, name;

-- 3) สรุป
select
  count(*)                                    as ทั้งหมด,
  count(officer_code)                         as มีรหัสแล้ว,
  count(*) filter (where officer_code is null) as ยังไม่มีรหัส
from public.officers
where status <> 'deleted';

-- =============================================================
-- หลังแก้รหัสซ้ำครบแล้ว ค่อยเปิดบังคับ UNIQUE:
--
--   create unique index if not exists officers_officer_code_uniq
--     on public.officers (officer_code)
--     where officer_code is not null and officer_code <> '';
--
-- (ยังไม่เปิดตอนนี้ เพราะถ้าเปิดแล้วมีรหัสซ้ำโดยไม่รู้ตัว
--  จะไม่สามารถเพิ่ม/แก้เจ้าหน้าที่ได้เลยจนกว่าจะแก้ให้หมด)
-- =============================================================