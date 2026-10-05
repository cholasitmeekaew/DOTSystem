-- =============================================================
-- 0026: ตาราง manual_items สำหรับรายการคู่มือที่เพิ่มเอง (พร้อมรูป)
-- วิธีใช้: รันไฟล์นี้ใน Supabase Dashboard → SQL Editor
-- =============================================================

create table if not exists manual_items (
  id uuid primary key default gen_random_uuid(),
  variant text not null default 'officer',
  title text not null,
  content text not null default '',
  image_url text,
  created_by uuid references officers(id),
  created_by_name text,
  created_at timestamptz not null default now()
);

alter table manual_items enable row level security;

drop policy if exists "manual_items read" on manual_items;
create policy "manual_items read" on manual_items for select using (true);
drop policy if exists "manual_items write" on manual_items;
create policy "manual_items write" on manual_items for all using (true) with check (true);

insert into storage.buckets (id, name, public)
values ('manual', 'manual', true)
on conflict (id) do update set public = true;

drop policy if exists "manual app upload" on storage.objects;
create policy "manual app upload" on storage.objects for insert
  with check (bucket_id = 'manual');
drop policy if exists "manual app update" on storage.objects;
create policy "manual app update" on storage.objects for update
  using (bucket_id = 'manual')
  with check (bucket_id = 'manual');
drop policy if exists "manual app delete" on storage.objects;
create policy "manual app delete" on storage.objects for delete
  using (bucket_id = 'manual');
drop policy if exists "manual read" on storage.objects;
create policy "manual read" on storage.objects for select
  using (bucket_id = 'manual');
