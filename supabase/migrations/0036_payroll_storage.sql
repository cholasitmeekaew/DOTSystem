-- =============================================================
-- 0036 — ย้ายข้อมูลงบเงินเดือนจาก localStorage เข้าฐานข้อมูลจริง
-- =============================================================
-- ปัญหา: payroll snapshots (ยอดที่อนุมัติจ่ายไปแล้ว) และ manual budget
--   injections (งบที่เติมเอง) ถูกเก็บใน localStorage ของเบราว์เซอร์
--
--   ผลกระทบ: ล้างเบราว์เซอร์ / เปลี่ยนเครื่อง / เปิดคนละเครื่อง
--           → ยอดที่จ่ายไปแล้วหาย → netAvailableBudget ดูเหมือนยังไม่จ่าย
--           → อนุมัติจ่ายงวดเดิมซ้ำได้ (สูญเสียงบประมาณจริง)
--
-- แก้โดยย้ายไปเก็บในตารางจริง พร้อม RLS ให้เข้าถึงได้เหมือนตารางการเงินอื่น
-- =============================================================

-- ---------- ตารางงบที่เติมเอง ----------
create table if not exists public.manual_budget_injections (
  id            text primary key,
  amount        numeric(14,2) not null check (amount <> 0),
  department    text not null,
  reason        text,
  injected_by   uuid references public.officers(id) on delete set null,
  injected_by_name text,
  created_at    timestamptz not null default now()
);

comment on table public.manual_budget_injections is
  'งบที่เติมเพิ่มจากนอกระบบ (เงินสนับสนุนพิเศษ) — เดิมเก็บใน localStorage จึงหายเมื่อล้างเบราว์เซอร์';

-- ---------- ตาราง snapshot การจ่ายเงินเดือน ----------
create table if not exists public.payroll_snapshots (
  id                text primary key,
  period_month      text not null,          -- 'YYYY-MM'
  payout_date       text not null,
  total_amount      numeric(14,2) not null default 0,
  officer_count     integer not null default 0,
  approved_by_id    uuid references public.officers(id) on delete set null,
  approved_by_name  text,
  approved_by_rank  text,
  notes             text,
  breakdown         jsonb not null default '[]'::jsonb,
  created_at        timestamptz not null default now()
);

comment on table public.payroll_snapshots is
  'ล็อกถาวรรายงวดที่อนุมัติจ่ายแล้ว — ใช้คำนวณยอดที่จ่ายออกไปทั้งหมด';

-- ---------- ดัชนี ----------
create index if not exists payroll_snapshots_period_idx
  on public.payroll_snapshots (period_month desc);
create index if not exists manual_budget_injections_created_idx
  on public.manual_budget_injections (created_at desc);

-- ---------- RLS ----------
-- ระบบนี้ยังไม่ได้เชื่อม Supabase Auth (auth.uid() = NULL) จึงใช้แบบเดียวกับ
-- ตารางการเงินที่มีอยู่แล้ว — คุมสิทธิ์ที่ชั้นแอป ไม่ปิด RLS เพื่อไม่ให้การเงินพังเงียบ
alter table public.manual_budget_injections enable row level security;
alter table public.payroll_snapshots enable row level security;

do $$
declare t text;
begin
  foreach t in array array['manual_budget_injections', 'payroll_snapshots'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format(
      'create policy %I on public.%I for select using (true)', t || '_read', t);
    execute format(
      'create policy %I on public.%I for all using (true) with check (true)',
      t || '_write', t);
  end loop;
end $$;

-- ---------- ตรวจสอบ ----------
do $$
begin
  if exists (select 1 from pg_class
             where relname = 'payroll_snapshots'
               and relnamespace = 'public'::regnamespace)
     and exists (select 1 from pg_class
                 where relname = 'manual_budget_injections'
                   and relnamespace = 'public'::regnamespace) then
    raise notice '0036 สำเร็จ: ย้ายข้อมูลงบเงินเดือนเข้าฐานข้อมูลแล้ว';
  else
    raise exception '0036 ล้มเหลว: ตารางไม่ครบ';
  end if;
end $$;
