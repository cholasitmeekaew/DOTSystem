-- =============================================================
-- 0032 — คู่มือแบบแก้ไขได้ (Chapters / Sections / Content Blocks)
-- =============================================================
-- เดิม: เนื้อหาหลักอยู่เป็น ReactNode ใน src/data/manualContent.tsx
--       (11 บท / 83 หมวดย่อย) แก้ไขไม่ได้จากหน้าเว็บ
--       มี manual_items แยกต่างหาก เป็นรายการเสริมแบบราบ
-- ใหม่: ย้ายโครงสร้างเป็นบท → หมวดย่อย → บล็อกเนื้อหา เก็บใน DB
--       แก้ชื่อ/ลบ/จัดลำดับ/แทรกรูป ได้จากหน้าเว็บ
--
-- ข้อสำคัญ: บท/หมวดย่อยที่ยังไม่ได้แตะในระบบ จะอ่านชื่อและเนื้อหาจากโค้ดเดิมต่อไป
--   - title / sort_order = NULL  → ใช้ค่าจากโค้ด
--   - uses_blocks = false        → เนื้อหามาจากโค้ด (ReactNode)
--   - uses_blocks = true         → เนื้อหามาจาก manual_blocks
-- ทำให้ย้ายทีละส่วนได้โดยไม่ต้องแตะเนื้อหา 95 หมวดย่อยในครั้งเดียว
--
-- ชนิดบล็อก:
--   text    = ย่อหน้า/หัวข้อ/รายการ (เก็บเป็น HTML เพื่อให้ ul/ol/h3 ทำงานเหมือนเดิม)
--   image   = รูปภาพ (content = URL)
--   table   = ตาราง (เก็บ HTML ของ <table> ไว้ใน meta.html)
--   callout = กล่องเน้น/หัวเรื่องสี (เก็บ <div> + class เดิมไว้ใน meta.html)
--   html    = อื่น ๆ ที่ไม่เข้าเงื่อนไขข้างบน (กันเนื้อหาหาย)
-- =============================================================

-- ---------- 1) บท ----------
create table if not exists manual_chapters (
  variant text not null default 'officer',
  id text not null,
  title text,
  number text,
  sort_order integer,
  is_hidden boolean not null default false,
  updated_by uuid references officers(id) on delete set null,
  updated_by_name text,
  updated_at timestamz not null default now(),
  primary key (variant, id)
);

-- ---------- 2) หมวดย่อย ----------
create table if not exists manual_sections (
  variant text not null default 'officer',
  id text not null,
  chapter_id text not null,
  title text,
  sort_order integer,
  is_hidden boolean not null default false,
  -- false = อ่านเนื้อหาจากโค้ด / true = อ่านจาก manual_blocks
  uses_blocks boolean not null default false,
  updated_by uuid references officers(id) on delete set null,
  updated_by_name text,
  updated_at timestamz not null default now(),
  primary key (variant, id)
);

-- ---------- 3) บล็อกเนื้อหา ----------
create table if not exists manual_blocks (
  id uuid primary key default gen_random_uuid(),
  variant text not null default 'officer',
  section_id text not null,
  type text not null default 'text'
    check (type in ('text','image','table','callout','html')),
  content text not null default '',
  caption text,
  order_index integer not null default 0,
  meta jsonb not null default '{}'::jsonb,
  updated_by uuid references officers(id) on delete set null,
  updated_by_name text,
  updated_at timestamz not null default now()
);

-- ไม่ใส่ unique บน (variant, section_id, order_index) เพราะตอนสลับลำดับ
-- ค่าจะชนกันชั่วขณะ ถ้าใส่จะทำให้การลากจัดลำดับล้มเหลวกลางคัน
create index if not exists manual_blocks_section_idx
  on manual_blocks (variant, section_id, order_index);

create index if not exists manual_sections_chapter_idx
  on manual_sections (variant, chapter_id, sort_order);

-- ---------- 4) RLS ----------
-- อ่านได้ทุกคน (หน้าคู่มือเป็นของสาธารณะ)
alter table manual_chapters enable row level security;
alter table manual_sections enable row level security;
alter table manual_blocks enable row level security;

drop policy if exists "manual_chapters read" on manual_chapters;
create policy "manual_chapters read" on manual_chapters for select using (true);
drop policy if exists "manual_chapters write" on manual_chapters;
create policy "manual_chapters write" on manual_chapters for all using (true) with check (true);

drop policy if exists "manual_sections read" on manual_sections;
create policy "manual_sections read" on manual_sections for select using (true);
drop policy if exists "manual_sections write" on manual_sections;
create policy "manual_sections write" on manual_sections for all using (true) with check (true);

drop policy if exists "manual_blocks read" on manual_blocks;
create policy "manual_blocks read" on manual_blocks for select using (true);
drop policy if exists "manual_blocks write" on manual_blocks;
create policy "manual_blocks write" on manual_blocks for all using (true) with check (true);

-- ---------- 5) ตรวจสอบ ----------
do $$
declare
  v_missing text;
begin
  select string_agg(t, ', ')
  into v_missing
  from unnest(array['manual_chapters','manual_sections','manual_blocks']) as t
  where not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = t
  );

  if v_missing is not null then
    raise exception '0032 ล้มเหลว: ไม่พบตาราง %', v_missing;
  else
    raise notice '0032 สำเร็จ: manual_chapters / manual_sections / manual_blocks พร้อมใช้งาน';
  end if;
end $$;
