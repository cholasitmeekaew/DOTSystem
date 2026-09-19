-- =============================================================
-- 0025: เติมนโยบาย insert ให้ bucket evidence ที่ขาด
-- อาการ: อัปโหลดรูปหลักฐานในรายงานเวรล้มด้วย
--   "new row violates row-level security policy"
-- สาเหตุ: 0024 เติม insert ให้ announcements/vehicles/officer-photos
--   แต่ของ evidence มีแค่ update/delete (insert ของ 0004 ไม่ได้รันในโปรเจกต์นี้)
-- วิธีใช้: รันไฟล์นี้ใน Supabase Dashboard → SQL Editor
-- =============================================================

drop policy if exists "evidence upload" on storage.objects;
drop policy if exists "evidence app upload" on storage.objects;
create policy "evidence app upload" on storage.objects for insert
  with check (bucket_id = 'evidence');
