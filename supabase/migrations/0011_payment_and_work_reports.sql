-- =============================================================
-- Payment installments & work reports
-- =============================================================

-- ---------------------------------------------------------------
-- 1. Payment installments
-- ---------------------------------------------------------------

-- Track how much has actually been paid on each service record
alter table service_records
  add column if not exists paid_amount numeric(10,2) not null default 0;

-- Installment ledger
 create table if not exists service_payments (
   id uuid primary key default gen_random_uuid(),
   service_record_id uuid not null references service_records(id) on delete cascade,
   amount numeric(10,2) not null check (amount > 0),
   recorded_by uuid references officers(id) on delete set null,
   recorded_by_name text,
   notes text,
   created_at timestamptz not null default now(),
   updated_at timestamptz not null default now()
 );

-- Recalculate paid_amount and status on the parent record
 create or replace function recalc_service_record_payment(p_service_record_id uuid)
 returns void
 language plpgsql
 security definer
 as $$
 declare
   v_total numeric(10,2);
   v_amount numeric(10,2);
 begin
   select coalesce(sum(amount), 0) into v_total
   from service_payments
   where service_record_id = p_service_record_id;

   select amount into v_amount
   from service_records
   where id = p_service_record_id;

   update service_records
   set
     paid_amount = v_total,
     status = case when v_total >= v_amount then 'paid' else 'unpaid' end,
     updated_at = now()
   where id = p_service_record_id;
 end;
 $$;

-- Trigger that keeps service_records in sync
 create or replace function trg_service_payments_recalc()
 returns trigger
 language plpgsql
 security definer
 as $$
 begin
   if tg_op = 'DELETE' then
     perform recalc_service_record_payment(old.service_record_id);
     return old;
   else
     perform recalc_service_record_payment(new.service_record_id);
     return new;
   end if;
 end;
 $$;

 drop trigger if exists service_payments_recalc on service_payments;
 create trigger service_payments_recalc
 after insert or update or delete on service_payments
 for each row execute function trg_service_payments_recalc();

-- Seed existing records
 update service_records
 set paid_amount = amount
 where status = 'paid' and paid_amount = 0;

 update service_records
 set paid_amount = 0
 where status = 'unpaid' and paid_amount <> 0;

-- ---------------------------------------------------------------
-- 2. Work reports
-- ---------------------------------------------------------------
 create table if not exists work_reports (
   id uuid primary key default gen_random_uuid(),
   officer_id uuid not null references officers(id) on delete cascade,
   officer_name text not null,
   duty_log_id uuid references duty_logs(id) on delete set null,
   report_text text not null,
   created_at timestamptz not null default now(),
   updated_at timestamptz not null default now()
 );

-- ---------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------
 alter table service_payments enable row level security;
 alter table work_reports enable row level security;

-- service_payments
 create policy if not exists "service_payments read" on service_payments
   for select using (auth.uid() is not null);

 create policy if not exists "service_payments write" on service_payments
   for all using (current_rank() = 'commissioner')
   with check (current_rank() = 'commissioner');

-- work_reports
 create policy if not exists "work_reports read" on work_reports
   for select using (
     officer_id = auth.uid()
     or current_rank() in ('commissioner', 'inspector')
   );

 create policy if not exists "work_reports insert" on work_reports
   for insert with check (current_rank() in ('commissioner', 'inspector', 'officer'));

 create policy if not exists "work_reports update" on work_reports
   for update using (
     officer_id = auth.uid()
     or current_rank() = 'commissioner'
   )
   with check (
     officer_id = auth.uid()
     or current_rank() = 'commissioner'
   );

 create policy if not exists "work_reports delete" on work_reports
   for delete using (current_rank() = 'commissioner');

-- ---------------------------------------------------------------
-- 4. Realtime
-- ---------------------------------------------------------------
 alter publication supabase_realtime add table service_payments;
 alter publication supabase_realtime add table work_reports;
