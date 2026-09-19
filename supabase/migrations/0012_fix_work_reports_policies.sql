-- =============================================================
-- Fix work_reports RLS policies (idempotent)
--
-- 0011 used `auth.uid() is not null` for INSERT, which blocks officers
-- that authenticate through the app's custom auth context.
-- Replace with current_rank() so any logged-in officer can submit a
-- report, commissioner/inspector can read all, and only commissioner
-- can delete.
-- =============================================================

drop policy if exists "work_reports read" on work_reports;
drop policy if exists "work_reports insert" on work_reports;
drop policy if exists "work_reports update" on work_reports;
drop policy if exists "work_reports delete" on work_reports;

create policy "work_reports read" on work_reports
  for select using (
    officer_id = auth.uid()
    or current_rank() in ('commissioner', 'inspector')
  );

create policy "work_reports insert" on work_reports
  for insert with check (current_rank() in ('commissioner', 'inspector', 'officer'));

create policy "work_reports update" on work_reports
  for update using (
    officer_id = auth.uid()
    or current_rank() = 'commissioner'
  )
  with check (
    officer_id = auth.uid()
    or current_rank() = 'commissioner'
  );

create policy "work_reports delete" on work_reports
  for delete using (current_rank() = 'commissioner');
