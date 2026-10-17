-- =============================================================
-- ตรวจว่าข้อมูลเข้าระบบย้ายครบหรือยัง
-- ⚠ query นี้ต้องรันเป็น postgres / service_role ใน SQL editor
--    ห้ามรันจาก anon key
-- =============================================================
-- ตั้งใจไม่แสดง password_hash เพื่อไม่ให้หลุดอีก
-- =============================================================

select
  'จำนวนบัญชีที่ย้ายแล้ว' as รายการ,
  count(*)::text as ค่า
from private.officer_credentials

union all
select 'เจ้าหน้าที่ที่ยังใช้งานได้', count(*)::text
from officers
where status not in ('deleted','suspended')

union all
select '⚠ บัญชีที่เข้าระบบไม่ได้ (ยังไม่มี credentials)', count(*)::text
from officers o
where o.status not in ('deleted','suspended')
  and not exists (select 1 from private.officer_credentials c where c.officer_id = o.id)

union all
select 'บันทึกภายในประชาชนที่ย้ายแล้ว', count(*)::text
from private.citizen_notes

order by 1;

-- =============================================================
-- ถ้า "บัญชีที่เข้าระบบไม่ได้" > 0
-- รันคำสั่งนี้เพื่อสร้าง credentials ให้คนเหล่านั้น
-- (ใช้ชื่อ username เดิมที่ตั้งไว้)
-- =============================================================
-- insert into private.officer_credentials (officer_id, username, password_hash)
-- select o.id, lower(o.name), 'ใส่_HASH_SHA256_ตรงนี้'
-- from officers o
-- where not exists (
--   select 1 from private.officer_credentials c where c.officer_id = o.id
-- );
