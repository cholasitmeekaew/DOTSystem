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
-- ตารางอ้างอิง (label ของรุ่น) เป็นข้อมูลสาธารณะ เพื่อให้หน้าทำเนียบบุคลากร
-- (หน้าสาธารณะ ยังไม่ login) อ่านได้ — การเขียนจำกัดที่หัวหน้ากรม
alter table officer_generations enable row level security;

drop policy if exists "officer_generations read" on officer_generations;
create policy "officer_generations read" on officer_generations
  for select using (true);

drop policy if exists "officer_generations commissioner write" on officer_generations;
create policy "officer_generations commissioner write" on officer_generations
  for all
  using (current_rank() = 'commissioner')
  with check (current_rank() = 'commissioner');

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