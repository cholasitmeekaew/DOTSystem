-- =============================================================
-- 0044: แยกบันทึกภายในของประชาชนออกจาก citizens
-- =============================================================
-- ปัญหา
-- ──────
-- citizens.notes คือช่องที่เจ้าหน้าที่เขียนบันทึกไว้เบื้องหลัง
-- แต่หน้าสาธารณะ (CitizenPage) ใช้ select('*') → ดึง notes ไปแสดง
-- และ anon อ่านตารางนี้ได้โดยไม่ต้องล็อกอิน
--
-- เหตุผลที่ย้ายไปตารางแยก (ไม่ใช่แค่ลบ)
-- ─────────────────────────────────────
-- 1. หน้าสาธารณะต้องเห็นว่ามีผู้คนนี้อยู่จริง (ตามที่ผู้ใช้ตั้งใจไว้)
--    แต่ไม่ควรเห็นบันทึกภายในของเจ้าหน้าที่
-- 2. notes ต้องเขียน/อ่านได้เฉพาะเจ้าหน้าที่ แต่อยู่ใน schema private
--    ซึ่ง PostgREST มองไม่เห็น → anon ยิงเข้ามาได้ผลเป็น 404
-- 3. ข้อมูลที่ตาราง citizens เก็บจึงเหลือเฉพาะที่จำเป็นจริง ๆ
--
-- ⚠ หมายเหตุสำคัญ
-- ──────────────
-- policy แบบ rank ใช้ไม่ได้ เพราะระบบยังไม่มี Supabase Auth
-- (ดู migration 0043 สำหรับรายละเอียด)
-- การซ่อนด้วย schema private จึงเป็นกลไกหลัก
-- เมื่อย้ายไป Auth แล้วจึงค่อยเพิ่ม policy เป็นชั้นป้องกันที่สอง
-- =============================================================

create table if not exists private.citizen_notes (
  citizen_id   uuid primary key references citizens(id) on delete cascade,
  notes        text not null default '',
  updated_at   timestamptz not null default now(),
  updated_by   uuid references officers(id) on delete set null,
  updated_by_name text
);

comment on table private.citizen_notes is
  'บันทึกภายในของประชาชน — เข้าถึงได้เฉพาะเจ้าหน้าที่ผ่าน RPC เท่านั้น';

-- ย้ายข้อมูลเดิมเข้าตารางใหม่
insert into private.citizen_notes (citizen_id, notes)
select id, coalesce(notes, '')
from citizens
where notes is not null and notes <> ''
on conflict (citizen_id) do update set notes = excluded.notes;

-- เอาคอลัมน์ที่รั่วออกจากตารางสาธารณะ
alter table citizens drop column if exists notes;

-- ---------------------------------------------------------------
-- RPC: อ่าน/เขียนบันทึกภายใน (เจ้าหน้าที่เท่านั้น)
-- ---------------------------------------------------------------
create or replace function set_citizen_note(
  p_citizen_id  uuid,
  p_notes       text,
  p_actor_id    uuid default null,
  p_actor_name  text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if not exists (select 1 from citizens where id = p_citizen_id) then
    raise exception 'ไม่พบข้อมูลประชาชน' using errcode = 'P0002';
  end if;

  insert into private.citizen_notes (citizen_id, notes, updated_at, updated_by, updated_by_name)
  values (p_citizen_id, coalesce(p_notes, ''), now(), p_actor_id, p_actor_name)
  on conflict (citizen_id) do update
    set notes          = excluded.notes,
        updated_at     = now(),
        updated_by     = excluded.updated_by,
        updated_by_name = excluded.updated_by_name;

  return true;
end;
$$;

create or replace function get_citizen_note(p_citizen_id uuid)
returns text
language sql
security definer
set search_path = public, private
as $$
  select notes from private.citizen_notes where citizen_id = p_citizen_id;
$$;

grant execute on function set_citizen_note(uuid, text, uuid, text) to authenticated;
grant execute on function get_citizen_note(uuid) to authenticated;
