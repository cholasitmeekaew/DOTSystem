-- =============================================================
-- 0043: ย้ายข้อมูลรหัสผ่านออกจาก schema public
-- =============================================================
-- ปัญหาร้ายแรง
-- ────────────
-- anon key อยู่ในไฟล์ JS ที่ทุกคนดาวน์โหลดได้ และตาราง officers
-- ถูกอ่านได้โดยไม่ต้องล็อกอิน → password_hash ของทุกคนรวม admin รั่ว
--
-- ทำไมแก้ที่ query ไม่พอ
-- ──────────────────────
-- RLS ของโปรเจกต์นี้อ้าง auth.uid() แต่ระบบล็อกอินด้วย localStorage
-- ไม่ได้ใช้ Supabase Auth → auth.uid() = null เสมอ และ anon
-- ยังอ่านได้ทุกตาราง แสดงว่า RLS ไม่ได้บังคับใช้จริง
--
-- วิธีแก้ที่ได้ผลแม้ RLS จะไม่ทำงาน
-- ─────────────────────────────
-- PostgREST มองเห็นเฉพาะ schema ที่เปิดไว้ (ค่าเริ่มต้นคือ public เท่านั้น)
-- ย้ายตารางที่เก็บข้อมูลลับไปไว้ใน schema "private" แล้ว revoke สิทธิ์
-- → anon ยิง REST เข้ามาได้ผลเป็น 404 เพราะมองไม่เห็นตารางเลย
--
-- ⚠ ข้อจำกัดสำคัญ
-- ──────────────────
-- ยังไม่มีระบบยืนยันตัวตนจริง ทุก RPC ที่แก้ข้อมูลลับจึงต้อง
-- "พิสูจน์ด้วยรหัสผ่าน" แทนการเชื่อ rank จาก client
-- ผู้โจมตีที่ไม่รู้รหัสผ่านจะทำ RPC เหล่านี้ไม่ได้
-- เมื่อย้ายไป Supabase Auth แล้วจึงค่อยเปลี่ยนมาใช้ auth.uid()
-- =============================================================

create schema if not exists private;

revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------
-- ตารางเก็บข้อมูลเข้าระบบ
-- ---------------------------------------------------------------
create table if not exists private.officer_credentials (
  officer_id      uuid primary key references officers(id) on delete cascade,
  username        text not null unique,
  password_hash   text not null,
  updated_at      timestamptz not null default now(),
  updated_by      uuid references officers(id) on delete set null,
  updated_by_name text
);

comment on table private.officer_credentials is
  'ข้อมูลเข้าระบบ — ห้ามเข้าถึงจาก client โดยตรง ใช้ผ่าน RPC ใน schema public เท่านั้น';

-- ย้ายข้อมูลเดิมเข้าตารางใหม่ (ย้อนกลับได้ถ้ายังไม่ drop คอลัมน์)
insert into private.officer_credentials (officer_id, username, password_hash)
select id, lower(trim(username)), password_hash
from officers
where username is not null
  and password_hash is not null
on conflict (officer_id) do update
  set username      = excluded.username,
      password_hash = excluded.password_hash;

-- ---------------------------------------------------------------
-- เอาคอลัมน์อันตรายออกจาก public.officers
--
-- ขั้นนี้สำคัญที่สุด: ถึงตาราง credentials จะถูกซ่อนแล้ว
-- ถ้ายังปล่อย password_hash ไว้ใน officers ก็ยังรั่วอยู่
-- เพราะตารางนี้ anon อ่านได้
-- ---------------------------------------------------------------
alter table officers drop column if exists password_hash;
alter table officers drop column if exists username;

-- ---------------------------------------------------------------
-- RPC 1: ตรวจการเข้าระบบ
--
-- คืนข้อมูลเจ้าหน้าที่ (ไม่มี hash) เมื่อ username + hash ตรงกัน
-- username ผิดกับรหัสผิด คืน null เหมือนกันทั้งคู่
-- เพื่อไม่ให้ผู้โจมตีรู้ว่ามีบัญชีนี้อยู่จริงหรือไม่
-- ---------------------------------------------------------------
create or replace function login_officer(
  p_username      text,
  p_password_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_officer jsonb;
begin
  select to_jsonb(o) into v_officer
  from officers o
  join private.officer_credentials c on c.officer_id = o.id
  where c.username = lower(trim(p_username))
    and c.password_hash = p_password_hash
    and o.status not in ('deleted', 'suspended');

  return v_officer;   -- null = ไม่ผ่าน
end;
$$;

grant execute on function login_officer(text, text) to anon, authenticated;

comment on function login_officer is
  'ตรวจรหัสผ่านฝั่งฐานข้อมูล — ไม่ส่ง password_hash กลับไปให้ client เด็ดขาด';

-- ---------------------------------------------------------------
-- RPC 2: เปลี่ยนรหัสผ่านของตัวเอง
--
-- ต้องส่ง hash เดิมมาด้วย → ผู้ที่ไม่รู้รหัสผ่านเดิมทำไม่ได้
-- ---------------------------------------------------------------
create or replace function change_own_password(
  p_officer_id    uuid,
  p_old_hash      text,
  p_new_hash      text
)
returns boolean
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if p_new_hash is null or length(trim(p_new_hash)) = 0 then
    raise exception 'รหัสผ่านใหม่ไม่ถูกต้อง' using errcode = '22023';
  end if;

  update private.officer_credentials
     set password_hash = p_new_hash,
         updated_at    = now(),
         updated_by    = p_officer_id,
         updated_by_name = (select name from officers where id = p_officer_id)
   where officer_id = p_officer_id
     and password_hash = p_old_hash;

  return found;   -- false = รหัสเดิมไม่ตรง
end;
$$;

grant execute on function change_own_password(uuid, text, text) to anon, authenticated;

-- ---------------------------------------------------------------
-- RPC 3: หัวหน้ากรมตั้งรหัสผ่านให้ลูกข้าง
--
-- ต้องเป็น commissioner และต้องส่ง hash ของตัวเองมายืนยัน
-- ผู้โจมตีที่ไม่รู้รหัสผ่านหัวหน้ากรม จะทำ RPC นี้ไม่ได้
-- ---------------------------------------------------------------
create or replace function admin_set_password(
  p_actor_id      uuid,
  p_actor_hash    text,
  p_target_id     uuid,
  p_new_hash      text,
  p_new_username  text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor officers%rowtype;
begin
  if p_new_hash is null or length(trim(p_new_hash)) = 0 then
    raise exception 'รหัสผ่านใหม่ไม่ถูกต้อง' using errcode = '22023';
  end if;

  -- ผู้เรียกต้องเป็นหัวหน้ากรม
  select * into v_actor from officers where id = p_actor_id and status <> 'deleted';
  if v_actor.rank is distinct from 'commissioner' then
    raise exception 'permission denied: commissioner rank required' using errcode = '42501';
  end if;

  -- และต้องยืนยันรหัสผ่านตัวเอง
  if not exists (
    select 1 from private.officer_credentials
    where officer_id = p_actor_id and password_hash = p_actor_hash
  ) then
    raise exception 'permission denied: actor password mismatch' using errcode = '42501';
  end if;

  insert into private.officer_credentials (officer_id, username, password_hash, updated_at, updated_by, updated_by_name)
  values (
    p_target_id,
    lower(trim(coalesce(p_new_username, (select name from officers where id = p_target_id)))),
    p_new_hash, now(), p_actor_id, v_actor.name
  )
  on conflict (officer_id) do update
    set username        = excluded.username,
        password_hash   = excluded.password_hash,
        updated_at      = now(),
        updated_by      = excluded.updated_by,
        updated_by_name = excluded.updated_by_name;

  return true;
end;
$$;

grant execute on function admin_set_password(uuid, text, uuid, text, text) to anon, authenticated;

-- ---------------------------------------------------------------
-- RPC 4: สร้างข้อมูลเข้าระบบให้เจ้าหน้าที่ใหม่
--
-- หัวหน้ากรมสร้างบัญชีใหม่ ต้องยืนยันรหัสผ่านตัวเองเหมือนกัน
-- ---------------------------------------------------------------
create or replace function admin_create_credentials(
  p_actor_id     uuid,
  p_actor_hash   text,
  p_new_id       uuid,
  p_username     text,
  p_password_hash text
)
returns boolean
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor officers%rowtype;
begin
  if p_username is null or length(trim(p_username)) = 0 then
    raise exception 'username ไม่ถูกต้อง' using errcode = '22023';
  end if;

  select * into v_actor from officers where id = p_actor_id and status <> 'deleted';
  if v_actor.rank is distinct from 'commissioner' then
    raise exception 'permission denied: commissioner rank required' using errcode = '42501';
  end if;

  if not exists (
    select 1 from private.officer_credentials
    where officer_id = p_actor_id and password_hash = p_actor_hash
  ) then
    raise exception 'permission denied: actor password mismatch' using errcode = '42501';
  end if;

  insert into private.officer_credentials (officer_id, username, password_hash, updated_at, updated_by, updated_by_name)
  values (p_new_id, lower(trim(p_username)), p_password_hash, now(), p_actor_id, v_actor.name);

  return true;
end;
$$;

grant execute on function admin_create_credentials(uuid, text, uuid, text, text) to anon, authenticated;
