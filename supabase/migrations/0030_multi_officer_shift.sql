-- =============================================================
-- 0030 — หลายเจ้าหน้าที่ต่อ 1 กะ (Multi-Officer Shift Allocation)
-- =============================================================
-- เดิม: duty_schedules / schedule_overrides ผูก UNIQUE ที่ (ช่องกะ) ไว้
--        → 1 ช่องกะมีได้แค่ 1 คน
-- ใหม่: 1 ช่องกะมีได้หลายคน (แยก 1 แถวต่อ 1 คน)
--
-- กติกาการมองเห็นที่ฝั่ง client (src/lib/dutySchedule.ts):
--   - แถวที่ officer_id IS NULL + override_type='off'  = ปิดทั้งช่องกะ
--   - แถว type='swap'   = ใช้คนในแถว swap แทนผังประจำทั้งช่อง
--   - แถว type='leave'  = ตัดคนนั้นออกจากช่องกะของวันนั้น (ป้าย "ลา")
--   - แถว type='extra'  = เพิ่มคนเข้าไปในช่องกะของวันนั้น (ป้าย "เวรพิเศษ")
--   - แถว type='off' + officer_id = ตัดคนนั้นออกเฉพาะบุคคล
-- =============================================================

-- ---------- 1) คอลัมน์กำลังพลที่ต้องการ ----------
alter table duty_schedules
  add column if not exists required_officers integer not null default 2;
alter table schedule_overrides
  add column if not exists required_officers integer;

-- ---------- 2) ปลดข้อจำกัด UNIQUE เดิม ----------
drop index if exists duty_schedules_weekday_shift_uidx;
drop index if exists schedule_overrides_date_shift_uidx;

-- ---------- 3) UNIQUE ใหม่ (ต่อคน) ----------
-- ผังประจำ: หนึ่งคนต่อหนึ่งช่องกะ
create unique index if not exists duty_schedules_slot_officer_uidx
  on duty_schedules (weekday, shift_code, officer_id)
  where officer_id is not null;

-- ข้อยกเว้น: หนึ่งคนต่อหนึ่งช่องกะของวันนั้น
create unique index if not exists schedule_overrides_slot_officer_uidx
  on schedule_overrides (override_date, shift_code, officer_id)
  where officer_id is not null;

-- ปิดทั้งช่องกะ (ไม่ผูกกับคน) → อนุญาตได้เพียงแถวเดียวต่อช่อง
create unique index if not exists schedule_overrides_slot_off_uidx
  on schedule_overrides (override_date, shift_code)
  where officer_id is null and override_type = 'off';

-- ---------- 4) Index สำหรับ query ----------
create index if not exists duty_schedules_slot_idx
  on duty_schedules (weekday, shift_code);
create index if not exists schedule_overrides_slot_idx
  on schedule_overrides (override_date, shift_code);