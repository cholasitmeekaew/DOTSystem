-- =============================================================
-- Revenue Sharing System
-- 1) service_record_officers (many-to-many)
-- 2) revenue_sharing_config (percentages per scope)
-- 3) service_record_revenue_overrides (per-record manual edit)
-- 4) snapshot columns on service_records
-- 5) RPC: calculate_service_revenue
-- =============================================================

-- 1) Many-to-many
create table if not exists service_record_officers (
  service_record_id uuid references service_records(id) on delete cascade,
  officer_id uuid references officers(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  assigned_by uuid references officers(id),
  primary key (service_record_id, officer_id)
);
create index if not exists sro_officer_idx on service_record_officers (officer_id);
create index if not exists sro_record_idx on service_record_officers (service_record_id);

alter table service_record_officers enable row level security;
drop policy if exists "sro read" on service_record_officers;
create policy "sro read" on service_record_officers
  for select using (auth.uid() is not null);
drop policy if exists "sro officer write" on service_record_officers;
create policy "sro officer write" on service_record_officers
  for all using (officer_id = auth.uid() OR current_rank() = 'commissioner')
  with check (officer_id = auth.uid() OR current_rank() = 'commissioner');

-- 2) Config
create table if not exists revenue_sharing_config (
  scope text primary key check (scope in ('default','vehicle_rescue')),
  officer_share_percent numeric(5,2) not null default 20.00
    check (officer_share_percent >= 0 and officer_share_percent <= 100),
  central_share_percent numeric(5,2) not null default 80.00
    check (central_share_percent >= 0 and central_share_percent <= 100),
  notes text,
  updated_at timestamptz not null default now(),
  updated_by uuid references officers(id)
);

insert into revenue_sharing_config (scope, officer_share_percent, central_share_percent, notes) values
  ('default', 10.00, 90.00, 'เคสบริการทั่วไป: 10% เจ้าหน้าที่รับเคส (หารเฉลี่ย), 90% กองกลาง'),
  ('vehicle_rescue', 10.00, 90.00, 'หน่วยกู้ภัยรถยก: 10% เจ้าหน้าที่รับเคส (หารเฉลี่ย), 90% กองหน่วย')
on conflict (scope) do nothing;

alter table revenue_sharing_config enable row level security;
drop policy if exists "rsc read" on revenue_sharing_config;
create policy "rsc read" on revenue_sharing_config
  for select using (auth.uid() is not null);
drop policy if exists "rsc commissioner write" on revenue_sharing_config;
create policy "rsc commissioner write" on revenue_sharing_config
  for all using (current_rank() = 'commissioner')
  with check (current_rank() = 'commissioner');

-- 3) Override per-record
create table if not exists service_record_revenue_overrides (
  service_record_id uuid primary key references service_records(id) on delete cascade,
  officer_share numeric(10,2) not null check (officer_share >= 0),
  central_share numeric(10,2) not null check (central_share >= 0),
  reason text,
  edited_at timestamptz not null default now(),
  edited_by uuid references officers(id)
);

alter table service_record_revenue_overrides enable row level security;
drop policy if exists "srro read" on service_record_revenue_overrides;
create policy "srro read" on service_record_revenue_overrides
  for select using (auth.uid() is not null);
drop policy if exists "srro commissioner write" on service_record_revenue_overrides;
create policy "srro commissioner write" on service_record_revenue_overrides
  for all using (current_rank() = 'commissioner')
  with check (current_rank() = 'commissioner');

-- 4) Snapshot columns
alter table service_records
  add column if not exists officer_share numeric(10,2) default 0,
  add column if not exists central_share numeric(10,2) default 0,
  add column if not exists assigned_officer_count integer default 0,
  add column if not exists service_category text;

-- 5) RPC
create or replace function calculate_service_revenue(
  p_service_record_id uuid,
  p_officer_share_percent numeric
) returns void
language plpgsql
security definer
as $$
declare
  v_amount numeric;
  v_total numeric;
  v_count integer;
begin
  select amount into v_amount from service_records where id = p_service_record_id;
  select count(*) into v_count from service_record_officers where service_record_id = p_service_record_id;

  v_total := v_amount * p_officer_share_percent / 100.0;
  v_total := round(v_total * 100) / 100;

  update service_records
  set officer_share = v_total,
      central_share = v_amount - v_total,
      assigned_officer_count = v_count
  where id = p_service_record_id;
end;
$$;

-- หลัง apply รัน:
--   NOTIFY pgrst, 'reload schema';
