-- Backfill service categories for existing records so claim scope matches the selected service rate.
alter table service_records
  add column if not exists service_category text;

update service_records r
set service_category = sr.category,
    updated_at = now()
from service_rates sr
where r.service_rate_id = sr.id
  and (r.service_category is null or r.service_category = '')
  and sr.category is not null
  and sr.category <> '';
