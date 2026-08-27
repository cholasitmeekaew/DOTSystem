-- =============================================================
-- DOTSystem — initial schema
-- ใช้กับ Supabase mode (VITE_SUPABASE_URL ตั้งค่าแล้ว)
-- =============================================================

-- Helper: rank ของ user ปัจจุบัน (จาก officer row)
create or replace function current_rank() returns text
language sql stable security definer
set search_path = public
as $$
  select rank from officers where id = auth.uid();
$$;

-- ------------------ system_settings ------------------
create table if not exists system_settings (
  id int primary key default 1,
  duty_system_enabled boolean not null default true,
  login_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  updated_by_name text,
  check (id = 1)
);

insert into system_settings (id, duty_system_enabled, login_enabled)
values (1, true, true)
on conflict (id) do nothing;

-- ------------------ officer_ranks ------------------
create table if not exists officer_ranks (
  id text primary key,
  label text not null,
  rank_key text unique,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into officer_ranks (id, label, rank_key, sort_order) values
  ('rank_commissioner', 'หัวหน้ากรมขนส่ง', 'commissioner', 1),
  ('rank_inspector', 'ผู้คุมสอบกรมขนส่ง', 'inspector', 2),
  ('rank_officer', 'พนักงาน', 'officer', 3)
on conflict (id) do nothing;

-- ------------------ officers ------------------
create table if not exists officers (
  id uuid primary key default gen_random_uuid(),
  username text unique not null,
  password_hash text not null,
  name text not null,
  rank text not null check (rank in ('commissioner','inspector','officer')),
  department text not null check (department in (
    'civil_maintenance','vehicle_rescue','electrical','traffic_management','emergency_assistance'
  )),
  status text not null default 'active' check (status in ('active','suspended','deleted')),
  is_on_duty boolean not null default false,
  photo_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- สร้าง admin default (password = admin1234 hash = sha256)
insert into officers (id, username, password_hash, name, rank, department, status)
values (
  '00000000-0000-0000-0000-000000000001',
  'admin',
  'ac9689e2272427085e35b9d3e3e8bed88cb3434828b43b86fc0596cad4c6e270',
  'หัวหน้ากรมขนส่ง',
  'commissioner',
  'traffic_management',
  'active'
)
on conflict (id) do nothing;

-- ------------------ citizens ------------------
create table if not exists citizens (
  id uuid primary key default gen_random_uuid(),
  roblox_username text not null,
  discord_username text,
  status text not null default 'normal' check (status in ('normal','watched','suspended')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists citizens_roblox_username_key on citizens (lower(roblox_username));

-- ------------------ vehicles ------------------
create table if not exists vehicles (
  id uuid primary key default gen_random_uuid(),
  license_plate text not null,
  owner_name text,
  vehicle_type text not null check (vehicle_type in (
    'sedan','suv','pickup','motorcycle','truck','van','other'
  )),
  color text,
  brand_model text,
  vehicle_category text,
  citizen_id uuid references citizens(id) on delete set null,
  is_impounded boolean not null default false,
  impound_reason text,
  impound_location text,
  impounded_at timestamptz,
  impounded_by uuid references officers(id),
  impounded_by_name text,
  released_at timestamptz,
  released_by uuid references officers(id),
  released_by_name text,
  notes text,
  image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists vehicles_license_plate_idx on vehicles (license_plate);
create index if not exists vehicles_is_impounded_idx on vehicles (is_impounded);

-- ------------------ licenses ------------------
create table if not exists licenses (
  id uuid primary key default gen_random_uuid(),
  roblox_username text not null,
  discord_username text,
  license_type text not null,
  license_number text unique,
  issue_date date not null,
  expiry_date date,
  status text not null default 'active' check (status in ('active','suspended','revoked','expired')),
  issued_by uuid references officers(id),
  issued_by_name text,
  notes text,
  citizen_id uuid references citizens(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists licenses_roblox_username_idx on licenses (roblox_username);

-- ------------------ service_rates ------------------
create table if not exists service_rates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  price numeric(10,2) not null default 0,
  category text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists service_rates_category_idx on service_rates (category);

-- ------------------ service_records ------------------
create table if not exists service_records (
  id uuid primary key default gen_random_uuid(),
  roblox_username text not null,
  discord_username text,
  service_rate_id uuid references service_rates(id) on delete set null,
  service_name text not null,
  amount numeric(10,2) not null default 0,
  status text not null default 'unpaid' check (status in ('paid','unpaid')),
  service_type text not null default 'normal' check (service_type in ('normal','impound')),
  officer_id uuid references officers(id),
  officer_name text,
  notes text,
  evidence_url text,
  service_date date not null default current_date,
  citizen_id uuid references citizens(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists service_records_status_idx on service_records (status);
create index if not exists service_records_service_date_idx on service_records (service_date);

-- ------------------ duty_logs ------------------
create table if not exists duty_logs (
  id uuid primary key default gen_random_uuid(),
  officer_id uuid references officers(id) on delete set null,
  officer_name text not null,
  clock_in timestamptz not null,
  clock_out timestamptz,
  duration_minutes int,
  forced_by uuid references officers(id),
  forced_by_name text,
  checkout_method text,
  deleted_at timestamptz,
  deleted_by uuid references officers(id),
  deleted_by_name text,
  delete_reason text,
  created_at timestamptz not null default now()
);
create index if not exists duty_logs_officer_id_idx on duty_logs (officer_id);
create index if not exists duty_logs_clock_in_idx on duty_logs (clock_in);
create index if not exists duty_logs_deleted_at_idx on duty_logs (deleted_at);

-- ------------------ announcements ------------------
create table if not exists announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null,
  image_url text,
  is_pinned boolean not null default false,
  created_by uuid references officers(id),
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------ complaints ------------------
create table if not exists complaints (
  id uuid primary key default gen_random_uuid(),
  complainant_name text,
  complainant_contact text,
  officer_name text,
  category text,
  description text,
  discord_username text,
  incident_datetime timestamptz,
  details text,
  evidence_url text,
  status text not null default 'pending' check (status in ('pending','reviewing','resolved','dismissed')),
  created_at timestamptz not null default now()
);

-- ------------------ emergency_reports ------------------
create table if not exists emergency_reports (
  id uuid primary key default gen_random_uuid(),
  discord_username text not null,
  report_type text not null check (report_type in ('accident','breakdown','towing','other')),
  details text not null,
  location text,
  image_url text,
  status text not null default 'pending' check (status in ('pending','responding','resolved','dismissed')),
  responded_by uuid references officers(id),
  responded_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists emergency_reports_status_idx on emergency_reports (status);

-- ------------------ officer_leaves ------------------
create table if not exists officer_leaves (
  id uuid primary key default gen_random_uuid(),
  officer_id uuid references officers(id) on delete set null,
  officer_name text not null,
  leave_type text not null check (leave_type in ('sick','personal','vacation','maternity','ordained','other')),
  start_date date not null,
  end_date date not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  reason text,
  reviewed_by uuid references officers(id),
  reviewed_by_name text,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------ audit_logs ------------------
create table if not exists audit_logs (
  id bigserial primary key,
  action text not null,
  target_type text not null,
  target_id text,
  performed_by uuid references officers(id),
  performed_by_name text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_logs_action_idx on audit_logs (action);
create index if not exists audit_logs_created_at_idx on audit_logs (created_at);
