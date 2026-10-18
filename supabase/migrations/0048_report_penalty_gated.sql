-- =============================================================
-- 0048: ผูกกฎ "ไม่ส่งรายงาน" กับสวิตช์รายงาน + หักทันที
-- =============================================================
-- ปัญหา / สิ่งที่ต้องการ
-- ──────────────────
-- 1. ตอนนี้ cron หัก "ไม่ส่งรายงาน" ทุกวัน 09:10 น.
--    แปลว่าเจ้าหน้าที่ที่ไม่ส่งรายงานเจอบทลงโทษช้าที่สุดเกือบ 24 ชม.
--    ต้องการให้หัก "ทันที" ที่หน้าต่างส่งรายงานปิด
--
-- 2. เงื่อนไขตรงข้ามกัน:
--    · รายงาน "เปิด" อยู่  = ยังส่งได้ → ห้ามหัก
--    · รายงาน "ปิด" แล้ว   = ปิดรับรายงานของวันนี้
--                      → คนที่ออกเวรวันนั้นแล้วแต่ไม่ส่ง = หักทันที
--
--    หัวหน้ากรมเป็นคนกดสวิตช์ปิดเอง = ตัดสินใจปิดรอบรายงาน
--    ไม่ใช่ระบบหักใครโดยอัตโนมัติตอนยังเปิดให้ส่งอยู่
--
-- แก้
-- ────
-- - แยกงานหักเป็น 2 ตัว เพราะความหนักต่างกันมาก
--     · ไม่ส่งรายงาน : เบา → รันทุกชั่วโมง (หักเร็ว)
--     · ขาดเวร      : หนักมาก (จำนวนเจ้าหน้าที่ × 26 สัปดาห์ × 3 query)
--                     → รันวันละครั้งพอ (เงื่อนไขคือครบสัปดาห์แล้ว รีบไม่ได้อยู่แล้ว)
-- - เพิ่ม report_deadline_hours เป็นหน้าต่างเวลาที่ยอมให้เขียนรายงาน
-- - เพิ่มสวิตช์เป็นเงื่อนไขบังคับ
-- =============================================================


-- ---------------------------------------------------------------
-- 1) เพิ่มหน้าต่างเวลาส่งรายงาน
-- ---------------------------------------------------------------
alter table public.pps_penalty_config
  add column if not exists report_deadline_hours integer not null default 0;

alter table public.pps_penalty_config
  drop constraint if exists pps_penalty_config_deadline;

alter table public.pps_penalty_config
  add constraint pps_penalty_config_deadline
  check (report_deadline_hours between 0 and 168);

comment on column public.pps_penalty_config.report_deadline_hours is
  'หลังปิดรายงานแล้ว รอกี่ชั่วโมงก่อนหัก (0 = หักทันทีทุกคนที่ออกเวรแล้วแต่ไม่ส่งรายงาน)';


-- ---------------------------------------------------------------
-- 2) สวิตช์บังคับส่งรายงาน
--    อ่านไม่ได้ = ปิดไว้ (ห้ามหักผิดคน)
-- ---------------------------------------------------------------
create or replace function pps_work_reports_enabled()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_value boolean;
begin
  begin
    select work_reports_enabled into v_value
    from public.system_settings where id = 1;
  exception when others then
    return false;   -- อ่านไม่ได้ → ปิดไว้ ปลอดภัยกว่าหักผิด
  end;

  return coalesce(v_value, false);
end;
$$;


-- ---------------------------------------------------------------
-- 3) งานหักเฉพาะกฎ "ไม่ส่งรายงาน" (เบา → รันทุกชั่วโมง)
-- ---------------------------------------------------------------
create or replace function run_pps_report_penalty()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today    date    := current_date;
  v_cutoff   date;
  v_deadline interval;
  v_count    integer := 0;
  v_rec      record;
begin
  -- ปิด PPS → ไม่ทำอะไร
  if not pps_auto_points_enabled() then
    return jsonb_build_object('skipped', true, 'reason', 'auto_points_enabled = false');
  end if;

  -- ยังเปิดรับรายงานอยู่ → ยังส่งได้ ห้ามหัก
  if pps_work_reports_enabled() then
    return jsonb_build_object(
      'skipped', true,
      'reason', 'ระบบรายงานยังเปิดอยู่ — ยังส่งได้ จึงไม่หัก'
    );
  end if;

  select
    greatest(
      penalty_start_date,
      current_date - greatest(coalesce(lookback_days, 14), 1)
    ),
    coalesce(report_deadline_hours, 0) * interval '1 hour'
  into v_cutoff, v_deadline
  from public.pps_penalty_config
  where id = 1;

  -- ยังไม่ได้ตั้งค่า → เริ่มวันนี้ หักทันที (ไม่ย้อนหลัง)
  if v_cutoff is null then
    return jsonb_build_object('skipped', true, 'reason', 'ยังไม่ได้ตั้งค่า');
  end if;

  --
  -- เงื่อนไข "หักทันทีที่ปิดรายงาน"
  --   clock_out < now() - deadline   → ระบบปิดรับรายงานแล้ว จึงหัก
  --
  -- เดิมเทียบวัน (clock_out < วันนี้) ซึ่งทำให้รอเกือบ 24 ชม.
  -- ตอนนี้ปิดสวิตช์แล้วหักทันทีในรอบถัดไป (หรือทันทีที่กดปุ่ม)
  --
  for v_rec in
    select l.id, l.officer_id
    from public.duty_logs l
    where l.deleted_at is null
      and l.clock_in is not null
      and l.clock_out is not null
      and l.officer_id is not null
      and coalesce(l.checkout_method, '') <> 'forced'   -- ถูกบังคับ = มีโทษ -15 แล้ว
      and l.clock_out >= v_cutoff::timestamptz         -- ไม่หักย้อนก่อนวันเริ่มนับ
      and l.clock_out < (now() - v_deadline)            -- ปิดรับรายงานแล้ว
      and not exists (
        select 1 from public.work_reports w
        where w.duty_log_id = l.id
      )
  loop
    if pps_award(
      v_rec.officer_id, -5,
      'ออกเวรโดยไม่ได้ส่งรายงานปฏิบัติงาน',
      'noreport:' || v_rec.id::text
    ) then
      v_count := v_count + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'skipped', false,
    'noreport_awarded', v_count,
    'penalty_from', v_cutoff,
    'deadline_hours', extract(hours from v_deadline)::int,
    'ran_at', now()
  );
end;
$$;


-- ---------------------------------------------------------------
-- 4) หมายเหตุเรื่อง run_pps_daily_sweep()
--
--    ไฟล์นี้ไม่ได้นิยามซ้ำ เพราะ migration 0049 เป็นผู้นิยาม
--    ตามตรรกะสถานะเซิร์ฟเวอร์ BIT NEWS (นับเฉพาะวันที่เซิร์ฟเวอร์เปิด)
--    ถ้านิยามทั้งสองไฟล์ ตัวหลังจะทับของเดิมเสมอ
-- ---------------------------------------------------------------


-- ---------------------------------------------------------------
-- 5) ตั้งงานอัตโนมัติ
-- ---------------------------------------------------------------

-- งานเดิม (ขาดเวร) — รันวันละครั้ง
select cron.unschedule('pps-daily-sweep')
where exists (select 1 from cron.job where jobname = 'pps-daily-sweep');

select cron.schedule(
  'pps-daily-sweep',
  '10 2 * * *',        -- 02:10 UTC = 09:10 น. ไทย
  $$select public.run_pps_daily_sweep();$$
);

-- งานใหม่ (ไม่ส่งรายงาน) — รันทุกชั่วโมงเพื่อหักทันทีที่หน้าต่างปิด
select cron.unschedule('pps-report-penalty')
where exists (select 1 from cron.job where jobname = 'pps-report-penalty');

-- ทุกชั่วโมงที่ นาทีที่ 5 เพื่อเลี่ยงเวลาเลขบอร์ด
select cron.schedule(
  'pps-report-penalty',
  '5 * * * *',
  $$select public.run_pps_report_penalty();$$
);


-- ---------------------------------------------------------------
-- 6) ข้อมูลอธิบาย
-- ---------------------------------------------------------------
comment on function run_pps_report_penalty() is
  'หักคะแนนกฎไม่ส่งรายงาน — รันทุกชั่วโมง ทำงานเฉพาะหลังปิดสวิตช์รายงานแล้ว';

comment on function run_pps_daily_sweep() is
  'หักคะแนนกฎขาดเวร 7 วัน — รันวันละครั้ง เริ่มนับจาก penalty_start_date';

comment on function pps_work_reports_enabled() is
  'สวิตช์รายงานเปิดอยู่ไหม — เปิด = ยังส่งได้ ยังไม่หัก · ปิด = หักคนที่ออกเวรแล้วไม่ส่ง';
