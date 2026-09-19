-- =============================================================
-- Performance Point System (PPS)
-- เพิ่ม column เก็บคะแนนสะสม + log ประวัติ + index สำหรับ leaderboard
-- =============================================================

-- เพิ่ม column เก็บคะแนนปัจจุบัน + period + log
alter table officers
  add column if not exists points integer not null default 0
    check (points >= 0 and points <= 100000),
  add column if not exists points_period text
    default to_char(now() at time zone 'Asia/Bangkok', 'YYYY-MM'),
  add column if not exists points_log jsonb not null default '[]'::jsonb;
  -- โครงสร้าง log: [{at, by, by_name, delta, reason, balance_after, period}]

-- Index ช่วย query leaderboard (top N เรียงตามคะแนน)
create index if not exists officers_points_idx
  on officers (points desc)
  where status = 'active';

-- หมายเหตุ: RLS policy `officers self update` (ใน 0002_rls.sql) อนุญาตให้
-- officer แก้ไขข้อมูลตัวเองได้อยู่แล้ว — ใช้สำหรับ self-claim (ขอคะแนน) ในอนาคต
-- ส่วน admin (commissioner/inspector) ใช้ policy `officers self update` ที่มี
-- `current_rank() = 'commissioner'` อยู่แล้ว — เพียงพอสำหรับการเพิ่ม/ลดคะแนน
