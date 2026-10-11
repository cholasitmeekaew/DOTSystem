-- =============================================================
-- 0029 — Fix PPS kill switch RLS + shift codes ตามเวลาเปิดเซิร์ฟเวอร์จริง
-- =============================================================
-- 1) แก้ปุ่มสวิตช์เปิด/ปิด PPS Engine (และ kill switch เดิม) กดไม่ได้
--    สาเหตุ: policy เดิมใช้ current_rank() ซึ่งอ่าน auth.uid()
--    แต่ระบบนี้ login ด้วยตาราง officers เอง → auth.uid() = NULL
--    → policy ไม่มีวันผ่าน → UPDATE ถูกปฏิเสธเงียบ ๆ (UI เหมือนไม่ทำงาน)
--
-- 2) เปลี่ยนรหัสกะจาก day/night เป็น s1/s2 ให้ตรงกับเวลาเปิดเซิร์ฟเวอร์
--    จันทร์–ศุกร์  18:30–21:30  → กะที่ 1: 18:30–20:00 · กะที่ 2: 20:00–21:30
--    เสาร์–อาทิตย์ 18:30–23:00  → กะที่ 1: 18:30–20:45 · กะที่ 2: 20:45–23:00
-- =============================================================

-- ---------- 1) แก้ RLS ของ system_settings ----------
-- ใช้แนวทางเดียวกับ 0024 (storage), 0026 (manual_items), 0027 (officer_generations):
-- "การกันสิทธิ์ทำที่ชั้นแอป" — ทุกหน้าที่เขียน system_settings ถูกจำกัด
-- ด้วย isCommissioner อยู่แล้ว (DashboardPage / OperationsPage)
drop policy if exists "system_settings read" on system_settings;
drop policy if exists "system_settings write" on system_settings;
drop policy if exists "system_settings read update" on system_settings;
drop policy if exists "system_settings update" on system_settings;
drop policy if exists "system_settings upsert" on system_settings;

create policy "system_settings read" on system_settings
  for select using (true);

create policy "system_settings update" on system_settings
  for update using (true) with check (true);

-- ---------- 2) เปลี่ยนรหัสกะ ----------
-- ย้ายข้อมูลเดิม day → s1, night → s2 (ปลอดภัยถ้ารันซ้ำ เพราะค่าจะไม่ match อีก)
update duty_schedules set shift_code = 's1' where shift_code = 'day';
update duty_schedules set shift_code = 's2' where shift_code = 'night';
update schedule_overrides set shift_code = 's1' where shift_code = 'day';
update schedule_overrides set shift_code = 's2' where shift_code = 'night';

alter table duty_schedules    alter column shift_code set default 's1';
alter table schedule_overrides alter column shift_code set default 's1';

-- ล้างป้ายชื่อกะเดิม (กะเช้า/กะดึก) ให้เป็นป้ายตามตำแหน่งกะ
update duty_schedules set shift_name = 'กะที่ 1' where shift_code = 's1' and (shift_name is null or shift_name in ('กะเช้า', 'day'));
update duty_schedules set shift_name = 'กะที่ 2' where shift_code = 's2' and (shift_name is null or shift_name in ('กะดึก', 'night'));

-- ---------- 3) การันตีว่าคอลัมน์สวิตช์มีอยู่จริง ----------
-- (0028 เพิ่ม auto_points_enabled — ประกันว่าถ้า 0028 ยังไม่ถูก apply ให้เพิ่มตรงนี้)
alter table system_settings
  add column if not exists auto_points_enabled boolean not null default true;