-- Make claim submission work for both legacy officer_id assignments and
-- the newer service_record_officers assignment table.
create or replace function claim_service_share(
  p_officer_id uuid,
  p_period text,
  p_scope text,
  p_actor_id uuid,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pct numeric(5,2);
  v_record record;
  v_inserted_ids uuid[] := '{}';
  v_total numeric(10,2) := 0;
  v_count integer := 0;
  v_new_id uuid;
begin
  -- ดึง % สัดส่วนแบ่งรายได้ (Staff Pool) ล่าสุดจากตาราง revenue_sharing_config เสมอ
  select officer_share_percent into v_pct
  from revenue_sharing_config
  where scope = p_scope;

  if v_pct is null then
    select officer_share_percent into v_pct
    from revenue_sharing_config
    where scope = 'default';
  end if;

  if v_pct is null then v_pct := 10.00; end if;

  for v_record in
    select
      r.id as sr_id,
      -- สูตรคำนวณ: ยอดค่าบริการจริง x (Staff Pool % / 100) / จำนวนผู้ดูแลเคส
      case
        when ov.officer_share is not null and ov.officer_share > 0
          then round((ov.officer_share / greatest(coalesce(sro_cnt.cnt, nullif(r.assigned_officer_count, 0), 1), 1))::numeric, 2)
        else
          round(((r.amount * v_pct / 100.0) / greatest(coalesce(sro_cnt.cnt, nullif(r.assigned_officer_count, 0), 1), 1))::numeric, 2)
      end as per_officer_share
    from service_records r
    left join service_record_officers sro
      on sro.service_record_id = r.id
     and sro.officer_id = p_officer_id
    left join (
      select service_record_id, count(*)::int as cnt
      from service_record_officers
      group by service_record_id
    ) sro_cnt on sro_cnt.service_record_id = r.id
    left join service_record_revenue_overrides ov on ov.service_record_id = r.id
    left join service_rates sr on sr.id = r.service_rate_id
    where r.status = 'paid'
      and to_char(r.service_date, 'YYYY-MM') = p_period
      and (sro.officer_id is not null or r.officer_id = p_officer_id)
      and case
            when coalesce(nullif(r.service_category, ''), sr.category, '') = 'vehicle_rescue' then 'vehicle_rescue'
            else 'default'
          end = p_scope
      and not exists (
        select 1
        from claim_records cr
        where cr.service_record_id = r.id
          and cr.officer_id = p_officer_id
          and cr.status in ('pending', 'approved', 'paid')
      )
  loop
    insert into claim_records (
      officer_id, service_record_id, amount, scope,
      officer_share_percent, claim_period, record_count,
      status, claimed_by, note
    ) values (
      p_officer_id, v_record.sr_id, v_record.per_officer_share, p_scope,
      v_pct, p_period, 1, 'pending', p_actor_id, p_note
    ) returning id into v_new_id;

    v_inserted_ids := array_append(v_inserted_ids, v_new_id);
    v_total := v_total + v_record.per_officer_share;
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object(
    'success', true,
    'claim_ids', to_jsonb(v_inserted_ids),
    'record_count', v_count,
    'total_amount', round(v_total * 100) / 100
  );
end;
$$;

grant execute on function claim_service_share(uuid, text, text, uuid, text) to anon, authenticated;
