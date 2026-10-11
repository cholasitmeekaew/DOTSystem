-- =====================================================================
-- ตรวจสอบ migration 0027–0030 ว่าครบไหม (query เดียว ผลเดียว)
-- Supabase SQL Editor → วางทั้งไฟล์ → Run
-- ทุกแถวต้องเป็น PASS ถ้ามี FAIL จะเห็นว่าอะไรยังไม่ครบ
-- =====================================================================

select t.item, t.status,
  case when t.status = 'PASS' then '✔' else '✘ ยังไม่ครบ' end as result
from (
  select '1. ตาราง officer_generations' as item,
         case when to_regclass('public.officer_generations') is not null then 'PASS' else 'FAIL' end as status
  union all select '2. ตาราง leave_quotas',
         case when to_regclass('public.leave_quotas') is not null then 'PASS' else 'FAIL' end
  union all select '3. ตาราง duty_schedules',
         case when to_regclass('public.duty_schedules') is not null then 'PASS' else 'FAIL' end
  union all select '4. ตาราง schedule_overrides',
         case when to_regclass('public.schedule_overrides') is not null then 'PASS' else 'FAIL' end
  union all select '5. ตาราง points_award_marks',
         case when to_regclass('public.points_award_marks') is not null then 'PASS' else 'FAIL' end

  union all select '6. officers.generation + officers.sort_order',
         case when (select count(*) from information_schema.columns
                    where table_name='officers' and column_name in ('generation','sort_order')) = 2
              then 'PASS' else 'FAIL' end
  union all select '7. work_reports 6 คอลัมน์ตรวจรายงาน',
         case when (select count(*) from information_schema.columns
                    where table_name='work_reports'
                      and column_name in ('status','reviewed_by','reviewed_by_name',
                                          'reviewed_at','review_note','reviewed_points')) = 6
              then 'PASS' else 'FAIL' end
  union all select '8. officer_leaves.days',
         case when exists (select 1 from information_schema.columns
                           where table_name='officer_leaves' and column_name='days')
              then 'PASS' else 'FAIL' end
  union all select '9. system_settings.auto_points_enabled',
         case when exists (select 1 from information_schema.columns
                           where table_name='system_settings' and column_name='auto_points_enabled')
              then 'PASS' else 'FAIL' end
  union all select '10. duty_schedules.required_officers',
         case when exists (select 1 from information_schema.columns
                           where table_name='duty_schedules' and column_name='required_officers')
              then 'PASS' else 'FAIL' end

  union all select '11. UNIQUE เดิมถูกลบแล้ว (หลายคน/กะ)',
         case when (select count(*) from pg_indexes
                    where tablename in ('duty_schedules','schedule_overrides')
                      and indexname in ('duty_schedules_weekday_shift_uidx',
                                        'schedule_overrides_date_shift_uidx')) = 0
              then 'PASS' else 'FAIL' end
  union all select '12. UNIQUE ใหม่ต่อคน มีครบ 2 ตัว',
         case when (select count(*) from pg_indexes
                    where indexname in ('duty_schedules_slot_officer_uidx',
                                        'schedule_overrides_slot_officer_uidx')) = 2
              then 'PASS' else 'FAIL' end

  union all select '13. กะย้ายเป็น s1/s2 หมดแล้ว',
         case when (select coalesce(sum(c),0) from (
                      select count(*) as c from duty_schedules    where shift_code in ('day','night')
                      union all
                      select count(*)    from schedule_overrides where shift_code in ('day','night')
                    ) x) = 0
              then 'PASS' else 'FAIL' end

  union all select '14. complaints รับสถานะ verified',
         case when exists (select 1 from pg_constraint
                           where conname='complaints_status_check'
                             and pg_get_constraintdef(oid) like '%verified%')
              then 'PASS' else 'FAIL' end

  union all select '15. policy system_settings เหลือ read+update',
         case when (select count(*) from pg_policies
                    where tablename='system_settings'
                      and policyname in ('system_settings read','system_settings update')) = 2
              then 'PASS' else 'FAIL' end
  union all select '16. ไม่มี policy เปิด INSERT ที่ system_settings',
         case when (select count(*) from pg_policies
                    where tablename='system_settings' and cmd='INSERT') = 0
              then 'PASS' else 'FAIL' end

  union all select '17. มีแถว system_settings id=1',
         case when exists (select 1 from system_settings where id=1) then 'PASS' else 'FAIL' end
  union all select '18. ค่า auto_points_enabled ปัจจุบัน',
         case when (select auto_points_enabled::text from system_settings where id=1) = 'true'
              then 'PASS' else 'FAIL' end
) t
order by t.item;
