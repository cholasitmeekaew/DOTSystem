-- =====================================================================
-- วินิจฉัยทำไมคะแนนสะสมไม่เพิ่ม / ไม่รีเซ็ต
-- วางใน SQL Editor → Run (คืนผลเป็นตารางเดียว)
-- =====================================================================

select t.group_no, t.item, t.detail
from (
  -- 1) RLS เปิดอยู่ไหม
  select 1 as group_no, 'RLS บนตาราง officers' as item,
         case when c.relrowsecurity then 'เปิดอยู่' else 'ปิดอยู่' end as detail
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'officers'

  union all
  -- 2) policy ทั้งหมดบน officers
  select 2, 'policy: ' || policyname, cmd || ' | using=' || coalesce(qual, 'null') || ' | check=' || coalesce(with_check, 'null')
  from pg_policies where tablename = 'officers' order by policyname

  union all
  -- 3) grant ระดับคอลัมน์ที่อนุญาตให้ UPDATE
  select 3, 'grant update column: ' || column_name, 'grantee=' || grantee || ' | privilege=' || privilege_type
  from information_schema.column_privileges
  where table_name = 'officers' and privilege_type = 'UPDATE'
    and column_name in ('points', 'points_period', 'points_log', 'password_hash', 'is_on_duty', 'status')
  order by column_name, grantee

  union all
  -- 4) สรุปคะแนนจริง
  select 4, 'สรุปคะแนนสะสม',
         'ทั้งหมด ' || count(*)
         || ' | มีคะแนน>0 ' || count(*) filter (where coalesce(points,0) > 0)
         || ' | เป็น 0 ' || count(*) filter (where coalesce(points,0) = 0) as detail
  from officers where status <> 'deleted'

  union all
  -- 5) งวดของ points_period
  select 5, 'points_period: ' || coalesce(points_period, '(null)'), count(*)::text || ' คน'
  from officers where status <> 'deleted'
  group by points_period order by points_period nulls last

  union all
  -- 6) มี points_log กี่คนที่มีประวัติ
  select 6, 'มีประวัติคะแนน (points_log)',
       count(*) filter (where coalesce(jsonb_array_length(points_log),0) > 0)::text || ' คน'
                 || ' | ว่างเปล่า ' || count(*) filter (where coalesce(jsonb_array_length(points_log),0) = 0)::text || ' คน'
  from officers where status <> 'deleted'

  union all
  -- 7) current_rank() คืออะไร (ต้องเป็น NULL เพราะระบบไม่ได้ login ผ่าน Supabase Auth)
  select 7, 'current_rank()', coalesce(public.current_rank()::text, 'NULL ← policy ที่ใช้ค่านี้จะไม่ผ่าน')

  union all
  -- 8) สวิตช์คะแนนอัตโนมัติ
  select 8, 'auto_points_enabled',
         coalesce((select auto_points_enabled::text from system_settings where id = 1), 'ไม่มีคอลัมน์')
) t
order by t.group_no, t.item;
