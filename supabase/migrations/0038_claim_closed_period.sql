-- =============================================================
-- 0038 — รับส่วนแบ่งเคสได้เฉพาะงวดที่ปิดเดือนแล้ว
-- =============================================================
-- ปัญหา: เดิม claim_service_share / preview_claim_share รับ p_period ใดก็ได้
--   ทำให้เจ้าหน้าที่กดรับส่วนแบ่งของเดือนที่ยังไม่จบได้
--   เช่น วันที่ 5 ของเดือน ยังมีบิลที่จะเข้ามาอีกมาก
--   → ตอนปลายเดือนต้องกดรับซ้ำ และบางเคสถูกนับซ้ำ/ตกหล่น
--
-- แก้โดยเพิ่มเงื่อนไขปิดงวดไว้ในตัวฟังก์ชันทั้งสอง
--   → บังคับที่ฐานข้อมูล ไม่ต้องพึ่งการตรวจฝั่ง UI อย่างเดียว
--
-- เงื่อนไข: p_period ต้อง "เก่ากว่าเดือนปัจจุบัน" เท่านั้น
--   (เช่น วันนี้ 2026-10 → รับได้งวด 2026-09 และเก่ากว่า, ห้ามรับ 2026-10)
--
-- หมายเหตุ: ผู้ตรวจสอบสามารถแก้ค่านี้ได้ในอนาคตโดยแก้ที่ฟังก์ชันนี้ที่เดียว
-- =============================================================

-- ---------- helper: งวดไหน "ปิดแล้ว" ----------
create or replace function public.claim_period_is_closed(p_period text)
returns boolean
language sql
immutable
as $$
  select
    p_period is not null
    and p_period ~ '^\d{4}-\d{2}$'
    and p_period < to_char(now() at time zone 'Asia/Bangkok', 'YYYY-MM');
$$;

comment on function public.claim_period_is_closed(text) is
  'true เมื่องวด p_period ผ่านมาแล้ว (ใช้กันการรับส่วนแบ่งของเดือนที่ยังไม่จบ)';

-- ---------- preview_claim_share: เพิ่มเงื่อนไข ----------
create or replace function preview_claim_share(
  p_officer_id uuid,
  p_period text,
  p_scope text
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_pct numeric(5,2);
  v_default_pct numeric(5,2);
  v_result jsonb;
  v_records jsonb;
  v_total numeric(10,2) := 0;
  v_gross numeric(10,2) := 0;
  v_count integer := 0;
begin
  -- งวดที่ยังไม่ปิด → คืนผลว่าง พร้อมเหตุผลให้หน้าเว็บแสดงผลได้
  if not public.claim_period_is_closed(p_period) then
    return jsonb_build_object(
      'scope', p_scope,
      'period', p_period,
      'closed', false,
      'record_count', 0,
      'gross_amount', 0,
      'per_officer_total', 0,
      'records', '[]'::jsonb
    );
  end if;

  select officer_share_percent into v_pct
  from revenue_sharing_config where scope = p_scope;
  if v_pct is null then v_pct := 10.00; end if;

  select officer_share_percent into v_default_pct
  from revenue_sharing_config where scope = 'default';
  if v_default_pct is null then v_default_pct := 10.00; end if;

  select
    coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb),
    coalesce(sum(t.gross), 0),
    coalesce(sum(t.share), 0),
    count(*)::int
  into v_records, v_gross, v_total, v_count
  from (
    select
      r.id,
      r.service_name,
      r.amount as gross,
      coalesce(sro_cnt.cnt, nullif(r.assigned_officer_count, 0), 1) as assigned_count,
      case
        when ov.officer_share is not null and ov.officer_share > 0
          then ov.officer_share / greatest(coalesce(sro_cnt.cnt, nullif(r.assigned_officer_count, 0), 1), 1)
        when r.officer_share is not null and r.officer_share > 0
          then r.officer_share / greatest(coalesce(sro_cnt.cnt, nullif(r.assigned_officer_count, 0), 1), 1)
        else
          (r.amount * v_pct / 100.0) / greatest(coalesce(sro_cnt.cnt, nullif(r.assigned_officer_count, 0), 1), 1)
      end as share
    from service_records r
    join service_record_officers sro on sro.service_record_id = r.id and sro.officer_id = p_officer_id
    left join (
      select service_record_id, count(*)::int as cnt
      from service_record_officers
      group by service_record_id
    ) sro_cnt on sro_cnt.service_record_id = r.id
    left join service_record_revenue_overrides ov on ov.service_record_id = r.id
    left join service_rates sr on sr.id = r.service_rate_id
    where r.status = 'paid'
      and to_char(r.service_date, 'YYYY-MM') = p_period
      and case
            when coalesce(nullif(r.service_category, ''), sr.category) is not null
              then coalesce(nullif(r.service_category, ''), sr.category)
            else 'default'
          end = p_scope
      and not exists (
        select 1 from claim_records cr
        where cr.service_record_id = r.id
          and cr.officer_id = p_officer_id
          and cr.status in ('pending','approved','paid')
      )
  ) t;

  v_result := jsonb_build_object(
    'scope', p_scope,
    'period', p_period,
    'closed', true,
    'officer_share_percent', v_pct,
    'record_count', v_count,
    'gross_amount', round(v_gross * 100) / 100,
    'per_officer_total', round(v_total * 100) / 100,
    'records', v_records
  );

  return v_result;
end;
$$;

-- ---------- claim_service_share: เพิ่มเงื่อนไข (ปิดแน่นหนักกว่า) ----------
create or replace function claim_service_share(
  p_officer_id uuid,
  p_period text,
  p_scope text,
  p_actor_id uuid,
  p_note text default null
) returns jsonb
language plpgsql
security definer
as $$
declare
  v_pct numeric(5,2);
  v_record record;
  v_record_id uuid;                 -- id ของ claim ที่เพิ่ง insert สำเร็จ
  v_inserted_ids uuid[] := '{}';
  v_total numeric(10,2) := 0;
  v_count integer := 0;
begin
  -- กันไว้ที่ฐานข้อมูล เพราะระบบนี้ควบคุมสิทธิ์ฝั่ง UI เป็นหลัก
  -- ถ้าปล่อยให้ผ่าน เจ้าหน้าที่จะกดรับงวดที่ยังไม่จบ แล้วต้องกดซ้ำปลายเดือน
  if not public.claim_period_is_closed(p_period) then
    raise exception 'CLAIM_PERIOD_NOT_CLOSED: รับส่วนแบ่งได้เฉพาะงวดที่ปิดเดือนแล้วเท่านั้น (งวด % ยังไม่จบ)', p_period;
  end if;

  select officer_share_percent into v_pct
  from revenue_sharing_config where scope = p_scope;
  if v_pct is null then v_pct := 10.00; end if;

  -- loop paid records ที่ยังไม่เคย claim
  for v_record in
    select r.id, r.amount,
      case
        when ov.officer_share is not null and ov.officer_share > 0
          then ov.officer_share / greatest(coalesce(sro_cnt.cnt, nullif(r.assigned_officer_count, 0), 1), 1)
        when r.officer_share is not null and r.officer_share > 0
          then r.officer_share / greatest(coalesce(sro_cnt.cnt, nullif(r.assigned_officer_count, 0), 1), 1)
        else
          (r.amount * v_pct / 100.0) / greatest(coalesce(sro_cnt.cnt, nullif(r.assigned_officer_count, 0), 1), 1)
      end as share
    from service_records r
    join service_record_officers sro on sro.service_record_id = r.id and sro.officer_id = p_officer_id
    left join (
      select service_record_id, count(*)::int as cnt
      from service_record_officers
      group by service_record_id
    ) sro_cnt on sro_cnt.service_record_id = r.id
    left join service_record_revenue_overrides ov on ov.service_record_id = r.id
    left join service_rates sr on sr.id = r.service_rate_id
    where r.status = 'paid'
      and to_char(r.service_date, 'YYYY-MM') = p_period
      and case
            when coalesce(nullif(r.service_category, ''), sr.category) is not null
              then coalesce(nullif(r.service_category, ''), sr.category)
            else 'default'
          end = p_scope
      and not exists (
        select 1 from claim_records cr
        where cr.service_record_id = r.id
          and cr.officer_id = p_officer_id
          and cr.status in ('pending','approved','paid')
      )
  loop
    insert into claim_records (
      officer_id, service_record_id, amount, scope, officer_share_percent,
      claim_period, record_count, status, claimed_by, note
    ) values (
      p_officer_id, v_record.id, v_record.share, p_scope, v_pct,
      p_period, 1, 'pending', p_actor_id, p_note
    )
    on conflict do nothing
    returning id into v_record_id;

    if v_record_id is not null then
      v_inserted_ids := v_inserted_ids || v_record_id;
      v_total := v_total + v_record.share;
      v_count := v_count + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'period', p_period,
    'scope', p_scope,
    'closed', true,
    'inserted', v_count,
    'total', round(v_total * 100) / 100,
    'ids', v_inserted_ids
  );
end;
$$;

-- ---------- grants ----------
grant execute on function public.claim_period_is_closed(text) to anon, authenticated;
grant execute on function public.preview_claim_share(uuid, text, text) to anon, authenticated;
grant execute on function public.claim_service_share(uuid, text, text, uuid, text) to anon, authenticated;

-- ---------- ตรวจสอบ ----------
-- หมายเหตุ: ห้ามเขียน now() AT TIME ZONE ซ้อนในวงเล็บของฟังก์ชันในบล็อก IF
-- เพราะ parser ของ PL/pgSQL จะตีความผิดจนได้ syntax error
-- ต้องแยกเก็บลงตัวแปรก่อนเสมอ
do $$
declare
  v_current_period text := to_char(now() at time zone 'Asia/Bangkok', 'YYYY-MM');
begin
  if not public.claim_period_is_closed('2000-01') then
    raise exception '0038 ล้มเหลว: งวดเก่าควรถือว่าปิดแล้ว';
  end if;
  if public.claim_period_is_closed(v_current_period) then
    raise exception '0038 ล้มเหลว: เดือนปัจจุบันต้องยังถือว่าไม่ปิด';
  end if;
  raise notice '0038 สำเร็จ: รับส่วนแบ่งได้เฉพาะงวดที่ปิดเดือนแล้ว';
end $$;
