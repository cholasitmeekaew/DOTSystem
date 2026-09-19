-- =============================================================
-- Payroll Manual Overrides
-- เก็บตัวเลข manual input สำหรับการคำนวณเงินเดือนรายบุคคล
-- =============================================================

create table if not exists payroll_overrides (
  officer_id uuid not null references officers(id) on delete cascade,
  period_month text not null,
  manual_duty_income numeric(12,2),
  manual_service_income numeric(12,2),
  manual_bonus numeric(12,2),
  manual_total_net_payout numeric(12,2),
  is_manual_mode boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by_id uuid not null references officers(id),
  updated_by_name text not null,
  primary key (officer_id, period_month)
);

create index if not exists payroll_overrides_period_idx
  on payroll_overrides (period_month);

alter table payroll_overrides enable row level security;

drop policy if exists "payroll_overrides read" on payroll_overrides;
create policy "payroll_overrides read" on payroll_overrides
  for select using (auth.uid() is not null);

drop policy if exists "payroll_overrides commissioner upsert" on payroll_overrides;
create policy "payroll_overrides commissioner upsert" on payroll_overrides
  for insert with check (current_rank() = 'commissioner');

drop policy if exists "payroll_overrides commissioner update" on payroll_overrides;
create policy "payroll_overrides commissioner update" on payroll_overrides
  for update using (current_rank() = 'commissioner')
  with check (current_rank() = 'commissioner');
