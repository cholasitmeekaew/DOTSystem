-- =============================================================
-- 0033 — ประวัติการเข้าสู่ระบบ (Login History)
-- =============================================================
-- เดิม: ระบบล็อกอินด้วยการเทียบ password_hash ฝั่ง client (ตาราง officers
--       + localStorage) จึงไม่เคยบันทึกว่าใครเข้าเมื่อไร จากที่ไหน
-- ใหม่: เก็บเวลาเข้า / IP / อุปกรณ์ เพื่อแสดงในหน้าข้อมูลส่วนตัว
--
-- วิธีดึง IP:
--   ระบบนี้ไม่มี Supabase Auth จึงไม่มี session ให้ดึง IP จาก auth
--   แต่ PostgREST เปิด GUC "request.headers" ให้อ่านได้ ซึ่งมี x-forwarded-for
--   จึงฝังการอ่านไว้ในฟังก์ชันฝั่ง DB แทนที่จะให้ client ส่ง IP มาเอง
--   (ถ้าให้ client ส่ง ผู้ใช้จะแก้ค่าใน devtools ได้ → ข้อมูลไม่น่าเชื่อถือ)
-- =============================================================

-- ---------- 1) ตารางประวัติการเข้าสู่ระบบ ----------
create table if not exists officer_login_logs (
  id uuid primary key default gen_random_uuid(),
  officer_id uuid not null references officers(id) on delete cascade,
  logged_in_at timestamptz not null default now(),
  ip_address text,
  user_agent text,
  device text
);

create index if not exists officer_login_logs_idx
  on officer_login_logs (officer_id, logged_in_at desc);

-- ---------- 2) ค่าล่าสุดบนตาราง officers (แสดง "Last Login" ได้โดยไม่ต้อง query ประวัติ) ----------
alter table officers add column if not exists last_login_at timestamptz;
alter table officers add column if not exists last_login_ip text;

-- ---------- 3) RLS ----------
-- อ่านได้เฉพาะเจ้าของรายการเท่านั้น (หัวหน้ากรมดูผ่าน RPC ถ้าต้องการ)
-- เขียนไม่เปิด policy เลย เพราะเขียนได้ผ่านฟังก์ชันด้านล่างเท่านั้น
alter table officer_login_logs enable row level security;

drop policy if exists "officer_login_logs read own" on officer_login_logs;
create policy "officer_login_logs read own" on officer_login_logs
  for select using (officer_id = auth.uid() or current_rank() = 'commissioner');

-- ---------- 4) ฟังก์ชันบันทึกการเข้าสู่ระบบ ----------
-- SECURITY DEFINER เพราะต้องเขียนได้แม้ไม่มี policy insert
-- ข้อจำกัดที่ต้องรู้: ระบบไม่มี Supabase Auth ฟังก์ชันนี้จึงยืนยันตัวตน
-- ผู้เรียกไม่ได้ (auth.uid() เป็น NULL) ใครก็เรียกด้วย id ของคนอื่นได้
-- ผลกระทบคือ "บันทึกประวัติปลอมได้" ไม่ใช่การเข้าถึงข้อมูลส่วนตัว
-- การบังคับจริงระดับนี้ต้องรอ Supabase Auth
create or replace function public.log_officer_login(
  p_officer_id uuid,
  p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_headers json;
  v_ip text;
  v_ua text;
  v_device text;
begin
  if p_officer_id is null then
    return;
  end if;

  -- อ่าน header ที่ PostgREST เปิดให้ (ไม่มีก็ปล่อยว่าง ไม่ error)
  begin
    v_headers := current_setting('request.headers', true)::json;
  exception when others then
    v_headers := '{}'::json;
  end;

  -- x-forwarded-for อาจเป็น "ip, port" หรือเป็น chain → เอาชิ้นแรก
  v_ip := nullif(split_part(coalesce(v_headers->>'x-forwarded-for', ''), ',', 1), '');
  if v_ip is null then
    v_ip := nullif(split_part(coalesce(v_headers->>'x-real-ip', ''), ',', 1), '');
  end if;

  v_ua := coalesce(nullif(p_user_agent, ''), v_headers->>'user-agent');

  -- สรุปชื่ออุปกรณ์แบบคร่าว ๆ ให้อ่านง่าย
  v_device := case
    when v_ua is null then null
    when v_ua ilike '%edg/%'      then 'Microsoft Edge'
    when v_ua ilike '%chrome/%'   then 'Google Chrome'
    when v_ua ilike '%firefox/%'  then 'Mozilla Firefox'
    when v_ua ilike '%safari/%'   then 'Safari'
    when v_ua ilike '%iphone%' or v_ua ilike '%ipad%'   then 'iOS'
    when v_ua ilike '%android%'   then 'Android'
    else 'อื่น ๆ'
  end;

  insert into officer_login_logs (officer_id, ip_address, user_agent, device)
  values (p_officer_id, v_ip, left(v_ua, 500), v_device);

  update officers
     set last_login_at = now(),
         last_login_ip = v_ip
   where id = p_officer_id;
end $$;

grant execute on function public.log_officer_login(uuid, text) to anon, authenticated;

-- ---------- 5) Realtime ----------
-- ให้หน้าข้อมูลส่วนตัวอัปเดตรายการเข้าสู่ระบบล่าสุดทันทีโดยไม่ต้องรีเฟรช
-- ตรวจก่อนเพิ่ม กัน error ตอนรันซ้ำ
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'officer_login_logs'
  ) then
    alter publication supabase_realtime add table officer_login_logs;
  end if;
end $$;

-- ---------- 6) ตรวจสอบ ----------
do $$
declare
  v_ok boolean;
begin
  select exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'officer_login_logs'
  ) into v_ok;

  if v_ok then
    raise notice '0033 สำเร็จ: officer_login_logs + log_officer_login() พร้อมใช้งาน';
  else
    raise exception '0033 ล้มเหลว: ไม่พบตาราง officer_login_logs';
  end if;
end $$;
