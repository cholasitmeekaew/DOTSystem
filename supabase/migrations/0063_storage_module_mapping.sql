-- =============================================================
-- 0063: Module-based Storage Mapping (โครงสร้างความสัมพันธ์แยก)
-- =============================================================
-- แนวคิด: ไม่กวาด Storage กลางแบบสุ่มอีกต่อไป
--   แต่ละโมดูล déclare ชัดเจนว่า
--     1) เก็บ URL รูปในตาราง/คอลัมน์ไหนของ DB
--     2) เก็บไฟล์ใน bucket + path pattern ไหนของ Storage
--
-- ตาราง:
--   storage_module_registry  — 1 แถว/โมดูล (ผูก DB table+column)
--   storage_module_locations — หลายแถว/โมดูล (ผูก bucket + regex path)
--
-- RPC:
--   get_module_storage_stats() คืน file_count / file_bytes / db_ref_count
--   แยกรายโมดูลอิสระ ไม่ทับซ้อน ไม่แชร์กัน
--
-- หมายเหตุ: ไฟล์เก่าที่อยู่ใน evidence/ (ไม่มี subfolder) ถือเป็นของ services
--   ส่วนไฟล์ใหม่จะแยกเป็น evidence/services, evidence/work_reports,
--   evidence/emergency ตามที่แก้โค้ดอัปโหลด
-- =============================================================

-- ── 1) Registry: 1 แถวต่อโมดูล ──
create table if not exists public.storage_module_registry (
  module_key   text primary key,
  module_label text not null,
  db_table     text,
  db_column    text,
  db_filter    text,
  sort_order   int not null default 0
);

-- ── 2) Locations: หลายที่เก็บต่อโมดูล ──
create table if not exists public.storage_module_locations (
  module_key   text not null
    references public.storage_module_registry(module_key) on delete cascade,
  bucket_id    text not null,
  path_pattern text not null,
  primary key (module_key, bucket_id, path_pattern)
);

-- ── 3) Seed registry (idempotent) ──
insert into public.storage_module_registry
  (module_key, module_label, db_table, db_column, db_filter, sort_order)
values
  ('officers',     'เจ้าหน้าที่',        'officers',           'photo_url',    'status <> ''deleted''', 10),
  ('services',     'เคส / บริการ',        'service_records',    'evidence_url', null,                    20),
  ('work_reports', 'รายงานปฏิบัติงาน',     'work_report_cases',  'evidence_url', null,                    30),
  ('announcements','ประกาศ / ข่าวสาร',     'announcements',      'image_url',    null,                    40),
  ('complaints',   'ร้องเรียน',           'complaints',         'evidence_url', null,                    50),
  ('vehicles',     'ยานพาหนะ / ใบอนุญาต', 'vehicles',           'image_url',    null,                    60),
  ('emergency',    'แจ้งเหตุฉุกเฉิน',      'emergency_reports',  'image_url',    null,                    70),
  ('manual',       'คู่มือ',              'manual_blocks',      'content',      'type = ''image''',      80)
on conflict (module_key) do update set
  module_label = excluded.module_label,
  db_table     = excluded.db_table,
  db_column    = excluded.db_column,
  db_filter    = excluded.db_filter,
  sort_order   = excluded.sort_order;

-- ── 4) Seed locations (idempotent) ──
insert into public.storage_module_locations (module_key, bucket_id, path_pattern)
values
  -- เจ้าหน้าที่ (ปัจจุบัน + bucket เก่า)
  ('officers',      'officer-photos', '^officers/[^/]+$'),
  ('officers',      'dot-uploads',    '^officers/[^/]+$'),
  -- เคส/บริการ (ไฟล์เก่าอยู่ที่ evidence/ ตรง ๆ + ไฟล์ใหม่ยู่ evidence/services/)
  ('services',      'evidence',       '^evidence/[^/]+$'),
  ('services',      'dot-uploads',    '^evidence/[^/]+$'),
  ('services',      'evidence',       '^evidence/services/.*'),
  -- รายงานปฏิบัติงาน (ไฟล์ใหม่เท่านั้น)
  ('work_reports',  'evidence',       '^evidence/work_reports/.*'),
  -- ประกาศ
  ('announcements', 'announcements',  '^announcements/[^/]+$'),
  ('announcements', 'dot-uploads',    '^announcements/[^/]+$'),
  -- ยานพาหนะ
  ('vehicles',      'vehicles',       '^vehicles/[^/]+$'),
  ('vehicles',      'dot-uploads',    '^vehicles/[^/]+$'),
  -- คู่มือ
  ('manual',        'manual',         '^manual/[^/]+$'),
  ('manual',        'dot-uploads',    '^manual/[^/]+$'),
  -- แจ้งเหตุฉุกเฉิน (ไฟล์ใหม่เท่านั้น)
  ('emergency',     'evidence',       '^evidence/emergency/.*')
on conflict (module_key, bucket_id, path_pattern) do nothing;

-- ── 5) RPC อ่านค่าจาก Mapping ──
create or replace function public.get_module_storage_stats()
returns table (
  module_key   text,
  module_label text,
  file_count   bigint,
  file_bytes   bigint,
  db_ref_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  rec    record;
  fcount bigint;
  fbytes bigint;
  dcount bigint;
  cond   text;
begin
  for rec in
    select * from public.storage_module_registry order by sort_order, module_key
  loop
    -- จำนวนไฟล์ + ขนาด จาก location ที่ผูกไว้ (แต่ละไฟล์ถูกนับครั้งเดียว)
    select
      count(*),
      coalesce(sum((o.metadata->>'size')::bigint), 0)
    into fcount, fbytes
    from storage.objects o
    where exists (
      select 1
      from public.storage_module_locations l
      where l.module_key = rec.module_key
        and l.bucket_id  = o.bucket_id
        and o.name ~ l.path_pattern
    );

    -- จำนวน URL ที่ยังอ้างอิงใน DB ของโมดูลนั้น
    dcount := 0;
    if rec.db_table is not null and rec.db_column is not null then
      cond := format('%I is not null and %I <> ''''', rec.db_column, rec.db_column);
      if rec.db_filter is not null and btrim(rec.db_filter) <> '' then
        cond := cond || ' and (' || rec.db_filter || ')';
      end if;
      execute format('select count(*) from public.%I where %s', rec.db_table, cond)
        into dcount;
    end if;

    module_key   := rec.module_key;
    module_label := rec.module_label;
    file_count   := coalesce(fcount, 0);
    file_bytes   := coalesce(fbytes, 0);
    db_ref_count := coalesce(dcount, 0);
    return next;
  end loop;
end;
$$;

grant execute on function public.get_module_storage_stats() to anon, authenticated;

-- ── ตรวจสอบ ──
select * from public.get_module_storage_stats() order by sort_order;