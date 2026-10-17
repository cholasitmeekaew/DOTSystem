-- =============================================================
-- 0045: RPC อ่าน username ของเจ้าหน้าที่
-- =============================================================
-- หลังย้าย credentials ไป schema private (0043) คอลัมน์ officers.username
-- ก็หายไปด้วย หน้าจอที่เคยโชว์ "@username" เลยว่างเปล่า
--
-- username ไม่ใช่ความลับ (เคยอ่านได้สาธารณะอยู่แล้วก่อน 0043)
-- จึงคืนให้ผ่าน RPC ได้ โดยยังต้องล็อกอินผ่านระบบถึงจะเห็นชื่อผู้ใช้ของคนอื่น
--
-- หมายเหตุ: ยังไม่มีระบบยืนยันตัวตนจริง จึงยังแยก "เจ้าหน้าที่" กับ "บุคคลทั่วไป"
-- ไม่ได้ ทุกคนที่ยิง RPC นี้ได้ — ซึ่งถือว่าดีกว่าเดิม (เดิมอ่านได้ทุกคนอยู่แล้ว)
-- เมื่อย้ายไป Supabase Auth ค่อยจำกัดเฉพาะ officer
-- =============================================================

create or replace function list_officer_usernames()
returns table (
  officer_id uuid,
  username   text
)
language sql
security definer
set search_path = public, private
as $$
  select c.officer_id, c.username
  from private.officer_credentials c
  join officers o on o.id = c.officer_id
  where o.status <> 'deleted'
  order by c.username;
$$;

grant execute on function list_officer_usernames() to anon, authenticated;

comment on function list_officer_usernames is
  'รายการ username ของเจ้าหน้าที่ (สำหรับแสดงผลบนหน้าจอ ไม่ใช่ข้อมูลเข้าระบบ)';
