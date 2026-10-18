-- =============================================================
-- 0049: กฎ "ขาดเวร 7 วัน" อ้างอิงสถานะเซิร์ฟเวอร์ BIT NEWS API
-- =============================================================
-- หลักการ
-- ──────
-- วันที่เซิร์ฟเวอร์ "ปิดให้บริการ" ทั้งวัน → ไม่นับเป็นวันขาดเวร
-- เพราะเจ้าหน้าที่ไม่ได้ทำอะไรผิด แค่ไม่มีบริการให้ทำงาน
--
-- ถือว่าขาดเวรก็ต่อเมื่อ
--   1. ในรอบ 7 วัน มีวันที่เซิร์ฟเวอร์เปิดอย่างน้อย 1 วัน
--   2. และเจ้าหน้าที่คนนั้นไม่มีประวัติกดเข้าเวรเลยแม้แต่ครั้งเดียว
--   (มี 1 ครั้งขึ้นไป = ผ่าน)
--
-- ⚠ ข้อสำคัญมาก
-- ──────────────
-- ถ้ายังไม่มีข้อมูลสถานะเซิร์ฟเวอร์ของวันนั้น → ห้ามหักคะแนน
-- เพราะ "ไม่รู้ว่าเปิดหรือปิด" ไม่เท่ากับ "ปิด"
-- ถ้าหักไปเจ้าหน้าที่จะโดนหักโดยไม่มีโอกาสทำอะไรได้
--
-- ทำไมต้องให้แอปเป็นคนเก็บ snapshot
-- ──────────────────────────────
-- cron รันใน PostgreSQL ซึ่งเรียก HTTPS ไม่ได้โดยตรง
-- (ต้องเพิ่ม extension อย่าง pg_net)
-- แอปเรียก API ได้อยู่แล้ว → ให้แอปเป็นคนเก็บลงตาราง
-- แล้ว cron อ่านจากตาราง (ไม่ต้องพึ่งเครือข่ายตอนรันจริง)
-- =============================================================


-- ---------------------------------------------------------------
-- 1) ตารางสถานะเซิร์ฟเวอร์รายวัน
--
--    is_open = true  → วันนั้นเซิร์ฟเวอร์เปิดให้บริการอย่างน้อย 1 ช่วง
--    is_open = false → ปิดให้บริการทั้งวัน → ไม่นับเป็นวันขาดเวร
--    ไม่มีแถว          → ยังไม่มีข้อมูล → ห้ามหัก
-- ---------------------------------------------------------------
create table if not exists public.server_status_daily (
  day             date primary key,
  is_open         boolean not null,
  open_samples    integer not null default 0,
  total_samples   integer not null default 0,
  players_max     integer,
  source          text not null default 'bit-news-api',
  updated_at      timestamptz not null default now(),
  constraint server_status_daily_open_samples check (open_samples >= 0),
  constraint server_status_daily_total_samples check (total_samples >= 0),
  -- วันที่ปิดทั้งวัน ต้องไม่มีตัวอย่างที่เปิด
  constraint server_status_daily_consistent
    check (is_open or open_samples = 0)
);

comment on table public.server_status_daily is
  'สถานะเซิร์ฟเวอร์รายวันจาก BIT NEWS API — ใช้ตัดสินว่าวันไหนนับเป็นวันขาดเวรได้';

-- เก็บประวัติว่าใครเก็บข้อมูล เพื่อตรวจย้อนว่าข้อมูลหายตรงไหน
create table if not exists public.server_status_daily_log (
  id            bigserial primary key,
  day           date not null,
  is_open       boolean not null,
  open_samples  integer,
  total_samples integer,
  fetched_at    timestamptz not null default now(),
  source        text
);

create index if not exists server_status_daily_log_day_idx
  on public.server_status_daily_log (day desc);


-- ---------------------------------------------------------------
-- 2) RPC บันทึกสถานะรายวัน (แอปเรียกใช้)
--
--    ถ้าวันเดียวกันถูกบันทึกซ้ำ ให้ "รวม" ไม่ใช่ทับ
--    เพราะแต่ละรอบที่แอปเปิดดูจะได้ข้อมูลคนละช่วงเวลา
--    รวมแล้วถึงจะรู้ว่าเปิดครั้งเดียว = เปิดทั้งวัน
-- ---------------------------------------------------------------
create or replace function record_server_status_day(
  p_day            date,
  p_is_open        boolean,
  p_open_samples   integer default 0,
  p_total_samples  integer default 0,
  p_players_max    integer default null,
  p_source         text default 'bit-news-api'
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_day is null or p_day > (current_date + 1) then
    return false;   -- วันที่ผิดปกติ (อนาคตไกลเกินพรุ่งนี้)
  end if;

  insert into public.server_status_daily as d (
    day, is_open, open_samples, total_samples, players_max, source, updated_at
  )
  values (
    p_day,
    coalesce(p_is_open, false),
    greatest(coalesce(p_open_samples, 0), 0),
    greatest(coalesce(p_total_samples, 0), 0),
    p_players_max,
    coalesce(p_source, 'bit-news-api'),
    now()
  )
  on conflict (day) do update
    set
      is_open = d.is_open or excluded.is_open,
      open_samples  = greatest(d.open_samples, excluded.open_samples),
      total_samples = greatest(d.total_samples, excluded.total_samples),
      players_max = greatest(coalesce(d.players_max, 0), coalesce(excluded.players_max, 0)),
      source = excluded.source,
      updated_at = now();

  insert into public.server_status_daily_log (day, is_open, open_samples, total_samples, source)
  values (p_day, coalesce(p_is_open, false), p_open_samples, p_total_samples, p_source);

  return true;
end;
$$;

grant execute on function record_server_status_day(date, boolean, integer, integer, integer, text)
  to anon, authenticated;

comment on function record_server_status_day is
  'แอปเรียกใช้เพื่อบันทึกสถานะเซิร์ฟเวอร์รายวัน (เก็บสถานะเซิร์ฟเวอร์ให้กฎขาดเวรใช้)';


-- ---------------------------------------------------------------
-- 3) นับจำนวนวันที่เซิร์ฟเวอร์ "เปิด" ในช่วงที่กำหนด
--    คืน NULL ถ้ายังไม่มีข้อมูลครบทุกวัน → ห้ามหักคะแนน
-- ---------------------------------------------------------------
create or replace function pps_open_days_in_range(
  p_from date,
  p_to   date
)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_days     integer;
  v_open     integer;
  v_has_data integer;
begin
  if p_from is null or p_to is null or p_to < p_from then
    return null;
  end if;

  v_days := (p_to - p_from) + 1;

  select
    count(*),
    count(*) filter (where is_open)
  into v_has_data, v_open
  from public.server_status_daily
  where day >= p_from and day <= p_to;

  -- ต้องมีข้อมูลครบทุกวัน ถึงจะมั่นใจว่าไม่มีวันไหนที่เปิดจริงแต่ถูกมองว่าปิด
  if v_has_data < v_days then
    return null;
  end if;

  return v_open;
end;
$$;

comment on function pps_open_days_in_range is
  'จำนวนวันที่เซิร์ฟเวอร์เปิดในช่วง — NULL = ข้อมูลไม่ครบ ห้ามหักคะแนน';


-- ---------------------------------------------------------------
-- 4) งานหักกฎ "ขาดเวร 7 วัน" ตามสถานะเซิร์ฟเวอร์
--
--    รัน 09:10 น. ทุกวัน (cron: pps-daily-sweep)
--    markKey = absent7:<officer_id>:<week> กันหักซ้ำในสัปดาห์นั้น
--    เริ่มนับจาก penalty_start_date เท่านั้น
-- ---------------------------------------------------------------
create or replace function run_pps_daily_sweep()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today       date    := current_date;
  v_cutoff      date;
  v_absent      integer := 0;
  v_passed      integer := 0;
  v_skip_data   integer := 0;   -- ข้อมูลเซิร์ฟเวอร์ไม่ครบ → ไม่หัก
  v_rec         record;
  v_from        date;
  v_to          date;
  v_open_days   integer;
  v_has_duty    boolean;
  v_on_leave    boolean;
  v_weeks_back  integer := 26;
begin
  -- สวิตช์ PPS ปิด → ไม่ทำอะไร
  if not pps_auto_points_enabled() then
    return jsonb_build_object('skipped', true, 'reason', 'auto_points_enabled = false');
  end if;

  v_cutoff := pps_effective_cutoff();

  for v_rec in
    select o.id, o.name
    from public.officers o
    where o.status = 'active'
  loop
    for i in 1..v_weeks_back loop
      -- รอบ 7 วันที่เพิ่งจบไปแล้ว (ตรงกับ applyWeeklyAbsencePoints ใน autoPoints.ts)
      v_to   := v_today - (7 * (i - 1)) - 1;
      v_from := v_today - (7 * i);

      -- เก่ากว่าวันเริ่มนับ → ไม่หักของค้าง
      if v_from < v_cutoff then
        continue;
      end if;

      -- ⚠ ต้องมีข้อมูลสถานะเซิร์ฟเวอร์ครบทุกวันในรอบนี้
      --   ไม่มี = ไม่รู้ว่าเปิดหรือปิด → ห้ามหัก (สำคัญมาก)
      v_open_days := pps_open_days_in_range(v_from, v_to);

      if v_open_days is null then
        v_skip_data := v_skip_data + 1;
        continue;
      end if;

      -- เซิร์ฟเวอร์ปิดทั้งรอบ → ไม่มีบริการให้ทำงาน → ไม่ถือว่าขาด
      if v_open_days = 0 then
        v_passed := v_passed + 1;
        continue;
      end if;

      -- วางลาอนุมัติทับรอบนี้ไหม → ไม่ถือว่าขาดเวร
      select exists (
        select 1 from public.officer_leaves lv
        where lv.officer_id = v_rec.id
          and lv.status = 'approved'
          and lv.start_date::date <= v_to
          and lv.end_date::date   >= v_from
      ) into v_on_leave;

      if v_on_leave then
        v_passed := v_passed + 1;
        continue;
      end if;

      -- เข้าเวรอย่างน้อย 1 ครั้ง = ผ่าน
      select exists (
        select 1 from public.duty_logs l
        where l.officer_id = v_rec.id
          and l.deleted_at is null
          and l.clock_in is not null
          and l.clock_in::date >= v_from
          and l.clock_in::date <= v_to
      ) into v_has_duty;

      if v_has_duty then
        v_passed := v_passed + 1;
        continue;
      end if;

      -- เข้าเกณฑ์ขาดเวร: เซิร์ฟเวอร์เปิดอย่างน้อย 1 วัน + ไม่เข้าเวรเลย
      if pps_award(
        v_rec.id, -5,
        'ไม่เข้าเวรต่อเนื่องตลอดรอบที่เซิร์ฟเวอร์เปิดให้บริการ'
        || ' (' || v_from || ' ถึง ' || v_to
        || ' · เซิร์ฟเวอร์เปิด ' || v_open_days || ' วัน)',
        'absent7:' || v_rec.id::text || ':' || v_from::text
      ) then
        v_absent := v_absent + 1;
      end if;
    end loop;
  end loop;

  return jsonb_build_object(
    'skipped', false,
    'penalty_from', v_cutoff,
    'absence_awarded', v_absent,
    'passed', v_passed,
    'skipped_no_data', v_skip_data,
    'ran_at', now()
  );
end;
$$;

comment on function run_pps_daily_sweep() is
  'หักคะแนนขาดเวร 7 วัน — นับเฉพาะวันที่เซิร์ฟเวอร์ BIT NEWS เปิดให้บริการ';