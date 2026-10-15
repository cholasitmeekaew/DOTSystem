-- =============================================================
-- 0037 — ให้คะแนน PPS ติดลบได้ (สะสมเป็นหนี้)
-- =============================================================
-- ปัญหา: CHECK constraint ใน migration 0006 บังคับ points >= 0
--   ทำให้การหักคะแนนที่เกินยอดคงเหลือถูกตัดทิ้ง เช่น
--   คะแนน 3 คะแนน โดนหัก −30 → กลายเป็น 0 และ delta ที่บันทึกเป็น 0
--   ผลคือ "โดนหักแต่ไม่มีผล" หนี้คะแนนหายไปเงียบ ๆ ไม่มีทางตามทัน
--
-- แก้โดยยกเลิกเพดานล่าง ให้หักได้เต็มจำนวนและเกินได้เป็นหนี้
--   จากนั้นทุกครั้งที่ได้คะแนนใหม่ หนี้จะถูกกู้คืนหักก่อนโดยอัตโนมัติ
--
-- ยังคงเพดานบนไว้ที่ 100,000 เพื่อกันตัวเลขขึ้นผิดปกติ
-- =============================================================

-- ---------- หาชื่อ CHECK constraint ที่ครอบคลุมคอลัมน์ points ----------
-- ไม่ hardcode ชื่อ เพราะ Postgres ตั้งชื่ออัตโนมัติต่างกันตามวิธีสร้าง
do $$
declare
  c record;
begin
  for c in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_attribute att on att.attrelid = rel.oid and att.attnum = any (con.conkey)
    where rel.relnamespace = 'public'::regnamespace
      and rel.relname = 'officers'
      and con.contype = 'c'
      and att.attname = 'points'
      and pg_get_constraintdef(con.oid) like '%points%'
  loop
    execute format('alter table public.officers drop constraint %I', c.conname);
    raise notice '0037 ลบ constraint เดิม: %', c.conname;
  end loop;
end $$;

-- ---------- เพิ่ม constraint ใหม่: ติดลบได้ แต่ยังจำกัดบน ----------
alter table public.officers
  drop constraint if exists officers_points_range_check;

alter table public.officers
  add constraint officers_points_range_check
  check (points <= 100000);

comment on column public.officers.points is
  'คะแนนสะสม PPS — ติดลบได้ (คะแนนค้างหักจะถูกกู้คืนเมื่อได้คะแนนใหม่) จำกัดบน 100,000';

-- ---------- ดัชนี ----------
-- ล้าง index เดิมที่กรอง status='active' แล้วสร้างใหม่
-- เพราะ index เดิมเรียง points desc ซึ่งยังใช้ได้ แต่ข้อมูลติดลบ
-- จะทำให้เจ้าหน้าที่หนี้เยอะขึ้นมาอยู่ท้ายสุดโดยธรรมชาติ
drop index if exists public.officers_points_idx;
create index if not exists officers_points_idx
  on public.officers (points desc)
  where status = 'active';

-- ---------- ตรวจสอบ ----------
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'officers_points_range_check'
      and conrelid = 'public.officers'::regclass
  ) then
    raise notice '0037 สำเร็จ: officers.points ติดลบได้แล้ว (จำกัดบน 100,000)';
  else
    raise exception '0037 ล้มเหลว: ไม่พบ constraint ใหม่';
  end if;
end $$;
