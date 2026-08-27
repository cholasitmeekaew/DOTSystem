-- =============================================================
-- Row Level Security policies
-- ทุก table ใช้ RLS + แยกสิทธิ์ตาม rank (commissioner/inspector/officer)
-- =============================================================

-- เปิด RLS
alter table officers enable row level security;
alter table officer_ranks enable row level security;
alter table citizens enable row level security;
alter table vehicles enable row level security;
alter table licenses enable row level security;
alter table service_rates enable row level security;
alter table service_records enable row level security;
alter table duty_logs enable row level security;
alter table announcements enable row level security;
alter table complaints enable row level security;
alter table emergency_reports enable row level security;
alter table officer_leaves enable row level security;
alter table audit_logs enable row level security;
alter table system_settings enable row level security;

-- ทุกคนที่ login แล้วอ่านได้
create policy "officer_ranks read" on officer_ranks for select using (auth.uid() is not null);

-- Officers: ทุกคนอ่านได้, แก้ไขเฉพาะตัวเอง + commissioner
create policy "officers read" on officers for select using (auth.uid() is not null);
create policy "officers self update" on officers for update
  using (id = auth.uid() or current_rank() = 'commissioner');
create policy "officers commissioner write" on officers for insert
  with check (current_rank() = 'commissioner');
create policy "officers commissioner delete" on officers for delete
  using (current_rank() = 'commissioner');

-- Citizens: ทุก DOT rank อ่านได้, เขียนได้เฉพาะ inspector+
create policy "citizens read" on citizens for select
  using (current_rank() in ('commissioner','inspector','officer'));
create policy "citizens write" on citizens for all
  using (current_rank() in ('commissioner','inspector'));

-- Vehicles: ทุก DOT rank อ่านได้, เขียนได้เฉพาะ inspector+
create policy "vehicles read" on vehicles for select
  using (current_rank() in ('commissioner','inspector','officer'));
create policy "vehicles write" on vehicles for all
  using (current_rank() in ('commissioner','inspector'));

-- Licenses: ทุก DOT rank อ่านได้, เขียนได้เฉพาะ inspector+
create policy "licenses read" on licenses for select
  using (current_rank() in ('commissioner','inspector','officer'));
create policy "licenses write" on licenses for all
  using (current_rank() in ('commissioner','inspector'));

-- Service rates: ทุกคนอ่านได้, เขียนได้เฉพาะ commissioner
create policy "service_rates read" on service_rates for select using (auth.uid() is not null);
create policy "service_rates write" on service_rates for all
  using (current_rank() = 'commissioner');

-- Service records: ทุก DOT rank อ่านได้, สร้างได้ทุกคน, แก้ไขได้เฉพาะเจ้าของ + inspector+
create policy "service_records read" on service_records for select
  using (current_rank() in ('commissioner','inspector','officer'));
create policy "service_records insert" on service_records for insert
  with check (current_rank() in ('commissioner','inspector','officer'));
create policy "service_records update" on service_records for update
  using (current_rank() in ('commissioner','inspector') or officer_id = auth.uid());

-- Duty logs: ทุก DOT rank อ่านได้, officer เขียนของตัวเองได้, inspector+ เขียนของใครก็ได้
create policy "duty_logs read" on duty_logs for select
  using (current_rank() in ('commissioner','inspector','officer'));
create policy "duty_logs insert self" on duty_logs for insert
  with check (current_rank() in ('commissioner','inspector','officer'));
create policy "duty_logs update self" on duty_logs for update
  using (officer_id = auth.uid() or current_rank() in ('commissioner','inspector'));

-- Announcements: ทุกคนอ่าน, commissioner เขียน
create policy "announcements read" on announcements for select using (auth.uid() is not null);
create policy "announcements write" on announcements for all
  using (current_rank() = 'commissioner');

-- Complaints: ทุกคนอ่าน, commissioner จัดการ
create policy "complaints read" on complaints for select using (auth.uid() is not null);
create policy "complaints write" on complaints for all
  using (current_rank() = 'commissioner');
-- ประชาชนที่ยังไม่ได้ login ส่งได้ (anon)
create policy "complaints anon insert" on complaints for insert
  with check (true);

-- Emergency reports: ทุก DOT rank อ่าน, anon ส่งได้
create policy "emergency_reports read" on emergency_reports for select
  using (current_rank() in ('commissioner','inspector','officer'));
create policy "emergency_reports anon insert" on emergency_reports for insert
  with check (true);
create policy "emergency_reports update" on emergency_reports for update
  using (current_rank() in ('commissioner','inspector'));

-- Officer leaves: เจ้าของอ่าน/สร้าง, inspector+ อนุมัติ
create policy "officer_leaves read" on officer_leaves for select
  using (officer_id = auth.uid() or current_rank() in ('commissioner','inspector'));
create policy "officer_leaves insert" on officer_leaves for insert
  with check (current_rank() in ('commissioner','inspector','officer'));
create policy "officer_leaves update" on officer_leaves for update
  using (officer_id = auth.uid() or current_rank() in ('commissioner','inspector'));

-- Audit logs: เฉพาะ commissioner อ่านได้, ทุกคน insert ได้
create policy "audit_logs read" on audit_logs for select
  using (current_rank() = 'commissioner');
create policy "audit_logs insert" on audit_logs for insert
  with check (auth.uid() is not null);

-- System settings: ทุกคนอ่าน, เฉพาะ commissioner แก้ไข
create policy "system_settings read" on system_settings for select using (auth.uid() is not null);
create policy "system_settings write" on system_settings for update
  using (current_rank() = 'commissioner');
