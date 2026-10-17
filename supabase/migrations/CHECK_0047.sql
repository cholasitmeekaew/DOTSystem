-- =============================================================
-- CHECK_0047 — ตรวจงานอัตโนมัติหักคะแนน
-- รันหลัง apply migration 0047
-- =============================================================


-- 1) ตารางตั้งค่ามีอยู่ และวันเริ่มนับเป็นวันที่ติดตั้ง
select
  '1. ตารางตั้งค่า'                          as ตรวจสอบ,
  case when count(*) = 1 then '✓ ผ่าน' else '✘ ไม่ผ่าน' end as ผล,
  'เริ่มหักตั้งแต่ ' || penalty_start_date::text
    || ' · ย้อนหลังไม่เกิน ' || lookback_days || ' วัน' as รายละเอียด
from public.pps_penalty_config
where id = 1;


-- 2) ฟังก์ชันที่ต้องมี ครบ 5 ตัว
select
  '2. ฟังก์ชันครบ' as ตรวจสอบ,
  case when count(*) = 5 then '✓ ผ่าน' else '✘ ไม่ผ่าน' end as ผล,
  'ต้องการ 5 / พบ ' || count(*) as รายละเอียด
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'run_pps_daily_sweep', 'pps_effective_cutoff',
    'pps_award', 'pps_auto_points_enabled', 'pps_week_start'
  );


-- 3) งาน cron ถูกตั้งและเปิดใช้งาน
select
  '3. งาน cron' as ตรวจสอบ,
  case when count(*) = 1 then '✓ ผ่าน' else '✘ ไม่ผ่าน' end as ผล,
  coalesce(string_agg(
    'ตารางเวลา ' || schedule || ' · รันล่าสุด ' || coalesce(last_run::text, 'ยังไม่เคยรัน')
    || ' · ครั้งถัดไป ' || coalesce(next_run::text, '-'),
    ' | '
  ), 'ไม่พบงาน') as รายละเอียด
from cron.job
where jobname = 'pps-daily-sweep' and active;


-- 4) วันตัดหลังที่จะใช้จริง — ต้องไม่เก่ากว่าวันเริ่มนับ
select
  '4. วันตัดหลัง' as ตรวจสอบ,
  case
    when public.pps_effective_cutoff() >= (select penalty_start_date from public.pps_penalty_config where id = 1)
      then '✓ ผ่าน'
    else '✘ ตัดย้อนก่อนวันเริ่มนับ'
  end as ผล,
  'ตัดหลัง ' || public.pps_effective_cutoff()::text
    || ' (เริ่มนับ ' || (select penalty_start_date::text from public.pps_penalty_config where id = 1) || ')' as รายละเอียด;


-- 5) สวิตช์ PPS ต้องเปิด ไม่งั้น cron จะข้ามทุกครั้ง
select
  '5. สวิตช์ PPS' as ตรวจสอบ,
  case
    when auto_points_enabled then '✓ เปิดอยู่'
    else '⚠ ปิดอยู่ — cron จะไม่ทำอะไรเลย'
  end as ผล
from public.system_settings
where id = 1;


-- =============================================================
-- 6) ดูผลการรันล่าสุด (ต้องรันหลังงาน cron ทำงานแล้ว)
-- =============================================================
-- ถ้าอยากทดสอบเดี๋ยวนี้ (หักจริง ไม่ใช่ dry run):
--   select public.run_pps_daily_sweep();
--
-- ควรได้ JSON ประมาณ:
--   {"skipped":false,"penalty_from":"2026-10-17","noreport_awarded":0,"absence_awarded":0,...}
--
-- ※ วันแรกหัก 0 เสมอ เพราะเงื่อนไขคือ clock_out < วันนี้
--   → เวรวันนี้ยังมีเวลาส่งรายงาน จึงยังไม่หัก
--   พรุ่งนี้ถึงเริ่มหักเฉพาะเวรของเมื่อวาน
-- =============================================================
