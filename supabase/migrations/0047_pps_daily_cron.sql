-- =============================================================
-- 0047: ตั้งงานอัตโนมัติหักคะแนนกฎที่ "ต้องรอเวลาเดินผ่าน"
-- =============================================================
-- ปัญหา
-- ──────
-- เกณฑ์ PPS 8 ข้อ แต่มี 2 ข้อที่ระบบ "ยิงเองไม่ได้"
--
--   1. ออกเวรโดยไม่ส่งรายงาน   (-5)
--      เงื่อนไขจะเป็นจริงหลังวันที่เวรผ่านไปแล้ว ไม่มีใครกดอะไรในจังหวะนั้น
--   2. ไม่เข้าเวรติดต่อกัน 1 สัปดาห์ (-5)
--      ต้องรอจบสัปดาห์ถึงจะรู้ว่าขาดจริง
--
-- ถ้าไม่มีใครกดปุ่มสแกน คนที่ไม่ส่งรายงานหรือขาดเวรจะไม่ถูกหักเลย
-- เงินเดือนผิดพลาดโดยไม่มีใครสังเกต
--
-- แก้
-- ────
-- ตั้ง pg_cron ให้รันทุกวัน โดยเรียกฟังก์ชันด้านล่าง
-- ฟังก์ชันนี้ใช้เกณฑ์และ markKey ชุดเดียวกับปุ่มสแกนในหน้าเว็บ
-- และเรียก add_officer_points() (migration 0042) เพื่อให้เขียนคะแนนแบบ atomic
--
-- ปลอดภัย
-- ──────
-- 1. เคารพสวิตช์ system_settings.auto_points_enabled เสมอ (ปิดไว้ = ไม่ทำอะไร)
-- 2. ใช้ points_award_marks กันหักซ้ำ → รันซ้ำกี่ครั้งก็ได้ผลเดิม
-- 3. ประทับ mark เฉพาะเมื่อให้คะแนนสำเร็จเท่านั้น
-- 4. ขาดเวร: ข้ามสัปดาห์ที่ไม่มีตารางเวรของคนนั้น และข้ามสัปดาห์ที่วางลา
--    → ไม่หักย้อนไปถึงช่วงก่อนมีระบบจัดตารางเวร
-- 5. ไม่ส่งรายงาน: ข้ามเวรที่ถูกบังคับออก (มีโทษของตัวเองแล้ว) และเวรวันนี้
-- 6. ไม่หักอะไรที่เกิดก่อน penalty_start_date (ค่าเริ่มต้น = วันที่ติดตั้ง)
--    ตั้งค่าได้ที่ตาราง pps_penalty_config (แก้วันที่/จำนวนวันย้อนหลังได้)
-- =============================================================


-- ---------------------------------------------------------------
-- ตั้งค่าเกณฑ์การหักอัตโนมัติ
--
-- penalty_start_date = วันที่เริ่มนับใหม่
--   เวรที่ออกเวรก่อนวันนี้จะไม่ถูกหักไม่ว่าอย่างไร
--   เพราะเป็นหนี้ที่เกิดก่อนมีระบบนี้ ห้ามไปล้างย้อนหลังทีเดียว
--   หลักการคือ "หักตอนวันผ่านวัน" ไม่ใช่หักรวมของค้าง
--
-- lookback_days = จำกัดอีกชั้นว่าไม่หักย้อนเก่ากว่านี้
--   ป้องกันกรณีเปิดใช้งานช้า หรือเผลอตั้งวันเริ่มเริ่มผิด
-- ---------------------------------------------------------------
create table if not exists public.pps_penalty_config (
  id                  smallint primary key default 1,
  penalty_start_date  date not null default current_date,
  lookback_days       integer not null default 14,
  updated_at          timestamptz not null default now(),
  constraint pps_penalty_config_singleton check (id = 1),
  constraint pps_penalty_config_lookback check (lookback_days between 1 and 365)
);

comment on table public.pps_penalty_config is
  'เกณฑ์การหักคะแนนอัตโนมัติ — ไม่หักย้อนก่อน penalty_start_date เด็ดขาด';

-- ค่าเริ่มต้น = วันที่ติดตั้ง cron (คือ "วันนี้" ตอนรัน migration)
insert into public.pps_penalty_config (id, penalty_start_date, lookback_days)
values (1, current_date, 14)
on conflict (id) do nothing;

alter table public.pps_penalty_config enable row level security;

drop policy if exists "pps_penalty_config read" on public.pps_penalty_config;
create policy "pps_penalty_config read" on public.pps_penalty_config
  for select using (true);

drop policy if exists "pps_penalty_config update" on public.pps_penalty_config;
create policy "pps_penalty_config update" on public.pps_penalty_config
  for update using (true) with check (id = 1);


-- ---------------------------------------------------------------
-- วันตัดหลังที่มีผลจริง = วันเริ่มนับใหม่ และ ไม่เก่ากว่า lookback
-- เอาค่ามากสุดเสมอ เพื่อให้เคร่งที่สุด
-- ---------------------------------------------------------------
create or replace function pps_effective_cutoff()
returns date
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_start    date;
  v_lookback integer;
begin
  select penalty_start_date, lookback_days
    into v_start, v_lookback
  from public.pps_penalty_config
  where id = 1;

  -- ยังไม่ได้ตั้งค่า → เริ่มวันนี้ (ปลอดภัย ไม่หักย้อนหลัง)
  if v_start is null then
    return current_date;
  end if;

  return greatest(v_start, current_date - greatest(coalesce(v_lookback, 14), 1));
end;
$$;


-- ---------------------------------------------------------------
-- คืนวันเริ่มต้นสัปดาห์ (จันทร์) ของวันที่ที่กำหนด
-- ตรงกับ weekKeyOf() ใน AdminSettingsPage.tsx
-- ---------------------------------------------------------------
create or replace function pps_week_start(d date)
returns date
language plpgsql
immutable
as $$
declare
  v_dow integer := extract(dow from d)::integer;
begin
  -- PostgreSQL: 0 = อาทิตย์, 1 = จันทร์ ... 6 = เสาร์
  return d - ((v_dow + 6) % 7);
end;
$$;


-- ---------------------------------------------------------------
-- ตรวจสวิตช์ระบบคะแนนอัตโนมัติ
-- ---------------------------------------------------------------
create or replace function pps_auto_points_enabled()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select auto_points_enabled from public.system_settings where id = 1),
    false
  ) = true;
$$;


-- ---------------------------------------------------------------
-- ตัวช่วย: ให้คะแนนแบบ atomic + ประทับ mark หลังสำเร็จ
-- คืน true เมื่อให้คะแนนสำเร็จเท่านั้น
-- ---------------------------------------------------------------
create or replace function pps_award(
  p_officer_id uuid,
  p_delta     integer,
  p_reason    text,
  p_mark_key  text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_res jsonb;
begin
  -- ให้ไปแล้ว → ไม่ต้องทำซ้ำ
  if exists (select 1 from public.points_award_marks where mark_key = p_mark_key) then
    return false;
  end if;

  v_res := public.add_officer_points(
    p_officer_id, p_delta, p_reason, 'system:ppps-cron', 'ระบบอัตโนมัติ (PPS)'
  );

  -- ให้ไม่สำเร็จ (เช่น ไม่พบเจ้าหน้าที่) → ไม่ประทับ mark
  -- จะได้ลองใหม่ในรอบถัดไป
  if v_res is null or v_res->'officer' is null then
    return false;
  end if;

  insert into public.points_award_marks (mark_key, officer_id, delta, reason)
  values (p_mark_key, p_officer_id, p_delta, p_reason)
  on conflict (mark_key) do nothing;

  return true;
end;
$$;


-- ---------------------------------------------------------------
-- งานหลัก: หักคะแนนกฎที่ต้องรอเวลา
-- ---------------------------------------------------------------
create or replace function run_pps_daily_sweep()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today      date   := current_date;
  v_cutoff     date;
  v_actor      text;
  v_noreport   integer := 0;
  v_absent     integer := 0;
  v_rec        record;
  v_week       date;
  v_from       date;
  v_to         date;
  v_has_duty   boolean;
  v_has_sched  boolean;
  v_on_leave   boolean;
  v_weeks_back integer := 26;   -- ย้อนได้กี่สัปดาห์ (ตรงกับ maxWeeks ในไฟล์ JS)
begin
  -- สวิตช์ปิด → ไม่ทำอะไรเลย
  if not pps_auto_points_enabled() then
    return jsonb_build_object('skipped', true, 'reason', 'auto_points_enabled = false');
  end if;

  -- =============================================================
  -- วันตัดหลัง
  --
  -- อ่านจาก pps_penalty_config (ตั้งค่าครั้งแรก = วันที่ติดตั้ง cron)
  --
  -- หลักการ: หัก "ตอนวันผ่านวัน" เท่านั้น
  -- ของที่ค้างอยู่ก่อนวันที่เริ่มนับ จะไม่ถูกหักโดย cron
  -- ถ้าต้องการนับย้อนหลัง ให้หัวหน้ากรมกดสแกนเองตามช่วงวันที่
  -- เพราะเป็นการตัดสินใจอย่างตั้งใจ ไม่ใช่งานอัตโนมัติ
  -- =============================================================
  v_cutoff := pps_effective_cutoff();

  -- =============================================================
  -- กฎที่ 1: ออกเวรโดยไม่ส่งรายงาน (-5)
  --
  -- เงื่อนไข (ตรงกับ applyMissingReportPoints ใน autoPoints.ts):
  --   - มี clock_in และ clock_out แล้ว
  --   - ไม่ใช่การออกเวรแบบถูกบังคับ (มีโทษ -15 ของตัวเองแล้ว)
  --   - ยังไม่ถูกลบ
  --   - วันที่ออกเวรผ่านมาแล้ว (วันนี้ยังให้เขียนรายงานทีหลังได้)
  --   - ไม่มีรายงานที่ผูกกับเวรนี้
  -- =============================================================
  for v_rec in
    select l.id, l.officer_id, l.clock_out::date as day_out
    from public.duty_logs l
    where l.deleted_at is null
      and l.clock_in is not null
      and l.clock_out is not null
      and coalesce(l.checkout_method, '') <> 'forced'
      and l.clock_out::date < v_today
      and l.clock_out::date >= v_cutoff        -- หักเฉพาะช่วงใกล้ ๆ
      and not exists (
        select 1 from public.work_reports w
        where w.duty_log_id = l.id
      )
      and l.officer_id is not null
  loop
    if pps_award(
      v_rec.officer_id,
      -5,
      'ออกเวรโดยไม่ได้ส่งรายงานปฏิบัติงาน',
      'noreport:' || v_rec.id::text
    ) then
      v_noreport := v_noreport + 1;
    end if;
  end loop;

  -- =============================================================
  -- กฎที่ 2: ไม่เข้าเวรติดต่อกัน 1 สัปดาห์ (-5)
  --
  -- เงื่อนไข (ตรงกับ applyWeeklyAbsencePoints ใน autoPoints.ts):
  --   - เจ้าหน้าที่ยัง active
  --   - ต้องมีตารางเวรของเขาในสัปดาห์นั้นจริง
  --     (ไม่มีตาราง = ยังไม่มีระบบจัดเวร ห้ามหักย้อนไปถึงช่วงนั้น)
  --   - ต้องไม่ได้วางลาอนุมัติในสัปดาห์นั้น
  --   - ต้องไม่มีการเข้าเวรเลยในสัปดาห์นั้น
  -- =============================================================
  for v_rec in
    select o.id, o.name
    from public.officers o
    where o.status = 'active'
  loop
    for i in 1..v_weeks_back loop
      v_to   := v_today - (7 * (i - 1));
      v_from := v_today - (7 * i);
      v_week := pps_week_start(v_from);

      -- สัปดาห์ที่เก่ากว่าวันเริ่มนับ → ไม่พิจารณา (ไม่หักของค้าง)
      if v_from < v_cutoff then
        continue;
      end if;

      -- 2.1) มีตารางเวรของคนนี้ในสัปดาห์นั้นไหม
      --      ตารางเวรเป็นแบบทำซ้ำรายสัปดาห์ (เก็บเป็นวันในสัปดาห์)
      --
      -- ⚠ offset สำคัญมาก
      --
      -- v_week คือวันจันทร์ แต่ duty_schedules.weekday เก็บเป็น JS getDay()
      -- ซึ่งนับ 0 = อาทิตย์, 1 = จันทร์, ... 6 = เสาร์
      --
      -- จากจันทร์ ต้องขยับไปหา weekday นั้นด้วย (weekday + 6) % 7
      --   weekday 1 (จันทร์) → +0  = วันจันทร์เอง
      --   weekday 0 (อาทิตย์) → +6  = วันอาทิตย์ของสัปดาห์นั้น
      --   weekday 6 (เสาร์)  → +5
      --
      -- ถ้าใช้ weekday ตรง ๆ จะเลื่อนไปผิดวัน → ไม่พบตารางเวร
      -- → ไม่หักคะแนนขาดเวรตลอดไป (พลาดเงียบ)
      --
      select exists (
        select 1
        from public.duty_schedules s
        where s.officer_id = v_rec.id
          and s.is_active is not false
          and extract(dow from (v_week + ((s.weekday + 6) % 7)))::integer = s.weekday
          and (v_week + ((s.weekday + 6) % 7)) >= v_from
          and (v_week + ((s.weekday + 6) % 7)) <= v_to
      ) into v_has_sched;

      if not v_has_sched then
        continue;   -- ไม่มีตารางเวรสัปดาห์นี้ → ไม่พิจารณา
      end if;

      -- 2.2) วางลาอนุมัติทับสัปดาห์นี้ไหม
      select exists (
        select 1
        from public.officer_leaves lv
        where lv.officer_id = v_rec.id
          and lv.status = 'approved'
          and lv.start_date::date <= v_to
          and lv.end_date::date   >= v_from
      ) into v_on_leave;

      if v_on_leave then
        continue;   -- วางลาไว้ = ไม่ถือว่าขาดเวร
      end if;

      -- 2.3) สัปดาห์นี้เข้าเวรหรือยัง
      select exists (
        select 1
        from public.duty_logs l
        where l.officer_id = v_rec.id
          and l.deleted_at is null
          and l.clock_in is not null
          and l.clock_in::date >= v_from
          and l.clock_in::date <= v_to
      ) into v_has_duty;

      if v_has_duty then
        continue;   -- เข้าเวรแล้ว = ไม่ขาด
      end if;

      if pps_award(
        v_rec.id,
        -5,
        'ไม่เข้าเวรติดต่อกัน 1 สัปดาห์ (' || v_from || ' ถึง ' || v_to || ')',
        'absent7:' || v_rec.id::text || ':' || v_from::text
      ) then
        v_absent := v_absent + 1;
      end if;
    end loop;
  end loop;

  return jsonb_build_object(
    'skipped', false,
    'penalty_from', v_cutoff,
    'noreport_awarded', v_noreport,
    'absence_awarded', v_absent,
    'ran_at', now()
  );
end;
$$;


-- ---------------------------------------------------------------
-- ตั้งงานอัตโนมัติ
-- ---------------------------------------------------------------
-- ใช้หน้าต่างเวลาของฐานข้อมูล (UTC) ถ้าต้องการเวลาไทยให้เปลี่ยนเป็น 'Asia/Bangkok'
create extension if not exists pg_cron;

-- ลบงานเดิมก่อนเสมอ เพื่อให้รันสคริปต์นี้ซ้ำได้
select cron.unschedule('pps-daily-sweep')
where exists (select 1 from cron.job where jobname = 'pps-daily-sweep');

-- 05:10 UTC = 12:10 น. เวลาไทย
-- เลือกช่วงที่ไม่ใช่เวลาเลขบอร์ด เพราะตั้งใจให้เจ้าหน้าที่
-- มีเวลาเขียนรายงานก่อนครบวัน
select cron.schedule(
  'pps-daily-sweep',
  '10 5 * * *',
  $$select public.run_pps_daily_sweep();$$
);


-- ---------------------------------------------------------------
-- ข้อมูลสำหรับตรวจสอบว่างานทำงานจริง
-- ---------------------------------------------------------------
comment on function run_pps_daily_sweep() is
  'หักคะแนนกฎที่ต้องรอเวลา (ไม่ส่งรายงาน / ขาดเวรต่อสัปดาห์) — เรียกอัตโนมัติทุกวัน 05:10 UTC';

comment on function pps_award(uuid, integer, text, text) is
  'ให้คะแนนแบบ atomic + กันหักซ้ำด้วย mark (ใช้โดย run_pps_daily_sweep)';
