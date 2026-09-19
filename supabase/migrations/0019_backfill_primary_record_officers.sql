-- Keep legacy service_records.officer_id assignments compatible with claim submissions.
insert into service_record_officers (service_record_id, officer_id, assigned_by)
select r.id, r.officer_id, r.officer_id
from service_records r
where r.officer_id is not null
  and not exists (
    select 1
    from service_record_officers sro
    where sro.service_record_id = r.id
      and sro.officer_id = r.officer_id
  );
