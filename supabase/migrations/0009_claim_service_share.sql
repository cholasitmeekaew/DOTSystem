-- =============================================================
-- Claim Service Share System
-- 1) claim_records — ledger ของการ claim แต่ละครั้ง (audit-friendly)
-- 2) officers.accumulated_share — cached total ของยอดสะสมรอจ่าย
-- 3) RPC: preview_claim_share — คำนวณยอดที่ officer จะได้ก่อน claim
-- 4) RPC: claim_service_share — INSERT claim pending
-- 5) RPC: approve_claim — อนุมัติ + increment accumulated_share
-- 6) RPC: reject_claim — ปฏิเสธ (ไม่แตะ accumulated_share)
-- 7) RPC: mark_claim_paid — จ่ายแล้ว + decrement accumulated_share
-- =============================================================

-- 1) Claim ledger
create table if not exists claim_records (
  id uuid primary key default gen_random_uuid(),
  officer_id uuid not null references officers(id) on delete cascade,
  service_record_id uuid references service_records(id) on delete set null,
  amount numeric(10,2) not null check (amount >= 0),
  scope text not null check (scope in ('default','vehicle_rescue')),
  officer_share_percent numeric(5,2) not null check (officer_share_percent >= 0 and officer_share_percent <= 100),
  claim_period text not null,           -- 'YYYY-MM'
  record_count integer not null default 1 check (record_count > 0),
  status text not null default 'pending'
    check (status in ('pending','approved','rejected','paid')),
  claimed_by uuid not null references officers(id),
  approved_by uuid references officers(id),
  approved_at timestamptz,
  rejected_by uuid references officers(id),
  rejected_at timestamptz,
  reject_reason text,
  paid_by uuid references officers(id),
  paid_at timestamptz,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists claim_officer_period_idx on claim_records(officer_id, claim_period);
create index if not exists claim_status_idx on claim_records(status);
create index if not exists claim_scope_period_idx on claim_records(scope, claim_period);

-- 2) Accumulated share column on officers
alter table officers
  add column if not exists accumulated_share numeric(12,2) default 0
    check (accumulated_share >= 0);

-- RLS for claim_records
alter table claim_records enable row level security;

drop policy if exists "claim self read" on claim_records;
create policy "claim self read" on claim_records
  for select using (officer_id = auth.uid() OR current_rank() = 'commissioner');

drop policy if exists "claim officer insert" on claim_records;
create policy "claim officer insert" on claim_records
  for insert with check (
    (officer_id = auth.uid() AND claimed_by = auth.uid())
    OR current_rank() = 'commissioner'
  );

drop policy if exists "claim commissioner update" on claim_records;
create policy "claim commissioner update" on claim_records
  for update using (current_rank() = 'commissioner')
    with check (current_rank() = 'commissioner');

-- 3) Preview: คำนวณยอดที่ officer จะได้รับ (ยังไม่ claim)
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
  -- ดึง % ตาม scope
  select officer_share_percent into v_pct
  from revenue_sharing_config where scope = p_scope;
  if v_pct is null then v_pct := 10.00; end if;

  select officer_share_percent into v_default_pct
  from revenue_sharing_config where scope = 'default';
  if v_default_pct is null then v_default_pct := 10.00; end if;

  -- คำนวณยอด paid records ที่ officer ดูแล ในงวด p_period
  -- ที่ยังไม่ถูก claim (status != 'rejected' หรือ service_record_id not in claim_records)
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
      -- exclude records ที่ถูก claim แล้ว (status pending/approved/paid)
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
    'officer_share_percent', v_pct,
    'record_count', v_count,
    'gross_amount', round(v_gross * 100) / 100,
    'per_officer_total', round(v_total * 100) / 100,
    'records', v_records
  );

  return v_result;
end;
$$;

-- 4) Submit claim: INSERT 1 row ต่อ record (granular ledger)
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
  v_inserted_ids uuid[] := '{}';
  v_total numeric(10,2) := 0;
  v_count integer := 0;
begin
  -- ดึง %
  select officer_share_percent into v_pct
  from revenue_sharing_config where scope = p_scope;
  if v_pct is null then v_pct := 10.00; end if;

  -- loop paid records ที่ยังไม่เคย claim
  for v_record in
    select
      r.id as sr_id,
      r.service_name,
      r.amount,
      coalesce(sro_cnt.cnt, nullif(r.assigned_officer_count, 0), 1) as assigned_count,
      case
        when ov.officer_share is not null and ov.officer_share > 0
          then ov.officer_share / greatest(coalesce(sro_cnt.cnt, nullif(r.assigned_officer_count, 0), 1), 1)
        when r.officer_share is not null and r.officer_share > 0
          then r.officer_share / greatest(coalesce(sro_cnt.cnt, nullif(r.assigned_officer_count, 0), 1), 1)
        else
          (r.amount * v_pct / 100.0) / greatest(coalesce(sro_cnt.cnt, nullif(r.assigned_officer_count, 0), 1), 1)
      end as per_officer_share
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
      officer_id, service_record_id, amount, scope,
      officer_share_percent, claim_period, record_count,
      status, claimed_by, note
    ) values (
      p_officer_id, v_record.sr_id, v_record.per_officer_share, p_scope,
      v_pct, p_period, 1,
      'pending', p_actor_id, p_note
    ) returning id into v_record.id;

    v_inserted_ids := array_append(v_inserted_ids, v_record.id);
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

-- 5) Approve: อนุมัติทุก claim ในกลุ่ม (pending → approved) + increment accumulated
create or replace function approve_claim(
  p_claim_id uuid,
  p_approver_id uuid
) returns void
language plpgsql
security definer
as $$
declare
  v_officer_id uuid;
  v_amount numeric(10,2);
  v_status text;
begin
  select officer_id, amount, status into v_officer_id, v_amount, v_status
  from claim_records where id = p_claim_id for update;

  if v_officer_id is null then
    raise exception 'Claim not found' using errcode = 'P0002';
  end if;
  if v_status != 'pending' then
    raise exception 'Claim is not pending (current: %)', v_status using errcode = 'P0001';
  end if;

  update claim_records
  set status = 'approved',
      approved_by = p_approver_id,
      approved_at = now()
  where id = p_claim_id;

  update officers
  set accumulated_share = coalesce(accumulated_share, 0) + v_amount
  where id = v_officer_id;
end;
$$;

-- 6) Reject: เปลี่ยนเป็น rejected เฉยๆ ไม่แตะ accumulated_share
create or replace function reject_claim(
  p_claim_id uuid,
  p_rejecter_id uuid,
  p_reason text
) returns void
language plpgsql
security definer
as $$
declare
  v_status text;
begin
  select status into v_status from claim_records where id = p_claim_id for update;

  if v_status is null then
    raise exception 'Claim not found' using errcode = 'P0002';
  end if;
  if v_status != 'pending' then
    raise exception 'Claim is not pending (current: %)', v_status using errcode = 'P0001';
  end if;

  update claim_records
  set status = 'rejected',
      rejected_by = p_rejecter_id,
      rejected_at = now(),
      reject_reason = p_reason
  where id = p_claim_id;
end;
$$;

-- 7) Mark as paid: approved → paid + decrement accumulated_share
create or replace function mark_claim_paid(
  p_claim_id uuid,
  p_payer_id uuid
) returns void
language plpgsql
security definer
as $$
declare
  v_officer_id uuid;
  v_amount numeric(10,2);
  v_status text;
begin
  select officer_id, amount, status into v_officer_id, v_amount, v_status
  from claim_records where id = p_claim_id for update;

  if v_officer_id is null then
    raise exception 'Claim not found' using errcode = 'P0002';
  end if;
  if v_status != 'approved' then
    raise exception 'Claim must be approved first (current: %)', v_status using errcode = 'P0001';
  end if;

  update claim_records
  set status = 'paid',
      paid_by = p_payer_id,
      paid_at = now()
  where id = p_claim_id;

  update officers
  set accumulated_share = greatest(coalesce(accumulated_share, 0) - v_amount, 0)
  where id = v_officer_id;
end;
$$;

-- หลัง apply รัน:
--   NOTIFY pgrst, 'reload schema';
