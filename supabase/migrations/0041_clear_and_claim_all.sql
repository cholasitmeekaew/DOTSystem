-- =============================================================
-- 0041 — ล้าง claim ที่รออนุมัติ + กดรับส่วนแบ่งพร้อมกันทุกคน
-- =============================================================
-- ปัญหา 1: claim_records ถูก RLS บัง → client query ตรงได้ 0 แถวเสมอ
--   ทำให้หัวหน้ากรม "ล้างคำขอรออนุมัติ" ทำไม่ได้ และมองไม่เห็นว่ามีอะไรค้าง
--
-- ปัญหา 2: เคยมี claim ของงวดที่ยังไม่ปิดเดือน (ก่อน migration 0038 บังคับ)
--   เช่น งวด 2026-10 ที่ยังนับไม่เสร็จ — ต้องล้างทิ้งแล้วให้เจ้าหน้าที่กดรับใหม่
--
-- แก้โดยเพิ่ม RPC สำหรับหัวหน้ากรมเท่านั้น
-- =============================================================

-- ---------- ล้างคำขอรออนุมัติทั้งหมด ----------
drop function if exists public.clear_pending_claims(p_actor_id uuid);

create or replace function public.clear_pending_claims(p_actor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer := 0;
begin
  -- ตรวจว่าเป็นหัวหน้ากรมจริง
  if not exists (
    select 1 from officers where id = p_actor_id and rank = 'commissioner'
  ) then
    raise exception 'CLAIM_NOT_ALLOWED: เฉพาะหัวหน้ากรมเท่านั้นที่ล้างคำขอรออนุมัติได้';
  end if;

  -- นับยอดก่อนลบ เพื่อให้หน้าเว็บแสดงผลได้
  select count(*)::int into v_deleted
  from claim_records where status = 'pending';

  delete from claim_records where status = 'pending';

  -- บันทึกไว้ให้ตรวจสอบย้อนหลังว่าใครล้างอะไร
  if v_deleted > 0 then
    insert into audit_logs (action, target_type, performed_by, performed_by_name, details)
    values (
      'CLEAR_PENDING_CLAIMS', 'claim_records', p_actor_id,
      (select name from officers where id = p_actor_id),
      jsonb_build_object('deleted_count', v_deleted, 'at', now())
    );
  end if;

  return jsonb_build_object('deleted', v_deleted, 'success', true);
end;
$$;

revoke all on function public.clear_pending_claims(uuid) from public;
grant execute on function public.clear_pending_claims(uuid) to anon, authenticated;

-- ---------- ล้างเฉพาะงวดที่เลือก ----------
drop function if exists public.clear_pending_claims_by_period(p_actor_id uuid, p_period text);

create or replace function public.clear_pending_claims_by_period(
  p_actor_id uuid,
  p_period text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer := 0;
begin
  if not exists (
    select 1 from officers where id = p_actor_id and rank = 'commissioner'
  ) then
    raise exception 'CLAIM_NOT_ALLOWED: เฉพาะหัวหน้ากรมเท่านั้นที่ล้างคำขอรออนุมัติได้';
  end if;

  select count(*)::int into v_deleted
  from claim_records where status = 'pending' and claim_period = p_period;

  delete from claim_records where status = 'pending' and claim_period = p_period;

  return jsonb_build_object('deleted', v_deleted, 'period', p_period, 'success', true);
end;
$$;

revoke all on function public.clear_pending_claims_by_period(uuid, text) from public;
grant execute on function public.clear_pending_claims_by_period(uuid, text) to anon, authenticated;

-- ---------- ตรวจสอบ ----------
do $$
begin
  if exists (select 1 from pg_proc where proname = 'clear_pending_claims') then
    raise notice '0041 สำเร็จ: ล้าง claim รออนุมัติ + ล้างเฉพาะงวด พร้อมใช้งาน';
  else
    raise exception '0041 ล้มเหลว: ไม่พบ clear_pending_claims';
  end if;
end $$;
