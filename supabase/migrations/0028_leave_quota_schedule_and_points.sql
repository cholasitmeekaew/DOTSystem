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