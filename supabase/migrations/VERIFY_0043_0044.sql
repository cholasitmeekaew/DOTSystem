-- =============================================================
-- VERIFY 0043-0044 — รันหลัง apply migration
-- =============================================================
-- ทุกข้อควรเป็น ✓ ถ้าเจอ ✘ แปลว่ายังรั่วอยู่ ห้ามปิดระบบที่เปิดสาธารณะ
-- =============================================================

with checks as (
  /* 1. ตารางข้อมูลเข้าระบนต้องอยู่ใน schema private */
  select '1. มีตาราง private.officer_credentials' as test,
         (select count(*) from information_schema.tables
          where table_schema = 'private' and table_name = 'officer_credentials') = 1 as ok

  /* 2. ต้องไม่มีตารางข้อมูลเข้าระบบใน schema public */
  union all
  select '2. officers ไม่มีคอลัมน์ password_hash',
         not exists (
           select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'officers'
             and column_name = 'password_hash'
         )

  union all
  select '3. officers ไม่มีคอลัมน์ username',
         not exists (
           select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'officers'
             and column_name = 'username'
         )

  /* 4. ย้ายข้อมูลครบทุกคน */
  union all
  select '4. ย้าย credentials ครบทุกคน (ต้องมีอย่างน้อย 1 คน)',
         (select count(*) from private.officer_credentials) >= 1

  /* 5. ไม่มีข้อมูลเข้าระบบหลงเหลือใน public.officers */
  union all
  select '5. ไม่มี hash หลงเหลือใน public.officers',
         not exists (select 1 from public.officers where password_hash is not null)

  /* 6. RPC เข้าระบบต้องไม่ส่ง hash กลับ */
  union all
  select '6. login_officer คืนข้อมูลไม่มี hash',
         not exists (
           select 1 from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'login_officer'
             and pg_get_function_result(p.oid) like '%hash%'
         )

  /* 7. anon เข้าถึง schema private ไม่ได้ */
  union all
  select '7. anon ไม่มีสิทธิ์ใช้ schema private',
         not has_schema_privilege('anon', 'private', 'USAGE')
         and not has_schema_privilege('public', 'private', 'USAGE')

  /* 8. citizen notes ต้องอยู่ใน private และหายจาก public */
  union all
  select '8. มีตาราง private.citizen_notes',
         (select count(*) from information_schema.tables
          where table_schema = 'private' and table_name = 'citizen_notes') = 1

  union all
  select '9. citizens ไม่มีคอลัมน์ notes',
         not exists (
           select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'citizens'
             and column_name = 'notes'
         )

  /* 10. notes เดิมต้องย้ายมาครบ */
  union all
  select '10. ย้าย notes เดิมเข้า private แล้ว',
         not exists (
           select 1 from private.citizen_notes where notes is null
         )

  /* 11. RPC ที่แก้รหัสผ่านต้องมีอยู่ครบ */
  union all
  select '11. มี RPC เข้าระบบครบ (login/change/admin_set/admin_create)',
         (select count(*) from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proname in ('login_officer','change_own_password','admin_set_password','admin_create_credentials')
         ) = 4

  /* 12. citizen notes RPC */
  union all
  select '12. มี RPC บันทึกภายใน (get/set)',
         (select count(*) from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proname in ('get_citizen_note','set_citizen_note')
         ) = 2
)
select test as "ตรวจสอบ", case when ok then '✓ ผ่าน' else '✘ ไม่ผ่าน' end as "ผล"
from checks
order by 1;

-- =============================================================
-- ⚠️ ทดสอบจริงว่า anon อ่านไม่ได้ (สำคัญที่สุด)
-- ---------------------------------------------------------------
-- รัน 2 บรรทัดนี้จากเบราว์เซอร์หรือ client ที่ใช้ anon key
--
--   supabase.from('officers').select('*')            → ต้องไม่มี password_hash
--   supabase.from('private.officer_credentials')     → ต้อง error (มองไม่เห็น)
--
-- ถ้ายังเห็น hash → ยังไม่ได้ apply migration 0043
-- =============================================================
