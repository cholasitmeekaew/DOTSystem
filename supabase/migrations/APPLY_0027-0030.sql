-- =====================================================================
-- DOTSystem — รวม migration ที่ยังไม่ถูก apply (0027 → 0030)
-- ---------------------------------------------------------------------
-- วิธีใช้: เปิด Supabase Dashboard → SQL Editor → New query
--        วางทั้งไฟล์นี้ → Run  (ทีเดียวจบ)
--
-- ทุก statement เป็น idempotent (ใช้ IF NOT EXISTS / ON CONFLICT /
-- DROP IF EXISTS) → รันซ้ำได้ถ้ามีอะไรค้าง
--
-- ลำดับสำคัญ: 0029 และ 0030 อ้างอิงตาราง duty_schedules /
-- schedule_overrides ที่ 0028 สร้าง → ห้ามรันข้าม
-- =====================================================================



-- =====================================================================
-- 0027_officer_generation_and_sort_order.sql
-- =====================================================================
-- =============================================================
-- 0027 — Officer Generation (รุ่น) + Manual sort order (sort_order)
-- =============================================================
-- เพิ่ม 2 ความสามารถ:
--   1) officer_generations  — ตารางอ้างอิง "รุ่น" (รุ่นที่ 1, รุ่นที่ 2, ...)
--                            รองรับการทำเครื่องหมาย "พนักงานทดลองงาน"
--   2) officers.generation  — เก็บ generation_key ของเจ้าหน้าที่แต่ละคน
--      officers.sort_order  — ลำดับความสำคัฎที่หัวหน้ากรมกำหนดเอง
--                            (ใช้ในหน้าทำเนียบบุคลากร / PersonnelPage)
-- =============================================================

-- ---------- 1) ตารางอ้างอิงรุ่น ----------
create table if not exists officer_generations (
  id             uuid primary key default gen_random_uuid(),
  label          text not null,
  generation_key text unique,
  sort_order     int not null default 0,
  is_trainee     boolean not null default false,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

insert into officer_generations (label, generation_key, sort_order, is_trainee) values
  ('รุ่นที่ 1', '1', 1, true),
  ('รุ่นที่ 2', '2', 2, false),
  ('รุ่นที่ 3', '3', 3, false)
on conflict (generation_key) do nothing;

-- ---------- 2) คอลัมน์บนตาราง officers ----------
alter table officers add column if not exists generation text;
alter table officers add column if not exists sort_order integer;

-- เติมค่าเริ่มต้น (ข้อมูลเดิมยังเป็น null)
update officers set sort_order = 0 where sort_order is null;
alter table officers alter column sort_order set default 0;
alter table officers alter column sort_order set not null;

-- Backfill: เรียงลำดับเดิมตามชื่อ เพื่อให้ลำดับเริ่มต้นไม่ซ้ำกัน
with ranked as (
  select id, row_number() over (order by lower(name), id) as rn
  from officers
  where sort_order = 0
)
update officers o
set sort_order = ranked.rn
from ranked
where o.id = ranked.id;

-- ---------- 3) Index ----------
create index if not exists officers_sort_order_idx on officers (sort_order);
create index if not exists officers_generation_idx on officers (generation)
  where generation is not null;

-- ---------- 4) RLS ----------
-- หมายเหตุสำคัญ: ระบบนี้ไม่ได้ login ผ่าน Supabase Auth แต่ใช้ตาราง officers
-- ตรวจสิทธิ์เอง (ดู src/lib/AuthContext.tsx) ดังนั้น current_rank() ซึ่งอิง auth.uid()
-- จะคืน NULL เสมอ และ policy ที่ใช้ current_rank() จะไม่มีวันผ่าน
-- → ใช้แนวทางเดียวกับ migration 0024 (storage) และ 0026 (manual_items):
--    "การกันสิทธิ์ทำที่ชั้นแอป" — ตารางนี้เก็บแค่ป้ายชื่อ (label) ของรุ่น
--    ซึ่งเป็นข้อมูลสาธารณะ ไม่มีข้อมูลส่วนตัวหรือข้อมูลรับรอง
alter table officer_generations enable row level security;

drop policy if exists "officer_generations read" on officer_generations;
create policy "officer_generations read" on officer_generations
  for select using (true);

drop policy if exists "officer_generations commissioner write" on officer_generations;
drop policy if exists "officer_generations write" on officer_generations;
create policy "officer_generations write" on officer_generations
  for all
  using (true)
  with check (true);

-- ---------- 5) Realtime ----------
-- ให้หน้าจัดการเจ้าหน้าที่เห็นการเปลี่ยนแปลงรุ่นแบบเรียลไทม์
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'officer_generations'
  ) then
    alter publication supabase_realtime add table officer_generations;
  end if;
end $$;



-- =====================================================================
-- 0028_leave_quota_schedule_and_points.sql
-- =====================================================================
-- =============================================================
-- 0028 — Leave quota, Duty schedule, Work-report approval, PPS engine
-- =============================================================
-- ระบบใหม่ 5 ชุด:
--   1) โควตาการลาประจำเดือน  (leave_quotas + officer_leaves.days)
--   2) ตารางเวรปฏิบัติงาน      (duty_schedules + schedule_overrides)
--   3) อนุมัติรายงานปฏิบัติงาน (work_reports.status + ผู้ตรวจ)
--   4) สวิตช์เปิด/ปิดคะแนนอัตโนมัติ (system_settings.auto_points_enabled)
--   5) เกณฑ์คะแนนอัตโนมัติ    (points_award_marks = กันให้คะแนนซ้ำ)
--
-- หมายเหตุเรื่อง RLS: ระบบนี้ไม่ได้ login ผ่าน Supabase Auth (ดู src/lib/AuthContext.tsx)
-- ทำให้ current_rank() อิง auth.uid() คืน NULL เสมอ — ใช้แนวทางเดียวกับ
-- migration 0024 (storage) / 0026 (manual_items): "การกันสิทธิ์ทำที่ชั้นแอป"
-- =============================================================

-- =============================================================
-- 1) โควตาการลาประจำเดือน
-- =============================================================

create table if not exists leave_quotas (
  leave_type       text primary key
                     check (leave_type in ('sick','personal','vacation','maternity','ordained','other')),
  quota_days       int not null default 0,   -- 0 = ไม่จำกัดโควตา
  notes            text,
  updated_at       timestamptz not null default now(),
  updated_by       uuid references officers(id),
  updated_by_name  text
);

insert into leave_quotas (leave_type, quota_days, notes) values
  ('sick',       3, 'ลาป่วย 3 วัน/คน/เดือน'),
  ('personal',   2, 'ลากิจ 2 วัน/คน/เดือน'),
  ('vacation',   3, 'ลาพักร้อน 3 วัน/คน/เดือน'),
  ('maternity',  0, 'ไม่จำกัดโควตา'),
  ('ordained',   0, 'ไม่จำกัดโควตา'),
  ('other',      0, 'ไม่จำกัดโควตา')
on conflict (leave_type) do nothing;

-- เก็บจำนวนวันลาไว้ในแถวเดียว เพื่อให้คำนวณโควตาได้เร็วโดยไม่ต้องคำนวณซ้ำ
alter table officer_leaves add column if not exists days integer not null default 0;

-- Backfill จำนวนวันของใบลาเดิม (นับแบบรวมวันเริ่มและวันสิ้นสุด)
update officer_leaves
set days = (date_diff('day', start_date::date, end_date::date) + 1)
where days is null or days <= 0;

create index if not exists officer_leaves_officer_dates_idx
  on officer_leaves (officer_id, start_date);

-- =============================================================
-- 2) ตารางเวรปฏิบัติงาน
-- =============================================================

-- ตารางเวรหลัก (วนซ้ำรายสัปดาห์)
create table if not exists duty_schedules (
  id          uuid primary key default gen_random_uuid(),
  weekday     int  not null check (weekday between 0 and 6),  -- 0 = อาทิตย์ ... 6 = เสาร์
  shift_code  text not null default 'day',                    -- day | night
  shift_name  text,
  start_time  text not null default '08:00',
  end_time    text not null default '20:00',
  officer_id  uuid references officers(id) on delete cascade,
  note        text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists duty_schedules_weekday_shift_uidx
  on duty_schedules (weekday, shift_code);
create index if not exists duty_schedules_officer_idx on duty_schedules (officer_id);

-- ข้อยกเว้นต่อวัน (สลับเวร / ลา / เวรพิเศษ / หยุดประจำสัปดาห์นั้น)
create table if not exists schedule_overrides (
  id               uuid primary key default gen_random_uuid(),
  override_date    date not null,
  shift_code       text not null default 'day',     -- day | night | off
  officer_id       uuid references officers(id) on delete cascade,
  override_type    text not null default 'manual'
                     check (override_type in ('swap','leave','extra','off')),
  note             text,
  source           text not null default 'manual'
                     check (source in ('manual','leave_auto')),
  ref_id           text,                              -- เช่น id ของใบลา
  created_by       uuid references officers(id),
  created_by_name  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create unique index if not exists schedule_overrides_date_shift_uidx
  on schedule_overrides (override_date, shift_code);
create index if not exists schedule_overrides_officer_idx on schedule_overrides (officer_id);
create index if not exists schedule_overrides_date_idx on schedule_overrides (override_date);

-- =============================================================
-- 3) อนุมัติรายงานปฏิบัติงาน
-- =============================================================

alter table work_reports add column if not exists status text;
alter table work_reports add column if not exists reviewed_by uuid references officers(id);
alter table work_reports add column if not exists reviewed_by_name text;
alter table work_reports add column if not exists reviewed_at timestamptz;
alter table work_reports add column if not exists review_note text;
alter table work_reports add column if not exists reviewed_points integer not null default 0;

-- ข้อมูลเดิมถือว่าอยู่ระหว่างรอตรวจ
update work_reports set status = 'pending' where status is null;

alter table work_reports alter column status set default 'pending';
alter table work_reports alter column status set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'work_reports_status_check'
  ) then
    alter table work_reports
      add constraint work_reports_status_check
      check (status in ('pending','approved','rejected'));
  end if;
end $$;

create index if not exists work_reports_status_idx on work_reports (status);

-- ร้องเรียน: เพิ่มสถานะ 'verified' (ผลตรวจสอบเป็นจริง → หักคะแนนอัตโนมัติ)
alter table complaints drop constraint if exists complaints_status_check;
alter table complaints
  add constraint complaints_status_check
  check (status in ('pending','reviewing','verified','resolved','dismissed'));

-- =============================================================
-- 4) สวิตช์เปิด/ปิดคะแนนอัตโนมัติ
-- =============================================================

alter table system_settings
  add column if not exists auto_points_enabled boolean not null default true;

-- =============================================================
-- 5) เกณฑ์คะแนนอัตโนมัติ — ป้องกันให้คะแนนซ้ำ
-- =============================================================
-- mark_key เป็น unique เพื่อให้การให้คะแนนแต่ละเหตุการณ์เกิดได้ครั้งเดียว
-- เช่น 'dutyout:<duty_log_id>' / 'report:<work_report_id>' / 'force:<duty_log_id>'
create table if not exists points_award_marks (
  id          uuid primary key default gen_random_uuid(),
  mark_key    text not null unique,
  officer_id  uuid references officers(id) on delete cascade,
  delta       integer not null,
  reason      text,
  created_at  timestamptz not null default now()
);

create index if not exists points_award_marks_officer_idx on points_award_marks (officer_id);

-- =============================================================
-- 6) RLS — ใช้การกันสิทธิ์ที่ชั้นแอป (เหตุผลดูหัวไฟล์)
-- =============================================================

alter table leave_quotas enable row level security;
alter table duty_schedules enable row level security;
alter table schedule_overrides enable row level security;
alter table points_award_marks enable row level security;

drop policy if exists "leave_quotas all" on leave_quotas;
create policy "leave_quotas all" on leave_quotas
  for all using (true) with check (true);

drop policy if exists "duty_schedules all" on duty_schedules;
create policy "duty_schedules all" on duty_schedules
  for all using (true) with check (true);

drop policy if exists "schedule_overrides all" on schedule_overrides;
create policy "schedule_overrides all" on schedule_overrides
  for all using (true) with check (true);

drop policy if exists "points_award_marks read" on points_award_marks;
create policy "points_award_marks read" on points_award_marks
  for select using (true);

drop policy if exists "points_award_marks write" on points_award_marks;
create policy "points_award_marks write" on points_award_marks
  for all using (true) with check (true);

-- work_reports ถูก disable RLS ตั้งแต่ migration 0015 อยู่แล้ว
-- (ต้องให้เขียนได้ เพราะรายงานปฏิบัติงานถูกส่งจากเจ้าหน้าที่ทุกคน)
-- ตรวจสอบให้แน่ใจว่าไม่ถูกเปิดกลับมาโดยไม่ตั้งใจ
alter table work_reports disable row level security;

-- =============================================================
-- 7) Realtime
-- =============================================================

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and tablename = 'duty_schedules') then
      alter publication supabase_realtime add table duty_schedules;
    end if;
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and tablename = 'schedule_overrides') then
      alter publication supabase_realtime add table schedule_overrides;
    end if;
  end if;
end $$;



-- =====================================================================
-- 0029_fix_settings_rls_and_shift_codes.sql
-- =====================================================================
-- =============================================================
-- 0029 — Fix PPS kill switch RLS + shift codes ตามเวลาเปิดเซิร์ฟเวอร์จริง
-- =============================================================
-- 1) แก้ปุ่มสวิตช์เปิด/ปิด PPS Engine (และ kill switch เดิม) กดไม่ได้
--    สาเหตุ: policy เดิมใช้ current_rank() ซึ่งอ่าน auth.uid()
--    แต่ระบบนี้ login ด้วยตาราง officers เอง → auth.uid() = NULL
--    → policy ไม่มีวันผ่าน → UPDATE ถูกปฏิเสธเงียบ ๆ (UI เหมือนไม่ทำงาน)
--
-- 2) เปลี่ยนรหัสกะจาก day/night เป็น s1/s2 ให้ตรงกับเวลาเปิดเซิร์ฟเวอร์
--    จันทร์–ศุกร์  18:30–21:30  → กะที่ 1: 18:30–20:00 · กะที่ 2: 20:00–21:30
--    เสาร์–อาทิตย์ 18:30–23:00  → กะที่ 1: 18:30–20:45 · กะที่ 2: 20:45–23:00
-- =============================================================

-- ---------- 1) แก้ RLS ของ system_settings ----------
-- ใช้แนวทางเดียวกับ 0024 (storage), 0026 (manual_items), 0027 (officer_generations):
-- "การกันสิทธิ์ทำที่ชั้นแอป" — ทุกหน้าที่เขียน system_settings ถูกจำกัด
-- ด้วย isCommissioner อยู่แล้ว (DashboardPage / OperationsPage)
drop policy if exists "system_settings read" on system_settings;
drop policy if exists "system_settings write" on system_settings;
drop policy if exists "system_settings read update" on system_settings;
drop policy if exists "system_settings update" on system_settings;
drop policy if exists "system_settings upsert" on system_settings;

create policy "system_settings read" on system_settings
  for select using (true);

create policy "system_settings update" on system_settings
  for update using (true) with check (true);

-- ---------- 2) เปลี่ยนรหัสกะ ----------
-- ย้ายข้อมูลเดิม day → s1, night → s2 (ปลอดภัยถ้ารันซ้ำ เพราะค่าจะไม่ match อีก)
update duty_schedules set shift_code = 's1' where shift_code = 'day';
update duty_schedules set shift_code = 's2' where shift_code = 'night';
update schedule_overrides set shift_code = 's1' where shift_code = 'day';
update schedule_overrides set shift_code = 's2' where shift_code = 'night';

alter table duty_schedules    alter column shift_code set default 's1';
alter table schedule_overrides alter column shift_code set default 's1';

-- ล้างป้ายชื่อกะเดิม (กะเช้า/กะดึก) ให้เป็นป้ายตามตำแหน่งกะ
update duty_schedules set shift_name = 'กะที่ 1' where shift_code = 's1' and (shift_name is null or shift_name in ('กะเช้า', 'day'));
update duty_schedules set shift_name = 'กะที่ 2' where shift_code = 's2' and (shift_name is null or shift_name in ('กะดึก', 'night'));

-- ---------- 3) การันตีว่าคอลัมน์สวิตช์มีอยู่จริง ----------
-- (0028 เพิ่ม auto_points_enabled — ประกันว่าถ้า 0028 ยังไม่ถูก apply ให้เพิ่มตรงนี้)
alter table system_settings
  add column if not exists auto_points_enabled boolean not null default true;



-- =====================================================================
-- 0030_multi_officer_shift.sql
-- =====================================================================
-- =============================================================
-- 0030 — หลายเจ้าหน้าที่ต่อ 1 กะ (Multi-Officer Shift Allocation)
-- =============================================================
-- เดิม: duty_schedules / schedule_overrides ผูก UNIQUE ที่ (ช่องกะ) ไว้
--        → 1 ช่องกะมีได้แค่ 1 คน
-- ใหม่: 1 ช่องกะมีได้หลายคน (แยก 1 แถวต่อ 1 คน)
--
-- กติกาการมองเห็นที่ฝั่ง client (src/lib/dutySchedule.ts):
--   - แถวที่ officer_id IS NULL + override_type='off'  = ปิดทั้งช่องกะ
--   - แถว type='swap'   = ใช้คนในแถว swap แทนผังประจำทั้งช่อง
--   - แถว type='leave'  = ตัดคนนั้นออกจากช่องกะของวันนั้น (ป้าย "ลา")
--   - แถว type='extra'  = เพิ่มคนเข้าไปในช่องกะของวันนั้น (ป้าย "เวรพิเศษ")
--   - แถว type='off' + officer_id = ตัดคนนั้นออกเฉพาะบุคคล
-- =============================================================

-- ---------- 1) คอลัมน์กำลังพลที่ต้องการ ----------
alter table duty_schedules
  add column if not exists required_officers integer not null default 2;
alter table schedule_overrides
  add column if not exists required_officers integer;

-- ---------- 2) ปลดข้อจำกัด UNIQUE เดิม ----------
drop index if exists duty_schedules_weekday_shift_uidx;
drop index if exists schedule_overrides_date_shift_uidx;

-- ---------- 3) UNIQUE ใหม่ (ต่อคน) ----------
-- ผังประจำ: หนึ่งคนต่อหนึ่งช่องกะ
create unique index if not exists duty_schedules_slot_officer_uidx
  on duty_schedules (weekday, shift_code, officer_id)
  where officer_id is not null;

-- ข้อยกเว้น: หนึ่งคนต่อหนึ่งช่องกะของวันนั้น
create unique index if not exists schedule_overrides_slot_officer_uidx
  on schedule_overrides (override_date, shift_code, officer_id)
  where officer_id is not null;

-- ปิดทั้งช่องกะ (ไม่ผูกกับคน) → อนุญาตได้เพียงแถวเดียวต่อช่อง
create unique index if not exists schedule_overrides_slot_off_uidx
  on schedule_overrides (override_date, shift_code)
  where officer_id is null and override_type = 'off';

-- ---------- 4) Index สำหรับ query ----------
create index if not exists duty_schedules_slot_idx
  on duty_schedules (weekday, shift_code);
create index if not exists schedule_overrides_slot_idx
  on schedule_overrides (override_date, shift_code);


-- =====================================================================
-- ตรวจสอบผลลัพธ์ (รันหลังจากส่วนบนสำเร็จ) — ทุกบรรทัดควรได้ค่า ok
-- =====================================================================

select 'officer_generations'  as item, count(*)::text as value from officer_generations
union all select 'leave_quotas', count(*)::text from leave_quotas
union all select 'duty_schedules', count(*)::text from duty_schedules
union all select 'schedule_overrides', count(*)::text from schedule_overrides
union all select 'points_award_marks', count(*)::text from points_award_marks;

-- คอลัมน์ที่ต้องมีบน officers
select column_name, data_type, column_default, is_nullable
from information_schema.columns
where table_name = 'officers'
  and column_name in ('generation', 'sort_order')
order by column_name;

-- คอลัมน์ที่ต้องมีบน work_reports (คาดว่า 6)
select column_name, data_type
from information_schema.columns
where table_name = 'work_reports'
  and column_name in ('status', 'reviewed_by', 'reviewed_by_name', 'reviewed_at',
                      'review_note', 'reviewed_points')
order by column_name;

-- คอลัมน์ที่ต้องมีบน officer_leaves / system_settings / duty_schedules
select table_name, column_name, data_type
from information_schema.columns
where (table_name = 'officer_leaves' and column_name = 'days')
   or (table_name = 'system_settings' and column_name = 'auto_points_enabled')
   or (table_name = 'duty_schedules' and column_name = 'required_officers')
order by table_name;

-- RLS ของ system_settings ต้องเป็น 2 policy (read + update) ไม่ใช่ policy ที่ใช้ current_rank()
select policyname, cmd, qual as using_expr
from pg_policies
where tablename = 'system_settings'
order by policyname;

-- ต้องไม่มี UNIQUE เดิมที่บังคับ 1 คนต่อช่องกะอีกแล้ว
select indexname
from pg_indexes
where tablename in ('duty_schedules', 'schedule_overrides')
  and indexname in ('duty_schedules_weekday_shift_uidx', 'schedule_overrides_date_shift_uidx');
