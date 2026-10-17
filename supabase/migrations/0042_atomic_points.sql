-- =============================================================
-- 0042: ให้คะแนนแบบ atomic (กัน lost update)
-- =============================================================
-- ปัญหา: addOfficerPoints() อ่าน officers -> คำนวณ -> เขียนกลับ
--        ถ้าสองคนหักคะแนนพร้อมกัน คนที่เขียนทีหลังจะทับค่าของคนแรก
--        ทำให้คะแนน + ประวัติหาย (read-modify-write race)
--
-- แก้: ย้ายการอ่าน-คำนวณ-เขียนเข้าไปทำในฐานข้อมูล
--      SELECT ... FOR UPDATE ล็อกแถวนั้นระหว่างทำงาน
--      ทำให้ทุก transaction เห็นค่าล่าสุดเสมอ ไม่มีการทับกัน
--
-- ใช้ POINTS_MAX ต้องตรงกับ src/lib/api/points.ts (POINTS_MAX = 100000)
-- ไม่มีเพดานล่าง: หักเกินได้เต็มจำนวนและเกินเป็นหนี้ (คะแนนติดลบ)
-- =============================================================

create or replace function add_officer_points(
  p_officer_id   uuid,
  p_delta        integer,
  p_reason       text,
  p_actor_id     text,
  p_actor_name   text,
  p_points_max   integer default 100000
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row        officers%rowtype;
  v_old_points integer;
  v_new_points integer;
  v_applied    integer;
  v_old_log    jsonb;
  v_new_log    jsonb;
  v_entry      jsonb;
  v_period     text;
  v_note       text := '';
  v_officer    jsonb;
begin
  -- ล็อกแถวเจ้าหน้าที่คนนี้ระหว่างอ่าน-เขียน
  -- ถ้าไม่ล็อก จะเกิด lost update ได้
  select * into v_row
  from officers
  where id = p_officer_id
  for update;

  if not found then
    raise exception 'ไม่พบเจ้าหน้าที่'
      using errcode = 'P0002';
  end if;

  v_old_points := coalesce(v_row.points, 0);
  v_old_log    := coalesce(v_row.points_log, '[]'::jsonb);
  v_period     := coalesce(v_row.points_period, to_char(now(), 'YYYY-MM'));

  -- จำกัดเฉพาะด้านบน (ด้านล่างปล่อยเป็นหนี้ได้)
  v_new_points := v_old_points + p_delta;
  if v_new_points > p_points_max then
    v_new_points := p_points_max;
  end if;

  -- บันทึก "ค่าที่ให้จริง" ไม่ใช่ค่าที่ขอ เพื่อให้ balance_after สอดคล้องเสมอ
  v_applied := v_new_points - v_old_points;
  if v_applied <> p_delta and p_delta > 0 then
    v_note := ' (ขอ +' || p_delta || ' แต่ถูกจำกัดที่ ' || to_char(p_points_max, 'FM999,999,999') || ')';
  end if;

  v_entry := jsonb_build_object(
    'at',             to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MSOF'),
    'by',             p_actor_id,
    'by_name',        p_actor_name,
    'delta',          v_applied,
    'reason',         p_reason || v_note,
    'balance_after',  v_new_points,
    'period',         v_period
  );

  v_new_log := v_old_log || jsonb_build_array(v_entry);

  update officers
     set points       = v_new_points,
         points_log   = v_new_log,
         updated_at   = now()
   where id = p_officer_id;

  select to_jsonb(o) into v_officer from officers o where o.id = p_officer_id;

  return jsonb_build_object('officer', v_officer, 'entry', v_entry);
end;
$$;

-- ให้ client ทุกคนเรียกได้ (ผ่าน RLS ไม่ได้ เพราะเป็น SECURITY DEFINER)
grant execute on function add_officer_points(uuid, integer, text, text, text, integer) to authenticated, anon;

comment on function add_officer_points is
  'ให้/หักคะแนนแบบ atomic — ล็อกแถวด้วย FOR UPDATE กันการเขียนทับพร้อมกัน';
