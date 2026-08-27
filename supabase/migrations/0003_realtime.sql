-- =============================================================
-- Enable Realtime for live updates
-- =============================================================

alter publication supabase_realtime add table officers;
alter publication supabase_realtime add table duty_logs;
alter publication supabase_realtime add table service_records;
alter publication supabase_realtime add table emergency_reports;
alter publication supabase_realtime add table officer_leaves;
alter publication supabase_realtime add table complaints;
alter publication supabase_realtime add table announcements;
alter publication supabase_realtime add table vehicles;
alter publication supabase_realtime add table citizens;
alter publication supabase_realtime add table licenses;
