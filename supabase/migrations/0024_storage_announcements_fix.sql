-- =============================================================
-- 0024: แก้ไข Storage ให้อัปโหลดรูปประกาศได้จริง
-- ปัญหา: โค้ดเดิมยิงไป bucket 'dot-uploads' ซึ่งไม่มีอยู่จริง
-- ตอนนี้โค้ดใช้ bucket ตรงกับ 0004 แล้ว (announcements/evidence/
-- vehicles/officer-photos) migration นี้ซ่อม policy ที่ขาด:
--   1) นโยบาย upload เดิมของ announcements/vehicles/officer-photos
--      ต้องการ auth.uid() แต่แอปล็อกอินแบบ custom (ไม่มี supabase session)
--      ทำให้อัปโหลดถูกปฏิเสธ — เปิดให้เขียนได้แบบเดียวกับ evidence
--      (การกันสิทธิ์ทำที่ชั้นแอป: เฉพาะ commissioner/officer)
--   2) เติมนโยบาย delete ที่ขาด ทำให้ลบรูปเก่าได้
-- วิธีใช้: รันไฟล์นี้ใน Supabase Dashboard → SQL Editor
-- =============================================================

-- เผื่อ bucket หาย (idempotent)
insert into storage.buckets (id, name, public)
values
  ('officer-photos', 'officer-photos', true),
  ('announcements', 'announcements', true),
  ('evidence', 'evidence', true),
  ('vehicles', 'vehicles', true)
on conflict (id) do update set public = true;

-- ---------- announcements ----------
drop policy if exists "announcements upload" on storage.objects;
drop policy if exists "announcements app upload" on storage.objects;
create policy "announcements app upload" on storage.objects for insert
  with check (bucket_id = 'announcements');
drop policy if exists "announcements app update" on storage.objects;
create policy "announcements app update" on storage.objects for update
  using (bucket_id = 'announcements')
  with check (bucket_id = 'announcements');
drop policy if exists "announcements app delete" on storage.objects;
create policy "announcements app delete" on storage.objects for delete
  using (bucket_id = 'announcements');

-- ---------- evidence (เติม insert/update/delete ที่ขาด) ----------
drop policy if exists "evidence upload" on storage.objects;
drop policy if exists "evidence app upload" on storage.objects;
create policy "evidence app upload" on storage.objects for insert
  with check (bucket_id = 'evidence');
drop policy if exists "evidence app update" on storage.objects;
create policy "evidence app update" on storage.objects for update
  using (bucket_id = 'evidence')
  with check (bucket_id = 'evidence');
drop policy if exists "evidence app delete" on storage.objects;
create policy "evidence app delete" on storage.objects for delete
  using (bucket_id = 'evidence');

-- ---------- vehicles ----------
drop policy if exists "vehicles upload" on storage.objects;
drop policy if exists "vehicles app upload" on storage.objects;
create policy "vehicles app upload" on storage.objects for insert
  with check (bucket_id = 'vehicles');
drop policy if exists "vehicles app update" on storage.objects;
create policy "vehicles app update" on storage.objects for update
  using (bucket_id = 'vehicles')
  with check (bucket_id = 'vehicles');
drop policy if exists "vehicles app delete" on storage.objects;
create policy "vehicles app delete" on storage.objects for delete
  using (bucket_id = 'vehicles');

-- ---------- officer photos ----------
drop policy if exists "officer photos upload" on storage.objects;
drop policy if exists "officer photos app upload" on storage.objects;
create policy "officer photos app upload" on storage.objects for insert
  with check (bucket_id = 'officer-photos');
drop policy if exists "officer photos app update" on storage.objects;
create policy "officer photos app update" on storage.objects for update
  using (bucket_id = 'officer-photos')
  with check (bucket_id = 'officer-photos');
drop policy if exists "officer photos app delete" on storage.objects;
create policy "officer photos app delete" on storage.objects for delete
  using (bucket_id = 'officer-photos');
