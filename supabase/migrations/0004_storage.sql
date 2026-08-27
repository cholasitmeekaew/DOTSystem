-- =============================================================
-- Storage buckets
-- =============================================================

-- Bucket: officer-photos (รูปโปรไฟล์)
insert into storage.buckets (id, name, public)
values ('officer-photos', 'officer-photos', true)
on conflict (id) do nothing;

-- Bucket: announcements (รูปประกาศ)
insert into storage.buckets (id, name, public)
values ('announcements', 'announcements', true)
on conflict (id) do nothing;

-- Bucket: evidence (หลักฐานค่าบริการ/ร้องเรียน)
insert into storage.buckets (id, name, public)
values ('evidence', 'evidence', true)
on conflict (id) do nothing;

-- Bucket: vehicles (รูปรถ)
insert into storage.buckets (id, name, public)
values ('vehicles', 'vehicles', true)
on conflict (id) do nothing;

-- Policies
create policy "officer photos read" on storage.objects for select
  using (bucket_id = 'officer-photos');
create policy "officer photos upload" on storage.objects for insert
  with check (bucket_id = 'officer-photos' and auth.uid() is not null);

create policy "announcements read" on storage.objects for select using (bucket_id = 'announcements');
create policy "announcements upload" on storage.objects for insert
  with check (bucket_id = 'announcements' and auth.uid() is not null);

create policy "evidence read" on storage.objects for select using (bucket_id = 'evidence');
create policy "evidence upload" on storage.objects for insert
  with check (bucket_id = 'evidence');

create policy "vehicles read" on storage.objects for select using (bucket_id = 'vehicles');
create policy "vehicles upload" on storage.objects for insert
  with check (bucket_id = 'vehicles' and auth.uid() is not null);
