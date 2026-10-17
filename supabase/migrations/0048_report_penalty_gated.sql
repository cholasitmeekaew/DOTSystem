-- =============================================================
-- 0048: ผูกกฎ "ไม่ส่งรายงาน" กับสวิตช์รายงาน + หักทันที
-- =============================================================
-- ปัญหา / สิ่งที่ต้องการ
-- ──────────────────
-- 1. ตอนนี้ cron หัก "ไม่ส่งรายงาน" ทุกวัน 09:10 น.
--    แปลว่าเจ้าหน้าที่ที่ไม่ส่งรายงานเจอบทลงโทษช้าที่สุดเกือบ 24 ชม.
--    ต้องการให้หัก "ทันที" ที่หน้าต่างส่งรายงานปิด
--
-- 2. ถ้า work_reports_enabled = false (ไม่ได้เปิดระบบรายงาน)
--    ห้ามหักคะแนนเพราะ "ไม่ส่งรายงาน" เด็ดขาด
--    เจ้าหน้าที่ไม่ได้ทำผิด เพราะระบบไม่ได้เปิดให้ส่งรายงาน
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
  add column if not exists report_deadline_hours integer not null default 12;

alter table public.pps_penalty_config
  drop constraint if exists pps_penalty_config_deadline;

alter table public.pps_penalty_config
  add constraint pps_penalty_config_deadline
  check (report_deadline_hours between 0 and 168);

comment on column public.pps_penalty_config.report_deadline_hours is
  'ให้เจ้าหน้าที่เวลากี่ชั่วโมงหลังออกเวรก่อนถือว่าไม่ส่งรายงาน (0 = หักทันทีเมื่อออกเวร)';


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

  -- ⚠ ปิดระบบรายงาน → ห้ามหักเด็ดขาด
  -- เจ้าหน้าที่ไม่ได้ทำผิด เพราะระบบไม่ได้เปิดให้ส่งรายงาน
  if not pps_work_reports_enabled() then
    return jsonb_build_object(
      'skipped', true,
      'reason', 'work_reports_enabled = false — ไม่หักเพราะไม่มีระบบรายงาน'
    );
  end if;

  select
    greatest(
      penalty_start_date,
      current_date - greatest(coalesce(lookback_days, 14), 1)
    ),
    coalesce(report_deadline_hours, 12) * interval '1 hour'
  into v_cutoff, v_deadline
  from public.pps_penalty_config
  where id = 1;

  -- ยังไม่ได้ตั้งค่า → เริ่มวันนี้ หักทันที (ไม่ย้อนหลัง)
  if v_cutoff is null then
    return jsonb_build_object('skipped', true, 'reason', 'ยังไม่ได้ตั้งค่า');
  end if;

  --
  -- เงื่อนไข "หักทันที"
  --   clock_out < now() - deadline   → หน้าต่างส่งรายงานปิดแล้ว
  --
  -- ไม่ใช่การเทียบวันแบบเดิม (clock_out < วันนี้) ซึ่งทำให้รอเกือบ 24 ชม.
  -- ตอนนี้ตั้ง deadline_hours = 12 ก็หักในรอบถัดไปหลังออกเวรครบ 12 ชม.
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
      and l.clock_out < (now() - v_deadline)            -- หน้าต่างส่งรายงานปิดแล้ว
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
-- 4) ตัดกฎ "ไม่ส่งรายงาน" ออกจากงานรายวัน
--    เหลือแค่ "ขาดเวร" ที่ต้องคำนวณหนัก
--
--    คงชื่อเดิมไว้เพื่อไม่ให้งานที่ตั้งไว้แล้วพัง
-- ---------------------------------------------------------------
create or replace function run_pps_daily_sweep()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today      date    := current_date;
  v_cutoff     date;
  v_absent     integer := 0;
  v_rec        record;
  v_week       date;
  v_from       date;
  v_to         date;
  v_has_duty   boolean;
  v_has_sched  boolean;
  v_on_leave   boolean;
  v_weeks_back integer := 26;
begin
  if not pps_auto_points_enabled() then
    return jsonb_build_object('skipped', true, 'reason', 'auto_points_enabled = false');
  end if;

  v_cutoff := pps_effective_cutoff();

  -- =============================================================
  -- กฎที่ 2 เท่านั้น: ไม่เข้าเวรติดต่อกัน 1 สัปดาห์ (-5)
  --
  -- เงื่อนไข (ตรงกับ applyWeeklyAbsencePoints ใน autoPoints.ts):
  --   - เจ้าหน้าที่ยัง active
  --   - ต้องมีตารางเวรของเขาในสัปดาห์นั้นจริง
  --   - ต้องไม่ได้วางลาอนุมัติในสัปดาห์นั้น
  --   - ต้องไม่มีการเข้าเวรเลยในสัปดาห์นั้น
  --
  -- เริ่มนับจาก penalty_start_date = วันที่ติดตั้งระบบ
  -- =============================================================
  for v_rec in
    select o.id from public.officers o where o.status = 'active'
  loop
    for i in 1..v_weeks_back loop
      -- สัปดาห์ที่จบแล้วเท่านั้น (ต้องตรงกับโค้ด JS)
      v_to   := v_today - (7 * (i - 1)) - 1;
      v_from := v_today - (7 * i);
      v_week := pps_week_start(v_from);

      if v_from < v_cutoff then
        continue;   -- เก่ากว่าวันเริ่มนับ → ไม่หักของค้าง
      end if;

      -- มีตารางเวรของคนนี้ในสัปดาห์นั้นไหม
      -- weekday เก็บเป็น JS getDay (0=อาทิตย์) → จากจันทร์ขยับ (weekday+6)%7
      select exists (
        select 1 from public.duty_schedules s
        where s.officer_id = v_rec.id
          and s.is_active is not false
          and extract(dow from (v_week + ((s.weekday + 6) % 7)))::integer = s.weekday
          and (v_week + ((s.weekday + 6) % 7)) >= v_from
          and (v_week + ((s.weekday + 6) % 7)) <= v_to
      ) into v_has_sched;

      if not v_has_sched then continue; end if;

      -- วางลาอนุมัติทับสัปดาห์นี้ไหม
      select exists (
        select 1 from public.officer_leaves lv
        where lv.officer_id = v_rec.id
          and lv.status = 'approved'
          and lv.start_date::date <= v_to
          and lv.end_date::date   >= v_from
      ) into v_on_leave;

      if v_on_leave then continue; end if;

      -- สัปดาห์นี้เข้าเวรหรือยัง
      select exists (
        select 1 from public.duty_logs l
        where l.officer_id = v_rec.id
          and l.deleted_at is null
          and l.clock_in is not null
          and l.clock_in::date >= v_from
          and l.clock_in::date <= v_to
      ) into v_has_duty;

      if v_has_duty then continue; end if;

      if pps_award(
        v_rec.id, -5,
        'ไม่เข้าเวรติดต่อกัน 1 สัปดาห์ (' || v_from || ' ถึง ' || v_to || ')',
        'absent7:' || v_rec.id::text || ':' || v_from::text
      ) then
        v_absent := v_absent + 1;
      end if;
    end loop;
  end loop;

  return jsonb_build_object(
    'skipped', false,
    'absence_awarded', v_absent,
    'penalty_from', v_cutoff,
    'ran_at', now()
  );
end;
$$;


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
  'หักคะแนนกฎไม่ส่งรายงาน — รันทุกชั่วโมง ทำงานเฉพาะตอนเปิดสวิตช์รายงาน';

comment on function run_pps_daily_sweep() is
  'หักคะแนนกฎขาดเวร 7 วัน — รันวันละครั้ง เริ่มนับจาก penalty_start_date';

comment on function pps_work_reports_enabled() is
  'สวิตช์บังคับส่งรายงานเปิดอยู่ไหม — ปิด = ห้ามหักคะแนนไม่ส่งรายงาน';
