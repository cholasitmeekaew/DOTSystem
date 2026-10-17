-- =============================================================
-- 0040 — รับส่วนแบ่งแบบสะสม: เดือนที่ลืมกดรับ ให้รวมไปกดทีเดียวตอนหลัง
-- =============================================================
-- ปัญหา: เดิม claim_service_share รับเฉพาะบิลของเดือนที่เลือก (p_period)
--   ถ้าเจ้าหน้าที่ลืมกดรับเดือนก.ค. แล้วมากดเดือน ส.ค.
--   เงินเดือนก.ค. จะค้างอยู่ตลอดไป จนกว่าจะย้อนกลับมาเลือกเดือนก.ค.
--   ซึ่งเป็นเรื่องง่ายมากที่จะลืมอีก
--
-- แก้โดยเปลี่ยนความหมายของ p_period เป็น "รวมถึงเดือนนี้"
--   → กดรับเดือน ส.ค. จะได้ทุกบิลตั้งแต่ ก.ค. (หรือเดือนที่ยังไม่เคยรับ) รวมถึง ส.ค.
--   → ไม่ต้องย้อนกลับมาเลือกเดือนเก่า
--
-- claim_period ของแต่ละแถว ยังเก็บเป็นเดือนจริงของบิลนั้น
--   เพื่อให้รายงานรายเดือนยังถูกต้อง แม้จะกดรับพร้อมกันหลายเดือน
--
-- เงื่อนไขเดิมจาก 0038 ยังอยู่: รับได้เฉพาะเดือนที่ปิดแล้วเท่านั้น
-- =============================================================

-- ---------- preview_claim_share: รวมทุกเดือนที่ <= p_period ----------
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
  v_result jsonb;
  v_records jsonb;
  v_total numeric(10,2) := 0;
  v_gross numeric(10,2) := 0;
  v_count integer := 0;
  v_months jsonb;
begin
  if not public.claim_period_is_closed(p_period) then
    return jsonb_build_object(
      'scope', p_scope, 'period', p_period, 'closed', false,
      'record_count', 0, 'gross_amount', 0, 'per_officer_total', 0,
      'records', '[]'::jsonb, 'months', '[]'::jsonb
    );
  end if;

  select officer_share_percent into v_pct
  from revenue_sharing_config where scope = p_scope;
  if v_pct is null then v_pct := 10.00; end if;

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
      r.service_date,
      to_char(r.service_date, 'YYYY-MM') as month,
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
      from service_record_officers group by service_record_id
    ) sro_cnt on sro_cnt.service_record_id = r.id
    left join service_record_revenue_overrides ov on ov.service_record_id = r.id
    left join service_rates sr on sr.id = r.service_rate_id
    where r.status = 'paid'
      -- ★ เปลี่ยนจาก = p_period เป็น <= p_period → รวมเดือนที่ค้างทั้งหมด
      and r.service_date is not null
      and to_char(r.service_date, 'YYYY-MM') <= p_period
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

  -- รายการเดือนที่ถูกรวมมา เพื่อให้หน้าเว็บแสดงว่า "รวม N เดือน" ได้
  select coalesce(jsonb_agg(jsonb_build_object(
           'month', m.month,
           'record_count', m.cnt,
           'total', round(m.sum_share * 100) / 100
         ) order by m.month), '[]'::jsonb)
  into v_months
  from (
    select to_char(r.service_date, 'YYYY-MM') as month,
           count(*)::int as cnt,
           sum(
             case
               when ov.officer_share is not null and ov.officer_share > 0
                 then ov.officer_share / greatest(coalesce(sro_cnt.cnt, nullif(r.assigned_officer_count, 0), 1), 1)
               when r.officer_share is not null and r.officer_share > 0
                 then r.officer_share / greatest(coalesce(sro_cnt.cnt, nullif(r.assigned_officer_count, 0), 1), 1)
               else (r.amount * v_pct / 100.0)
                    / greatest(coalesce(sro_cnt.cnt, nullif(r.assigned_officer_count, 0), 1), 1)
             end
           ) as sum_share
    from service_records r
    join service_record_officers sro on sro.service_record_id = r.id and sro.officer_id = p_officer_id
    left join (
      select service_record_id, count(*)::int as cnt
      from service_record_officers group by service_record_id
    ) sro_cnt on sro_cnt.service_record_id = r.id
    left join service_record_revenue_overrides ov on ov.service_record_id = r.id
    left join service_rates sr on sr.id = r.service_rate_id
    where r.status = 'paid'
      and r.service_date is not null
      and to_char(r.service_date, 'YYYY-MM') <= p_period
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
    group by to_char(r.service_date, 'YYYY-MM')
  ) m;

  v_result := jsonb_build_object(
    'scope', p_scope,
    'period', p_period,
    'closed', true,
    'officer_share_percent', v_pct,
    'record_count', v_count,
    'gross_amount', round(v_gross * 100) / 100,
    'per_officer_total', round(v_total * 100) / 100,
    'records', v_records,
    'months', v_months
  );

  return v_result;
end;
$$;

-- ---------- claim_service_share: รวมทุกเดือนที่ <= p_period ----------
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
  v_record_id uuid;
  v_inserted_ids uuid[] := '{}';
  v_total numeric(10,2) := 0;
  v_count integer := 0;
begin
  if not public.claim_period_is_closed(p_period) then
    raise exception 'CLAIM_PERIOD_NOT_CLOSED: รับส่วนแบ่งได้เฉพาะงวดที่ปิดเดือนแล้วเท่านั้น (งวด % ยังไม่จบ)', p_period;
  end if;

  select officer_share_percent into v_pct
  from revenue_sharing_config where scope = p_scope;
  if v_pct is null then v_pct := 10.00; end if;

  for v_record in
    select r.id,
           to_char(r.service_date, 'YYYY-MM') as month,
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
      from service_record_officers group by service_record_id
    ) sro_cnt on sro_cnt.service_record_id = r.id
    left join service_record_revenue_overrides ov on ov.service_record_id = r.id
    left join service_rates sr on sr.id = r.service_rate_id
    where r.status = 'paid'
      -- ★ รวมเดือนที่ค้างทั้งหมดที่ <= p_period
      and r.service_date is not null
      and to_char(r.service_date, 'YYYY-MM') <= p_period
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
      -- claim_period = เดือนจริงของบิล ไม่ใช่เดือนที่กด
      p_officer_id, v_record.id, v_record.share, p_scope, v_pct,
      v_record.month, 1, 'pending', p_actor_id, p_note
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

-- ---------- ตารางสรุปคะแนนค้างรายคน สำหรับหัวหน้ากรม ----------
drop function if exists public.list_pending_claims_by_officer();

create or replace function public.list_pending_claims_by_officer()
returns table (
  officer_id uuid,
  officer_name text,
  month text,
  record_count integer,
  gross_amount numeric(14,2),
  officer_total numeric(14,2),
  scope text
)
language sql
stable
security definer
set search_path = public
as $$
  with cfg as (
    select
      coalesce(max(officer_share_percent) filter (where scope = 'default'), 10.00) as pct_default,
      coalesce(max(officer_share_percent) filter (where scope = 'vehicle_rescue'), 10.00) as pct_vr
    from revenue_sharing_config
  )
  select
    o.id,
    o.name,
    to_char(r.service_date, 'YYYY-MM') as month,
    count(*)::int,
    sum(r.amount),
    sum(
      case
        when ov.officer_share is not null and ov.officer_share > 0
          then ov.officer_share / greatest(coalesce(sro_cnt.cnt, nullif(r.assigned_officer_count, 0), 1), 1)
        when r.officer_share is not null and r.officer_share > 0
          then r.officer_share / greatest(coalesce(sro_cnt.cnt, nullif(r.assigned_officer_count, 0), 1), 1)
        else
          (r.amount * case
             when coalesce(nullif(r.service_category, ''), sr.category) = 'vehicle_rescue'
               then cfg.pct_vr
             else cfg.pct_default
           end / 100.0) / greatest(coalesce(sro_cnt.cnt, nullif(r.assigned_officer_count, 0), 1), 1)
      end
    ),
    case
      when coalesce(nullif(r.service_category, ''), sr.category) = 'vehicle_rescue'
        then 'vehicle_rescue'
      else 'default'
    end as scope
  from service_records r
  join service_record_officers sro on sro.service_record_id = r.id
  join officers o on o.id = sro.officer_id and o.status = 'active'
  left join (
    select service_record_id, count(*)::int as cnt
    from service_record_officers group by service_record_id
  ) sro_cnt on sro_cnt.service_record_id = r.id
  left join service_record_revenue_overrides ov on ov.service_record_id = r.id
  left join service_rates sr on sr.id = r.service_rate_id
  cross join cfg
  where r.status = 'paid'
    and r.service_date is not null
    and to_char(r.service_date, 'YYYY-MM') < to_char(now() at time zone 'Asia/Bangkok', 'YYYY-MM')
    and not exists (
      select 1 from claim_records cr
      where cr.service_record_id = r.id
        and cr.officer_id = sro.officer_id
        and cr.status in ('pending','approved','paid')
    )
  group by o.id, o.name, to_char(r.service_date, 'YYYY-MM'),
           case
             when coalesce(nullif(r.service_category, ''), sr.category) = 'vehicle_rescue'
               then 'vehicle_rescue'
             else 'default'
           end;
$$;

revoke all on function public.list_pending_claims_by_officer() from public;
grant execute on function public.list_pending_claims_by_officer() to anon, authenticated;
grant execute on function public.preview_claim_share(uuid, text, text) to anon, authenticated;
grant execute on function public.claim_service_share(uuid, text, text, uuid, text) to anon, authenticated;

-- ---------- ตรวจสอบ ----------
do $$
begin
  if exists (select 1 from pg_proc where proname = 'list_pending_claims_by_officer') then
    raise notice '0040 สำเร็จ: รับส่วนแบ่งรวมเดือนค้าง + ตารางสรุปสำหรับหัวหน้ากรม';
  else
    raise exception '0040 ล้มเหลว: ไม่พบ list_pending_claims_by_officer';
  end if;
end $$;
