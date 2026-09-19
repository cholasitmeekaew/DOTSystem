-- =============================================================
-- Officer Rates + Department Balances
-- เพิ่ม duty_rate, service_category ต่อเจ้าหน้าที่
-- เพิ่มตาราง department_balances เก็บยอดเงินสะสม (90% จาก service_records)
-- =============================================================

-- 1) ค่าขึ้นเวร (ต่อเจ้าหน้าที่)
alter table officers
  add column if not exists duty_rate numeric(10,2) not null default 0
    check (duty_rate >= 0);

-- 2) service category ที่รับผิดชอบ (ไม่ fix rate ตอนเพิ่มเจ้าหน้าที่)
alter table officers
  add column if not exists service_category text
    check (service_category in (
      'civil_maintenance','vehicle_rescue','electrical',
      'traffic_management','emergency_assistance','general'
    ));

-- 3) ตารางยอดเงินแผนก
create table if not exists department_balances (
  department text primary key
    check (department in (
      'civil_maintenance','vehicle_rescue','electrical',
      'traffic_management','emergency_assistance'
    )),
  balance numeric(12,2) not null default 0
    check (balance >= 0),
  total_earned numeric(12,2) not null default 0,
  updated_at timestamptz not null default now()
);

-- 4) Seed row ทุกแผนก
insert into department_balances (department) values
  ('civil_maintenance'),
  ('vehicle_rescue'),
  ('electrical'),
  ('traffic_management'),
  ('emergency_assistance')
on conflict (department) do nothing;

-- 5) RLS
alter table department_balances enable row level security;

drop policy if exists "department_balances read" on department_balances;
create policy "department_balances read" on department_balances
  for select using (auth.uid() is not null);

drop policy if exists "department_balances commissioner update" on department_balances;
create policy "department_balances commissioner update" on department_balances
  for update using (current_rank() = 'commissioner')
  with check (current_rank() = 'commissioner');

-- 6) RPC — atomic increment balance (เรียกจาก client ตอนบันทึก service fee paid)
create or replace function increment_department_balance(
  p_department text,
  p_amount numeric
) returns void
language plpgsql
security definer
as $$
begin
  update department_balances
  set balance = balance + p_amount,
      total_earned = total_earned + p_amount,
      updated_at = now()
  where department = p_department;
end;
$$;

-- 7) Index
create index if not exists service_records_category_idx
  on service_records (service_rate_id, status);

-- หมายเหตุ: หลัง apply แล้ว รันใน SQL Editor:
--   NOTIFY pgrst, 'reload schema';
-- เพื่อให้ PostgREST cache refresh
