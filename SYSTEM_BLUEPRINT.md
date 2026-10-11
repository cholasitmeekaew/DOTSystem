# SYSTEM BLUEPRINT — DOTSystem (Bit Cities Department of Transportation)

> เอกสารนี้เป็น **แหล่งอ้างอิงหลัก** สำหรับการแก้ไขโค้ดในอนาคต
> สร้างจากการอ่านโค้ดจริงทั้งหมด: `supabase/migrations/0001–0026`, `src/lib/**`, `src/pages/**`, `src/components/**`
> **ห้ามเพิ่มฟีเจอร์ที่ไม่มีในเอกสารนี้ — ถ้าต้องการเพิ่ม ให้ปรับเอกสารนี้ก่อน**

---

## 0. สรุปภาพรวม

| หัวข้อ | ค่า |
|---|---|
| ชื่อระบบ | DOTSystem — กรมขนส่ง (Department of Transportation) สำหรับเซิร์ฟเวอร์ ER:LC roleplay **Bit Cities** |
| Framework | Vite 7 + React 19 + TypeScript 5 |
| Styling | Tailwind CSS v4 (ธีม navy/amber + glass-morphism) |
| UI Kit | shadcn/ui (Radix primitives ครบชุด 60+ ไฟล์ใน `src/components/ui/`) |
| Data | **Dual-mode**: Supabase (Postgres/Auth/Realtime/Storage) **หรือ** JSON mock บน localStorage |
| Query | TanStack Query v5 (ติดตั้งแล้ว แต่ **ยังไม่ถูกใช้งานจริง** — ดูหมายเหตุ §11) |
| Animation | Framer Motion |
| Routing | **ไม่มี URL router** — ใช้ `useState` เป็น state-based router ใน `src/App.tsx` (`wouter` ติดตั้งไว้แต่ไม่ได้ใช้ใน App) |
| แผนที่ | Leaflet (tiles จาก `erlc-tools.com` "summer") |
| อื่นๆ | html2canvas (ดาวน์โหลดบัตรประจำตัว), lucide-react, recharts (ติดตั้งแต่ไม่ได้ใช้ — ใช้ hand-rolled SVG แทน), zod, date-fns (ติดตั้งแต่ไม่ได้ใช้) |

### โหมดฐานข้อมูล (`src/lib/supabase.ts:12`)
```
hasSupabaseEnv = Boolean(VITE_SUPABASE_URL && VITE_SUPABASE_ANON_KEY)
useMock        = (VITE_USE_MOCK === 'true')
dbMode         = (hasSupabaseEnv && !useMock) ? 'supabase' : 'json'
```
- ถ้า env ไม่ครบ **หรือ** `VITE_USE_MOCK=true` → ใช้ `createJsonSupabaseClient()` จาก `src/lib/jsonDb.ts`
- ทุก API module import `supabase` ตัวเดียวกัน → **สลับโหมดที่ระดับ client ไม่ได้ที่ระดับ hook**
- โหมดถูกกำหนดครั้งเดียวตอน module load ไม่มี UI สลับโหมด

---

## 1. โครงสร้างโค้ด

```
src/
├── App.tsx                    # state-based router + AccessDenied guard
├── main.tsx, index.css
├── components/
│   ├── ui/                    # shadcn/ui primitives (60+)
│   ├── animations/            # MotionWrappers.tsx, PageTransition.tsx (DEAD)
│   ├── layout/RoleGuard.tsx   # DEAD — ไม่ถูกใช้
│   ├── Modal.tsx              # Modal + ConfirmDialog (ใช้ทั้งระบบ)
│   ├── Badge.tsx              # 5 variants
│   ├── PageHeader.tsx
│   ├── Charts.tsx             # GoldBarChart, DonutChart (hand-rolled SVG)
│   ├── IdCard.tsx             # บัตรประจำตัวดิจิทัล + html2canvas download
│   ├── MapPicker.tsx          # MapPicker + MapPreview (Leaflet)
│   ├── ServerStatusCard.tsx   # external API bitnewsth.qd.je
│   ├── RankedList.tsx         # DEAD
│   ├── BatchDutyRateModal.tsx # (มี duplicate ใน OfficerManagementPage — ดู §11)
│   ├── ClaimApprovalTable.tsx # ตารางอนุมัติ/จ่าย claim (commissioner)
│   ├── ClaimShareModal.tsx    # ฟอร์ม preview+ส่ง claim (officer)
│   ├── OfficerHistoryModal.tsx# ประวัติเจ้าหน้าที่แบบรวม 7 สถิติ
│   ├── OfficerLayout.tsx      # เมนู 15 รายการ (3 กลุ่ม)
│   ├── PublicLayout.tsx       # เมนู 10 รายการ
│   ├── error-boundary.tsx     # DEAD — ไม่ได้ mount
│   └── not-found.tsx → pages/
├── data/
│   ├── seed.ts                # 19 อัตราค่าบริการมาตรฐาน + admin + รุ่น 1-3 seed
│   ├── manualContent.tsx      # คู่มือเจ้าหน้าที่ 11 บท ~83 หัวข้อ
│   └── citizenManualContent.tsx # คู่มือประชาชน 7 บท 12 หัวข้อ
├── hooks/                     # useAuth, useRole, useQueryProvider, use-toast, use-mobile
├── lib/
│   ├── types.ts               # Domain types + constants ทั้งหมด
│   ├── supabase.ts            # dual-mode client
│   ├── jsonDb.ts (887 บรรทัด) # localStorage DB + RPC mocks 16 ตัว
│   ├── AuthContext.tsx        # session ใน localStorage
│   ├── crypto.ts              # SHA-256 hashPassword
│   ├── storage.ts             # uploadImage / deleteImage
│   ├── citizenDebt.ts         # สูตรหนี้ค้างชำระ (กลาง)
│   ├── dutyStats.ts           # สูตรชั่วโมงเวร + สัดส่วนงานรายหมวด
│   ├── personnelOrder.ts      # สูตรเรียง/จัดกลุ่ม/ป้ายรุ่น (ใช้ร่วม 2 หน้า — migration 0027)
│   ├── utils.ts, realtime/
│   └── api/                   # 19 ไฟล์ (ดู §9)
└── pages/
    ├── public/  10 หน้า
    └── officer/ 16 หน้า
supabase/migrations/ 0001–0030 (30 ไฟล์, 27 ตาราง, 22 ฟังก์ชัน, 1 trigger)
│   └── APPLY_0027-0030.sql  # รวม 0027→0030 สำหรับ paste ใน SQL Editor (idempotent)
│   └── VERIFY.sql           # query ตรวจสอบ 18 รายการในผลลัพธ์เดียว
```

---

## 2. บทบาทและสิทธิ์

`officers.rank` — 3 ระดับ (DB CHECK constraint + `officer_ranks` lookup table):

| rank_key | ชื่อไทย | สิทธิ์จริงใน UI |
|---|---|---|
| `commissioner` | หัวหน้ากรมขนส่ง | ทุกหน้า + kill-switch + อนุมัติ claim + จ่ายเงินเดือน |
| `inspector` | ผู้คุมสอบกรมขนส่ง | เข้าเวร/ออกเวร, บันทึกค่าบริการ, รับส่วนแบ่ง, แต่**ถูกบล็อก**จากหน้าจัดการส่วนใหญ่ |
| `officer` | พนักงาน | เข้าเวร/ออกเวร, บันทึกค่าบริการ, รับส่วนแบ่ง |

**หน้า commissioner-only** (`App.tsx:69` `commissionerOnlyPages` = `announcements, service-rates, officer-management, citizen-management, complaints` + guard ใน JSX เพิ่ม `points-management, department-balance`)

**หมวดหมู่ตำแหน่งอื่น**: `officer_ranks` table รองรับการเพิ่ม/ลบ/แก้ rank ได้ (`OfficerManagementPage` → "จัดการตำแหน่ง") แต่ `officers.rank` ยังมี CHECK จำกัดไว้แค่ 3 ค่าใน DB — **การเพิ่ม rank ใหม่ใน UI จะ insert สำเร็จแต่ officer ที่ใช้ rank นั้นจะติด CHECK constraint**

**แผนก (5 ค่า)**: `civil_maintenance, vehicle_rescue, electrical, traffic_management, emergency_assistance`
**สถานะเจ้าหน้าที่**: `active, suspended, deleted` (ลบเป็น **soft delete** — `status='deleted'`)
**สถานะประชาชน**: `normal, watched, suspended, banned`
  ⚠️ DB CHECK มีแค่ `normal, watched, suspended` — **`banned` ไม่มีใน DB constraint** แต่ถูกใช้ใน UI

### ระบบ Auth (สำคัญ — อ่านก่อนแก้)
1. `hashPassword()` = **SHA-256 ไม่มี salt** (`src/lib/crypto.ts`)
2. `LoginPage` query `officers.select('*')` ตาม username → **ได้ `password_hash` มาเทียบในเบราว์เซอร์**
3. Session = `localStorage['dot_officer']` (เก็บ Officer ทั้ง object รวม `password_hash`)
4. `AuthContext` revalidate ทุก 5 นาที — ถ้า `status` เป็น suspended/deleted → logout อัตโนมัติ
5. Token อ่านจาก localStorage key ที่มี `-auth-token` (poll ทุก 1 วิ + storage event)
6. **ไม่มี `supabase.auth.signInWithPassword` / `signOut` เลย** — `jsonDb.ts` ไม่มี `.auth` namespace
7. Migration `0017_auth_identity_bridge.sql` สร้าง `officers.auth_user_id` + `get_current_officer()` / `current_officer_id()` / `current_officer_rank()` — **ยังไม่ถูกโค้ดฝั่ง client ใช้เลย**

---

## 3. ฐานข้อมูล (Supabase)

**30 migrations · 27 ตาราง · 0 ENUM (ใช้ inline CHECK ทั้งหมด) · 0 VIEW · 1 TRIGGER**

### 3.1 ตารางทั้งหมด

| ตาราง | คอลัมน์หลัก / หมายเหตุ | Migration |
|---|---|---|
| `officer_ranks` | id, label, rank_key(unique), sort_order, is_active | 0001 |
| `officer_generations` | id, label, generation_key(unique), sort_order, **is_trainee**, is_active | **0027** |
| `officers` | id, username(unique), password_hash, name, rank, department, status, is_on_duty, photo_url, **points**, points_period, **points_log(jsonb)**, **duty_rate**, **service_category**, **accumulated_share**, **auth_user_id**, **generation**, **sort_order** | 0001+0006+0007+0009+0017+**0027** |
| `system_settings` | **singleton** `id=1 CHECK(id=1)`, duty_system_enabled, login_enabled, **auto_points_enabled** | 0001 + **0028** |
| `citizens` | id, roblox_username, discord_username, status, notes | 0001 |
| `vehicles` | license_plate, owner_name, vehicle_type, color, brand_model, vehicle_category, citizen_id, is_impounded + impound_reason/location/at/by(_name) + released_at/by(_name), notes, image_url | 0001 |
| `licenses` | roblox_username, discord_username, license_type, license_number(unique), issue_date, expiry_date, status, issued_by(_name), notes, citizen_id | 0001 |
| `service_rates` | rate_key(unique), name, description, price, category, is_active | 0001+0005 |
| `service_records` | roblox_username, discord_username, service_rate_id, service_name, amount, status, service_type, officer_id(_name), notes, evidence_url, service_date, citizen_id, **officer_share**, **central_share**, **assigned_officer_count**, **service_category**, **paid_amount** | 0001+0008+0011+0018 |
| `service_record_officers` | M:N (service_record_id, officer_id), assigned_at, assigned_by | 0008 |
| `revenue_sharing_config` | scope PK (`default`/`vehicle_rescue`), officer_share_percent, central_share_percent, notes | 0008 |
| `service_record_revenue_overrides` | service_record_id PK, officer_share, central_share, reason, edited_at/by | 0008 |
| `department_balances` | department PK, balance, total_earned | 0007 |
| `service_payments` | service_record_id, amount, recorded_by(_name), notes | 0011 |
| `claim_records` | officer_id, service_record_id, amount, scope, officer_share_percent, claim_period, record_count, status, claimed_by, approved_by/at, rejected_by/at/reason, paid_by/at, note | 0009 |
| `payroll_overrides` | PK(officer_id, period_month), manual_duty_income, manual_service_income, manual_bonus, manual_total_net_payout, is_manual_mode, updated_by | 0010 |
| `duty_logs` | officer_id(_name), clock_in, clock_out, duration_minutes, forced_by(_name), checkout_method, **soft delete** (deleted_at/by(_name)/delete_reason) | 0001 |
| `work_reports` | officer_id, duty_log_id, report_text, **summary**, **duty_category**, **status**(pending/approved/rejected), reviewed_by(_name)/at, review_note, **reviewed_points** · RLS ปิด | 0011+0014+0023+**0028** |
| `work_report_cases` | work_report_id, case_name, case_type, citizen_username, citizen_id, case_status(default 'completed'), details, evidence_url | 0014+0023 |
| `complaints` | complainant_name, complainant_contact, officer_name, category, discord_username, incident_datetime, details, evidence_url, status — **ไม่มี updated_at** · status รับเพิ่ม `verified` | 0001 + **0028** |
| `emergency_reports` | discord_username, report_type, details, location, image_url, status, responded_by(_name) | 0001 |
| `announcements` | title, content, image_url, is_pinned, created_by(_name) | 0001 |
| `officer_leaves` | officer_id(_name), leave_type, start_date, end_date, status, reason, reviewed_by(_name)/at, review_note, **days** (cache สำหรับคิดโควตา) | 0001 + **0028** |
| `audit_logs` | bigserial, action, target_type, target_id, performed_by(_name), details(jsonb) | 0001 |
| `manual_items` | variant(default 'officer'), title, content, image_url, created_by(_name) — **ไม่มี updated_at** | 0026 |
| `leave_quotas` | leave_type PK, quota_days (**0 = ไม่จำกัด**), notes, updated_by(_name) | **0028** |
| `duty_schedules` | **1 แถวต่อ 1 คน** ต่อช่องกะ: weekday(0-6), shift_code(`s1`/`s2`), start/end_time, officer_id, **required_officers**, note, is_active | **0028 + 0029 + 0030** |
| `schedule_overrides` | 1 แถวต่อ 1 คน ต่อช่องกะของวันนั้น: override_date, shift_code, officer_id, override_type(`swap`/`leave`/`extra`/`off`), source, ref_id | **0028 + 0029 + 0030** |
| `points_award_marks` | **mark_key UNIQUE** (กันให้คะแนนซ้ำ), officer_id, delta, reason | **0028** |

> ตารางที่ไม่มี trigger ดูแล `updated_at` → client ต้องส่ง `updated_at` เองเสมอ

### 3.2 RPC / Function (22 ชื่อ)

| RPC | Migration | หน้าที่ |
|---|---|---|
| `current_rank()` | 0001 | helper สำหรับ RLS — `rank` ของ `auth.uid()` |
| `increment_department_balance(dept, amt)` | 0007 | +balance, +total_earned |
| `calculate_service_revenue(record_id, pct)` | 0008 | คำนวณ snapshot officer_share/central_share/assigned_officer_count |
| `recalc_service_record_payment(record_id)` | 0011 | รวม `service_payments` → ตั้ง `paid_amount` + `status` |
| `preview_claim_share(officer, period, scope)` | 0009 | คืน JSON: record_count, gross_amount, per_officer_total, records[] |
| `claim_service_share(officer, period, scope, actor, note)` | **0020** (แทน v1 ใน 0009) | สร้าง `claim_records` 1 แถวต่อ service_record |
| `approve_claim(claim_id, approver)` | 0009 | pending→approved, `officers.accumulated_share += amount` |
| `reject_claim(claim_id, rejecter, reason)` | 0009 | pending→rejected (ไม่แตะ accumulated_share) |
| `mark_claim_paid(claim_id, payer)` | 0009 | approved→paid, `accumulated_share -= amount` (floor 0) |
| `list_claims_for_officer(officer_id)` | 0021 | claims ของ officer |
| `list_claims_for_commissioner(viewer_id, status)` | 0021 | ตรวจ `rank='commissioner' AND status='active'` ในตาราง |
| `submit_work_report(...)` | 0013→0016 | โบราณ (superseded) |
| `list_work_reports(viewer_id, viewer_rank)` | 0013→0016 | โบราณ |
| `create_work_report_with_cases(officer, name, duty_log, summary, **duty_category**, cases)` | 0014→**0023** | ใช้งานจริงใน `OperationsPage` |
| `get_work_report_cases(report_id)` | 0014→0023 | โบราณ |
| `record_service_payment(record, amount, officer, name, notes, **officer_rank**)` | 0015 | **ตรวจ `p_officer_rank !== 'commissioner'` → 42501** |
| `list_service_record_officers(record_ids[])` | 0022 | อ่าน assignment แบบ bulk |
| `assign_record_officers(record_id, officer_ids[], assigned_by)` | 0022 | **full replace** — ลบของเดิมทั้งหมดแล้ว insert ใหม่ |
| `get_current_officer()` / `current_officer_id()` / `current_officer_rank()` | 0017 | auth bridge — **ยังไม่ถูกใช้** |

**สูตรคำนวณ (SQL ฝั่ง server ต้องตรงกับ client)**
```
preview_claim_share / claim_service_share (0020):
  eligible = service_records
           WHERE status = 'paid'
             AND to_char(service_date,'YYYY-MM') = period
             AND (category = 'vehicle_rescue') = scope     -- binary: vehicle_rescue | default
             AND (sro.officer_id = officer OR r.officer_id = officer)   -- LEFT JOIN รองรับ legacy
             AND NOT EXISTS claim(status IN ('pending','approved','paid'))
  share/officer = COALESCE(
       override.officer_share,
       r.officer_share,
       round(r.amount * pct / 100, 2)
     ) / GREATEST(assigned_count, 1)
  pct = revenue_sharing_config[scope].officer_share_percent → fallback 'default' → fallback 10.00
```

### 3.3 Trigger (มีเพียง 1 ตัว)
`service_payments_recalc` — `AFTER INSERT OR UPDATE OR DELETE ON service_payments FOR EACH ROW` → `trg_service_payments_recalc()` → เรียก `recalc_service_record_payment()`
ตั้ง `service_records.paid_amount = SUM(service_payments.amount)` และ `status = 'paid'` ถ้า `paid_amount >= amount`

### 3.4 RLS — สถานะสุดท้าย

| สถานะ | ตาราง |
|---|---|
| **เปิด** | officers, officer_ranks, officer_generations, citizens, vehicles, licenses, service_rates, service_records, duty_logs, announcements, complaints, emergency_reports, officer_leaves, audit_logs, system_settings, department_balances, service_record_officers, revenue_sharing_config, service_record_revenue_overrides, claim_records, payroll_overrides, manual_items |
| **ปิด (0015)** | `work_reports`, `service_payments` — เปิดสิทธิ์เต็ม ใช้ RPC ตรวจสิทธิ์แทน |
| **ไม่เคยเปิด** | `work_report_cases` |

- `current_rank()` ใช้ `auth.uid()` → **คืน NULL เสมอ** เพราะแอปไม่ได้ login ผ่าน Supabase Auth → policy ที่อิง `current_rank()` จะไม่มีวันผ่าน
- ตารางที่เปิดรับ insert จาก public: `complaints` (`with check(true)`), `emergency_reports` (`with check(true)`)
- `audit_logs` insert policy = `auth.uid() is not null` → ในทางปฏิบัติ**บันทึก audit log ได้ทุกคน**
- `manual_items` policies = `using(true) with check(true)` → **ใครก็ insert/update/delete ได้**

### 3.5 Realtime Publication (`supabase_realtime`) — 16 ตาราง
`officers, duty_logs, service_records, emergency_reports, officer_leaves, complaints, announcements, vehicles, citizens, licenses, service_payments, work_reports, work_report_cases, officer_generations, duty_schedules, schedule_overrides`
**ไม่อยู่ใน publication**: service_rates, claim_records, payroll_overrides, manual_items, audit_logs, department_balances, revenue_sharing_config, service_record_officers

### 3.6 Storage — 5 buckets (ทั้งหมด `public = true`)
| Bucket | ใช้ทำอะไร |
|---|---|
| `officer-photos` | รูปเจ้าหน้าที่ |
| `announcements` | รูปประกาศ |
| `evidence` | หลักฐานค่าบริการ / ร้องเรียน / เหตุฉุกเฉิน / รายงานปฏิบัติงาน |
| `vehicles` | รูปรถ / รูปหลักฐานการยึด |
| `manual` | รูปในคู่มือ |

> ⚠️ Migration `0024` **ลบ** เงื่อนไข `auth.uid() is not null` ออกจาก INSERT/UPDATE/DELETE policies → **อัปโหลด/ลบไฟล์ได้จากทุก role รวม anon**
> Path convention (`storage.ts:15`): `` `${folder}/${Date.now()}-${rand}.${ext}` ``

### 3.7 Seed Data

**`officer_ranks`** (0001): commissioner(sort 1), inspector(sort 2), officer(sort 3)
**`officer_generations`** (0027): `รุ่นที่ 1` (key `1`, sort 1, **is_trainee = true**), `รุ่นที่ 2` (sort 2), `รุ่นที่ 3` (sort 3)
**`officers.sort_order`** (0027): backfill 1..N เรียงตาม `lower(name)` — ลำดับนี้ถูกกำหนดโดยหัวหน้ากรมได้ผ่านหน้าจัดการเจ้าหน้าที่
**`system_settings`** (0001): id=1, ทั้ง 2 flag = `true`
**`officers`** (0001): `admin` / `admin1234`, rank=commissioner, department=traffic_management, id `00000000-0000-0000-0000-000000000001`
**`department_balances`** (0007): 5 แผนก balance=0, total_earned=0
**`revenue_sharing_config`** (0008): `default` = 10/90, `vehicle_rescue` = 10/90
**`service_rates`** (0005) — 19 รายการ:

| category | รายการ (rate_key · ชื่อ · ราคา) |
|---|---|
| `vehicle_rescue` (7) | rate_towing_std รถยกลากจูงทั่วไป 2000 · rate_towing_heavy กู้ภัยยกรถอุบัติเหตุ 4000 · rate_impound_release ปลดการยึดรถ 5000 · rate_rescue_water กู้รถตกน้ำ 250 · rate_rescue_lift ยกรถ 150 · rate_rescue_tow ลากรถ 150 · rate_rescue_suspect ลากรถผู้ต้องหา 200 |
| `civil_maintenance` (3) | rate_road_repair ซ่อมผิวจราจร 2500 · rate_street_light เสาไฟ 1500 · rate_traffic_sign ป้าย/ราวกั้น 1200 |
| `electrical` (2) | rate_traffic_signal ตู้ควบคุมสัญญาณ 3500 · rate_power_line เก็บสายไฟ 1800 |
| `traffic_management` (3) | rate_vehicle_inspect ตรวจรถประจำปี 1000 · rate_license_fee ใบขับขี่ 2000 · rate_vehicle_reg จดทะเบียน 2500 |
| `emergency_assistance` (3) | rate_emergency_fuel เติมน้ำมัน 100 · rate_emergency_battery เปลี่ยนแบต 100 · rate_emergency_tire เปลี่ยนยาง 50 |
| `general` (1) | rate_general_doc ค่าเอกสารทั่วไป 500 |

**`manual_items`** (0026): **ไม่มี seed rows** — ตารางว่าง

---

## 4. ฟีเจอร์ฝั่งประชาชน (10 หน้า)

| หน้า | key | สิ่งที่ทำ |
|---|---|---|
| **HomePage** | `home` | Hero + 3 ปุ่มทางลัด · `ServerStatusCard` (poll external API ทุก 60s + กราฟผู้เล่น + history strip 120 ช่อง) · grid บัตรเจ้าหน้าที่ที่กำลังเวร (พร้อมเวลาเข้าเวร) · ประกาศ 5 รายการ (ปักหมุดขึ้นก่อน) · grid 5 แผนก (hard-coded) |
| **CitizenPage** | `citizen` | ค้นหาประชาชน 3 แบบ: **Roblox / Discord / ทะเบียนรถ** · **6 แท็บ**: ข้อมูลรวม · ยานพาหนะ · ใบอนุญาต · ค่าบริการ · ประวัติแจ้งเหตุ · ประวัติร้องเรียน · มียอดค้างชำระ/รถถูกยึด/สถานะใบขับขี่ (หมดอายุ/ใกล้หมดอายุ<30วัน)/ชำระบางส่วน · **Realtime** บน 4 ตาราง |
| **PersonnelPage** | `personnel` | ทำเนียบบุคลากร active · **มุมมองรายการ (List View) เป็นค่าเริ่มต้น** — ตารางกระชับ: รูปเล็ก 40px + ชื่อ + `@username` + ตำแหน่ง + แผนก + **รุ่น** + สถานะเวร (คลิกทั้งแถวเพื่อดูรายละเอียด) · สลับเป็นมุมมองการ์ดเดิมได้ · **"เรียงตาม" 4 แบบ** (ลำดับที่กำหนด / ตำแหน่ง / แผนก / รุ่น) + **"จัดกลุ่ม" 4 แบบ** (ไม่จัดกลุ่ม / ตำแหน่ง / แผนก / รุ่น) · ตัวกรองชิปรุ่น (นับสด) + dropdown แผนก · ค้นหาครอบคลุม ชื่อ / username / ตำแหน่ง / แผนก / **รุ่น** · หัวกลุ่มแบบ Dark & Gold พร้อมป้าย "ทดลองงาน" · สรุปจำนวนคน / กำลังเวร / ทดลองงาน · `OfficerDetailModal` (4 สถิติ + 5 เวร + 5 บริการ + ป้ายรุ่น) |
| **StatsPage** | `stats` | 6 KPI · ภาพรวมประชากร + excluded debt · กราฟชั่วโมงเวร 7 เดือน · Donut สัดส่วนงานรายหมวด · การกระจายกำลังพลรายแผนก · สถิติรายตำแหน่ง · สถิติงานบริการ · Top 5 เจ้าหน้าที่ปฏิบัติงานมากสุด · กิจกรรมล่าสุด 8 รายการ (read-only) |
| **ServiceRatesPublicPage** | `rates` | อัตราค่าบริการ active จัดกลุ่มตาม category พร้อม emoji (read-only) |
| **ComplaintPage** | `complaint` | ฟอร์มร้องเรียนสาธารณะ: discord_username*, officer_name, incident_datetime*, details*(≥20 ตัวอักษร), evidence_url (URL ของ Imgur) · หน้า success + ปุ่มรีเซ็ต/กลับ |
| **EmergencyReportPage** | `emergency` | แจ้งเหตุฉุกเฉิน: เลือกประเภท (อุบัติเหตุ/รถเสีย/ต้องการรถยก/อื่นๆ) · **MapPicker เลือกพิกัด Leaflet** หรือพิมพ์ชื่อสถานที่ · discord_username (ว่าง → `'ไม่ระบุตัวตน'`) · details · อัปโหลดรูป |
| **LeaderboardPage** | `leaderboard` | อันดับ PPS 20 อันดับ · โปเดียม Top-3 + ระดับคะแนน 6 ระดับ (ใช้ `fetchLeaderboard`) |
| **ManualPage** | `manual` | คู่มืออ่าน: **officer 11 บท (~83 หัวข้อ + คู่มือย่อย 13 เมนู)** / **citizen 7 บท 12 หัวข้อ** · TOC แบบ scroll-spy · **officer เท่านั้น**: เพิ่มรายการคู่มือ (title/content/รูป) + ลบรายการ |
| **TermsPage** | `terms` | ข้อกำหนดการใช้งาน 8 หมวด (static ล้วน) |

---

## 5. ฟีเจอร์ฝั่งเจ้าหน้าที่ (16 หน้า)

### 5.1 LoginPage `login`
- Kill-switch: อ่าน `system_settings.login_enabled` → ถ้า false แสดง "ระบบเข้าสู่ระบบถูกปิดชั่วคราว"
- username + password (toggle show/hide) · SHA-256 hash → เทียบกับ `password_hash` · บล็อกถ้า `status` เป็น deleted/suspended

### 5.2 DashboardPage `dashboard` — ทุกเจ้าหน้าที่
4 StatCard (ปฏิบัติหน้าที่ / บริการ+แจ้งเหตุวันนี้ / เหตุฉุกเิมรอดำเนินการ / ยอดค้างชำระ) · กราฟชั่วโมงเวร 7 เดือน · Donut งานรายหมวด · **รายชื่อเจ้าหน้าที่ที่เวร** (ปุ่ม บัตร / ติดต่อด่วน / ออกเวร*) · ประกาศ 4 รายการ · **แผง "สถานะปัจจุบัน"** (สถานะเวร + **สวิตช์ปิด/เปิดระบบล็อกอิน** — commissioner) · บริการล่าสุด 5 รายการ · **แผงจัดการฐานข้อมูล JSON** (ส่งออก / นำเข้า / รีเซ็ต) — JSON mode เท่านั้น
`*` ปุ่ม "ออกเวร" + kill-switch = commissioner เท่านั้น · ทุก action เขียน `audit_logs`

### 5.3 OperationsPage `operations` — หน้าที่ใหญ่ที่สุด (1348 บรรทัด)
**ทุกเจ้าหน้าที่**
- **Clock In / Clock Out** (`duty_logs` + `officers.is_on_duty`)
- ดูบัตรประจำตัว (IdCard + ดาวน์โหลด PNG)
- รายชื่อเจ้าหน้าที่ที่กำลังเวร
- **ตารางประวัติการเข้า-ออกเวร**: เจ้าหน้าที่ · เข้าเวร · ออกเวร · ระยะเวลา · รายงานปฏิบัติงาน · สถานะ · (ลบ*)
- **ฟิลเตอร์**: ค้นหาชื่อ · ช่วงวันที่ (ทั้งหมด/วันนี้/7 วัน/เดือน/กำหนดเอง)
- **ส่งออก CSV** (BOM + CRLF, ชื่อไฟล์ `duty_logs_YYYY-MM-DD.csv`)
- **ฟอร์มรายงานปฏิบัติงาน** (`Modal xl`): หมวดประเภทงาน (patrol/incident/ticket/traffic/rescue/other) · **cases แบบ dynamic** (ชื่อเคส, ประชาชน + datalist, สถานะ completed/in_progress/transferred, รายละเอียด, อัปโหลดหลักฐานรายเคส) · สรุป · ปุ่ม "ยกเลิก / เขียนรายงานภายหลัง / ส่งรายงาน+ออกเวร"
- **เขียนรายงานย้อนหลัง** (สำหรับเวรที่ออกเวรแล้วของตัวเอง)
- **Modal ดูรายงาน** — ดู cases + คลิกชิปชื่อประชาชนเพื่อเปิด profile
- **Realtime** บน duty_logs + work_reports (commissioner เท่านั้น)

**Commissioner เท่านั้น**
- สวิตช์เปิด/ปิดระบบลงเวร (`duty_system_enabled`) — **ปิดแล้วจะบังคับออกเวรเจ้าหน้าที่ทุกคน** + audit `FORCE_CHECKOUT_ALL`
- ปุ่ม "กำหนดเรทขึ้นเวรทุกคน" (`BatchDutyRateModal` — รองรับ วินาที/นาที/ชั่วโมง)
- **2 แผงสถิติเวรอันดับ**: เข้าเวรบ่อยที่สุด / ชั่วโมงสะสมมากที่สุด (สลับ asc/desc)
- บังคับออกเวร (`checkout_method='forced'`) + audit
- ลบ duty log (soft delete + เหตุผล) + audit
- เห็น duty logs / work reports **ของทุกคน** (officer เห็นแค่ของตัวเอง)

### 5.4 ServiceFeesPage `service-fees` — หน้าการเงินหลัก
- **ตาราง**: ประชาชน (แสดงชื่อปัจจุบันผ่าน `citizen_id`) · บริการ · วันที่ · เจ้าหน้าที่ · ยอด · ชำระแล้ว · ค้างชำระ · ประเภท · สถานะ (ชำระแล้ว/บางส่วน/ค้าง) · หลักฐาน
- ฟิลเตอร์: ค้นหา + ชิปสถานะ
- **เพิ่ม/แก้ไขบริการ** (commissioner หรือเจ้าของเคส): เลือกประชาชน → เลือก rate (auto-fill ชื่อ+ราคา) → ชื่อบริการ* · ราคา* · ประเภท (normal/impound) · **เจ้าหน้าที่รับเคส (multi-select, บังคับ ≥1)** · วันที่ · สถานะ · หมายเหตุ · อัปโหลดหลักฐาน
  → save = insert/update → `assign_record_officers` → `calculate_service_revenue`
- **บันทึกการชำระเงิน** (`record_service_payment`, **commissioner เท่านั้น**): เงินต้อง > 0 และ ≤ ยอดคงเหลือ · มีประวัติการชำระ
- **ใบเสร็จ**: เลขที่ `RCPT-<8 ตัวแรกของ record id>-<YYYYMMDDHHmm>` · ข้อมูลครบ + ตราประทับหมุน · **ดาวน์โหลด PNG** วาดด้วย canvas 760×1040 (เลี่ยง `html2canvas` เพราะปัญหา oklch ของ Tailwind v4)
- **ดูใบเสร็จย้อนหลัง** จากประวัติการชำระ (คำนวณยอดสะสม ณ เวลานั้น)
- **ปุ่ม "รับส่วนแบ่ง"** (officer ที่เป็นเจ้าของ/ร่วมรับเคส, เคส paid, ยังไม่เคย claim) → `claim_service_share`
- **Realtime 4 ตาราง + poll ทุก 30 วิ + focus/visibility refresh**

### 5.5 AnnouncementsPage `announcements` — commissioner
CRUD ประกาศ + อัปโหลดรูป + toggle ปักหมุด · **ไม่เขียน audit_logs**

### 5.6 ServiceRatesPage `service-rates` — commissioner
- จัดการอัตราค่าบริการ (CRUD + toggle เปิด/ปิดใช้งาน)
- **"เพิ่มรายการมาตรฐาน"** — โหลดจาก `seed.ts` เฉพาะชื่อที่ยังไม่มี
- **เพิ่มหมวดหมู่ใหม่** — select มี option `➕ กำหนดหมวดหมู่อื่นๆ...`
- **export `SERVICE_CATEGORIES`** จากไฟล์นี้ (ถูก import โดย ServiceFeesPage + CitizenManagementPage — coupling ผิดปกติ)
- **ไม่เขียน audit_logs**

### 5.7 OfficerManagementPage `officer-management` — commissioner
- **จัดการตำแหน่ง**: chips + เพิ่ม/แก้/ลบ rank (ลบ rank sort_order 1 หรือ key `commissioner` ไม่ได้)
- **จัดการรุ่น (Generation)**: chips (แสดงจำนวนคนต่อรุ่น + ป้าย "ทดลองงาน") + ฟอร์มเพิ่ม/แก้/ลบ (label, generation_key, sort_order, is_trainee) · ลบรุ่นจะเตือนจำนวนเจ้าหน้าที่ที่ยังผูกกับรุ่นนั้น
- **จัดลำดับรายชื่อ (sort_order)**:
  - **ลาก & วาง** ด้วยไอคอนจับ (GripVertical) ที่คอลัมน์ซ้ายสุด — แถวที่ลากจะจาง แถวเป้าหมายจะมีเส้นทองด้านบน/ล่างตามครึ่งที่ชี้
  - **ปุ่มเลื่อนขึ้น/ลง** (ChevronUp/Down) เป็นทางเลือกแบบไม่ต้องลาก
  - บันทึกลง `officers.sort_order` อัตโนมัติทุกครั้ง (optimistic + เขียนเฉพาะแถวที่ค่าเปลี่ยน; ผิดพลาดจะย้อนกลับค่าเดิม)
  - **จัดลำดับใหม่ 1..N** — ปุ่มเขียน `sort_order` ใหม่ทั้งหมดให้ต่อเนื่องตามลำดับปัจจุบัน
  - หากมีตัวกรอง (ค้นหา/รุ่น/แผนก) **เฉพาะแถวที่เห็นถูกสลับตำแหน่ง** — เจ้าหน้าที่ที่ถูกกรองออกไม่ถูกแตะ
- **Toolbar**: ค้นหา (ชื่อ/username/ตำแหน่ง/แผนก/รุ่น) + "เรียงตาม" (ลำดับที่กำหนด/ตำแหน่ง/แผนก/รุ่น) + ตัวกรองรุ่น + ตัวกรองแผนก
- **ตารางเจ้าหน้าที่**: จับลาก · ลำดับ + ปุ่มเลื่อน · รูป+ชื่อ+@username (ทำเครื่องหมาย "คุณ") · ตำแหน่ง · แผนก + เรทขึ้นเวร · **รุ่น** · สถานะ · เวร · จัดการ
- **การกระทำต่อแถว**: ประวัติ (`OfficerHistoryModal`) · แก้ไข · **รีเซ็ตรหัสผ่าน** · ระงับ/เปิด · ลบ (soft delete + audit; ห้ามลบตัวเอง)
- **ฟอร์มเพิ่ม/แก้ไข**: อัปโหลดรูป · ชื่อ* · Username* · รหัสผ่าน · ตำแหน่ง · แผนก · **รุ่น** · **ลำดับการแสดงผล** · **อัตราค่าขึ้นเวร (BC/ชม.)** + preset chips [100…1000]
- **Wizard 3 ขั้น**: เลือกต้นแบบ (copy rank/dept/duty_rate/service_category/รุ่น) → ข้อมูลส่วนตัว (บังคับครบก่อนไปต่อ) → ตรวจสอบ/แก้ไขก่อนบันทึก (มีตัวเลือกรุ่น; `sort_order` = max+1 อัตโนมัติ)

### 5.8 CitizenManagementPage `citizen-management` — commissioner (1646 บรรทัด)
- **แดชบอร์ดหนี้ค้างชำระ** (ยุบ/ขยายได้): ฟิลเตอร์สถานะ/วันที่เริ่ม/สิ้นสุด/การเรียงลำดับ (ยอดมาก-น้อย / น้อย-มาก / ค้างนาน / ใช้บริการมาก)
- **ตารางจัดอันดับหนี้**: ลำดับ · ประชาชน (คลิกเพื่อเลือก) · สถานะ · ยอดค้าง · ค้างนาน (วัน) · จำนวนรายการ · ดูประวัติ
- **แถบกระทบยอด**: ยอดในตาราง vs ยอด Dashboard vs **"ไม่ผูกประชาชน N รายการ"**
- **รายการประชาชน** + ชิปกรองสถานะ (นับสด) + **4 แท็บรายละเอียด**:
  - **ข้อมูลรวม** — สถานะ · สถานะใบขับขี่ (parse จาก notes `[BIT_DB_IMPORT]`) · 3 สถิติ · แก้ไข/ลบ
  - **ยานพาหนะ** — ยึด/ทะเบียน/หมดอายุจาก BIT notes · เหตุผล+สถานที่ยึด · แก้ไข/ลบ
  - **ใบอนุญาต** — ประเภท · เลขที่ · ออก/หมดอายุ · สถานะ · แก้ไข/ลบ
  - **ค่าบริการ** — 3 สรุปยอด · รายการพร้อม **คลิกสลับสถานะชำระ** · หลักฐาน · แก้ไข/ลบ
- **ฟอร์มรถ**: ทะเบียน* · ยี่ห้อ (22 แบรนด์ใน `VEHICLE_BRAND_MODELS`) · รุ่น · ประเภท · หมวดหมู่รถ · สี (20 สีใน `VEHICLE_COLORS`) · เจ้าของ · checkbox ยึดรถ (เผย เหตุผล + สถานที่เก็บ)
- **ฟอร์มค่าบริการ**: rate → ชื่อ · ราคา · ประเภท · เจ้าหน้าที่รับเคส (ไม่บังคับ) · วันที่ · **ยอดชำระแล้ว → สถานะ auto** · หมายเหตุ · หลักฐาน
- **Realtime**: 3 ตารางหลัก + 3 channel ต่อประชาชนที่เลือก (filter `citizen_id=eq.<id>`)

### 5.9 ComplaintsManagementPage `complaints` — commissioner
- 5 StatCard ที่ทำหน้าที่เป็นตัวกรองพร้อมกัน · ค้นหา · ตาราง (ผู้ร้อง/เจ้าหน้าที่ที่ถูกร้องเรียน/วันที่/สถานะ)
- **Modal รายละเอียด** + 3 ปุ่มเปลี่ยนสถานะ: กำลังตรวจสอบ / ดำเนินการแล้ว / ยกเลิก (ปิดเมื่อเป็นสถานะนั้นแล้ว) + audit

### 5.10 EmergencyManagementPage `emergency` — ทุกเจ้าหน้าที่ (ลบ = commissioner)
- ชิปกรองสถานะ + badge "N เหตุรอดำเนินการ"
- **การ์ด**: รูปหลักฐาน · ประเภท · เวลา · สถานะ · **แผนที่ย่อ 64×40** · ผู้แจ้ง · รายละเอียด
- ปุ่ม: ดู / รับเรื่อง (pending) / เสร็จสิ้น (responding) / ยกเลิก / ลบ*
- **Modal รายละเอียด**: **แก้ไขพิกัด** (เปิด MapPicker ใหม่) · **เปลี่ยนผู้ดูแลเคส** · เปลี่ยนสถานะ + audit ทุกครั้ง
- `location` เก็บเป็น JSON `{map:{lat,lng,zoom}, label}` หรือ string ธรรมดา — ต้อง parse ทั้ง 2 แบบ

### 5.11 VehicleManagementPage `vehicles` — ทุกเจ้าหน้าที่ (ลบ = commissioner)
- ค้นหา/กรอง (ถูกยึด/ปกติ) · การ์ดพร้อมข้อมูล BIT · รูปหลักฐานการยึด
- **เพิ่มรถ**: ทะเบียน* · ประเภท · เจ้าของ · สี (free text) · หมายเหตุ
- **ยึดรถ**: เหตุผล* + สถานที่เก็บ* (ปุ่มบันทึก disabled จนกว่าจะครบ) · อัปโหลดรูป + audit
- **ปล่อยรถ** + audit (**ไม่ล้างข้อมูลยึด** เพื่อเก็บประวัติ)
- **ลบ** = hard delete + ลบรูป + audit

### 5.12 LeaveManagementPage `leave` — ทุกเจ้าหน้าที่ (อนุมัติ = commissioner)
- 5 StatCard · ค้นหา + กรองสถานะ/ประเภท · **Realtime** บน `officer_leaves`
- **การ์ด**: ประเภท (6 แบบ: sick/personal/vacation/maternity/ordained/other) · ช่วงวันที่ + จำนวนวัน · เหตุผล · ผู้พิจารณา
- **ฟอร์มขอลา**: ประเภท · วันที่เริ่ม/สิ้น · **จำนวนวันลาแบบ live** · เหตุผล
- **อนุมัติ/ไม่อนุมัติ** (commissioner) พร้อมหมายเหตุการพิจารณา
- **แก้ไข/ยกเลิก/ลบ** (เจ้าของหรือ commissioner, เฉพาะสถานะ pending)
- **ไม่เขียน audit_logs** และไม่มีการตรวจชนกับเวร

### 5.13 MyPointsPage `my-points` — ทุกเจ้าหน้าที่ (read-only)
Hero: งวดปัจจุบัน · คะแนน · ระดับ · progress bar สู่ระดับถัดไป · **ประวัติคะแนน** (delta, เหตุผล, ผู้ให้, คงเหลือ)

### 5.14 PointsManagementPage `points-management` — commissioner
- รายชื่อเรียงตามคะแนน + ค้นหา
- **รีเซ็ตประจำเดือน** (`resetMonthlyPeriod`) — เจ้าหน้าที่ทุกคนที่ยังอยู่งวดเก่าถูก zero + บันทึก log การหัก
- **Modal แก้คะแนน 3 แท็บ**:
  - **เพิ่มคะแนน** — preset 10 รายการ (+5 ถึง +30)
  - **หักคะแนน** — preset 12 รายการ (−5 ถึง −100)
  - **กำหนดเอง** — เลือกให้/ลบ + จำนวน + เหตุผล
  - **พรีวิวผล** คะแนนใหม่ + ระดับ + จุดกระแสกระดัก
  - **ประวัติ 20 รายการล่าสุด + ลบรายการ** (ย้อนคะแนนกลับ)

### 5.15 DepartmentBalancePage `department-balance` — commissioner (1188 บรรทัด)
**การ์ดภาพรวมทางการเงิน 4 ใบ**: ยอดชำระจริง (จากเคส paid) · งบเติมพิเศษ/RP · จ่ายเงินเดือนสะสม · **งบกองกลางคงเหลือสุทธิ**

**แท็บ 1 `payroll` — จ่ายเงินเดือนประจำงวด**
- เลือกงวด · **สวิตช์ Auto/Manual** (ปิด Manual = ล้าง override ทั้งหมด)
- ชิตลัด: เรทเฉลี่ย + `[ตั้งเรททุกคน]` · สัดส่วน % + `[เปลี่ยน %]`
- **ตารางเงินเดือน**: ค่าขึ้นเวร (ชม. × เรท/ชม.) + ส่วนแบ่งเคส (ตาม % จาก `revenue_sharing_config`) + โบนัส + **ยอดสุทธิ**
  - Auto = คำนวณอัตโนมัติ (โบนัสยังแก้ได้แต่ **ไม่ถูก persist**)
  - Manual = ทุกช่องเป็น input → `upsertPayrollOverride` ทันที
- **อนุมัติจ่าย** (commissioner): เช็คงบพอไหม → `recordPayrollSnapshot` + **จ่าย claim ที่ approved ทั้งหมด** (claim ที่ pending ปล่อยไปงวดหน้า)
- แบนเนอร์งบไม่พอ + ปุ่ม "เติมงบเพิ่มทันที"

**แท็บ 2 `history` — ประวัติการจ่ายเงินเดือน**
- เลือกงวด + ค้นหา · การ์ดสรุป snapshot (ผู้อนุมัติ · เวลา · ยอดรวม · จำนวนคน)
- **ตารางแจกแจงรายคน** พร้อมสูตรที่ใช้
- **ตารางประวัติงบเติมพิเศษ**: เวลา · แผนกเป้าหมาย · เหตุผล · ผู้เติม · จำนวนเงิน
- ⚠️ **เก็บใน localStorage เท่านั้น** (`dot_payroll_snapshots`, `dot_manual_budget_injections`) → ประวัติการเงินเป็นรายเบราว์เซอร์

**แท็บ 3 `departments`** — งบประมาณ/รายรับ 5 แผนก (อัตโนมัติ + เติมพิเศษ = งบรวม)

**แท็บ 4 `claims`** — `<ClaimApprovalTable>` โดยมี 3 การ์ด (รออนุมัติ / อนุมัติแล้วรอจ่าย / ยอดสะสมรอจ่ายทุกคน) · กรอง scope · อนุมัติ / ปฏิเสธ (ต้องใส่เหตุผล) / จ่ายแล้ว

**Modal**: InjectBudgetModal (preset 5k–100k), BatchDutyRateModal, ShareConfigModal (preset 10–50%)
⚠️ `ShareConfigModal` **เขียน % เดียวกันให้ทั้ง `default` และ `vehicle_rescue`** → 2 scope นี้แยกจากกันไม่ได้ผ่าน UI

---

## 6. คอมโพเนนต์กลาง

| คอมโพเนนต์ | หน้าที่ |
|---|---|
| `Modal` | overlay dialog — sizes: `sm / md / lg / xl`; ปิดด้วย Escape / คลิกพื้นหลัง; scroll ในตัว |
| `ConfirmDialog` | ยืนยัน + `extraField` (ใช้กับเหตุผลการลบ / รหัสผ่านใหม่) + `danger` |
| `Badge` | 5 variants: `success / danger / warning / info / neutral` |
| `PageHeader` | banner หัวหน้าหน้า + slot `actions` |
| `GoldBarChart` / `DonutChart` | กราฟ SVG เขียนเอง ไม่ใช้ recharts |
| `IdCard` | บัตร 3:4 + ดาวน์โหลด PNG (html2canvas scale:2, useCORS) + ปุ่มบังคับออกเวร (commissioner) |
| `MapPicker` / `MapPreview` | Leaflet + CRS.Simple + `erlc-tools.com` summer tiles, bounds `[0,0]–[29700,29700]`, zoom 1–5, pin แบบ SVG |
| `ServerStatusCard` | poll `https://bitnewsth.qd.je/api/public/server-status` + `/history?range=` ทุก 60 วิ + กราฟผู้เล่น SVG + history strip 120 ช่อง |
| `BatchDutyRateModal` | ตั้ง `duty_rate` ทุกคน — หน่วย วินาที/นาที/ชั่วโมง → normalize เป็น **BC/ชั่วโมง** ก่อนบันทึก |
| `ClaimApprovalTable` | workflow อนุมัติ/ปฏิเสธ/จ่าย claim (commissioner) |
| `ClaimShareModal` | เลือกงวด + scope → preview → ส่ง claim (officer) |
| `OfficerHistoryModal` | 7 สถิติ + แผง claim + ตารางรายได้รายเดือน (แก้ไข inline ได้) + 3 แท็บ (เวร / ค่าบริการ / การลา) |
| `MotionWrappers` | FadeIn, Stagger, StaggerItem, TabTransition, Skeleton, CountUp |

---

## 7. Data Layer — `src/lib/api/` (19 ไฟล์)

> ⚠️ **ข้อสำคัญ**: TanStack Query hooks ในโฟลเดอร์นี้ **ถูกเขียนไว้แต่แทบไม่ถูกใช้งานจริง**
> หน้าเกือบทั้งหมด query `supabase` ตรง ๆ · มีแค่ `points.ts` ที่ถูก import จริง

| ไฟล์ | Export | ใช้จริง? |
|---|---|---|
| `officers.ts` | useOfficers, useOnDutyOfficers, useOfficer, useCreateOfficer, useUpdateOfficer, useDeleteOfficer (soft) | ❌ |
| `dutyLogs.ts` | useDutyLogs, useActiveDutyLog, useClockIn, useClockOut, useDeleteDutyLog (soft) | ❌ |
| `serviceRecords.ts` | useServiceRecords, useCreate/Update/Delete | ❌ |
| `serviceRates.ts` | useServiceRates, useCreate/Update/Delete | ❌ |
| `vehicles.ts` | useVehicles, useVehicleByPlate, useCreate/Update, useImpoundVehicle, useReleaseVehicle | ❌ |
| `citizens.ts` | useCitizens, useCitizen, useCreateCitizen, useUpdateCitizen (**ไม่มี delete**) | ❌ |
| `licenses.ts` | useLicenses, useCreateLicense, useUpdateLicense (**ไม่มี delete**) | ❌ |
| `announcements.ts` | useAnnouncements, useCreate/Update/Delete | ❌ |
| `complaints.ts` | useComplaints, useCreateComplaint, useUpdateComplaintStatus | ❌ |
| `emergencyReports.ts` | useEmergencyReports, useCreateEmergencyReport, useRespondEmergency, useResolveEmergency (**ไม่มี dismiss**) | ❌ |
| `officerLeaves.ts` | useOfficerLeaves, useCreateLeave, useReviewLeave | ❌ |
| `systemSettings.ts` | useSystemSettings, useUpdateSystemSettings | ❌ |
| `auditLogs.ts` | useLogAudit, useAuditLogs | ❌ |
| `auth.ts` | useLogin, useOfficerById | ❌ (LoginPage เขียนเอง) |
| `claimShare.ts` | previewClaimShare (มี client-side fallback), submitClaim, approveClaim, rejectClaim, markClaimPaid, fetchOfficerClaims, fetchPendingClaims, fetchApprovedClaims, translateClaimError | ✅ |
| `revenueSharing.ts` | getScopeForCategory, fetchRevenueConfigs, updateRevenueConfig, fetchRecordOfficers, assignRecordOfficers, fetchAssignedOfficerIds, fetchAssignedOfficerNames, fetchRevenueOverrides, upsertRevenueOverride, deleteRevenueOverride, calculateShares, getEffectiveShares, recalculateRecord | ✅ |
| `points.ts` | fetchLeaderboard, addOfficerPoints, deleteOfficerPointsLog, resetMonthlyPeriod | ✅ |
| `payrollEngine.ts` | ManualBudgetInjection / OfficerPayrollItem / PayrollSnapshot / FinancialOverview + getLocalManualInjections, addManualBudgetInjection, getLocalPayrollSnapshots, recordPayrollSnapshot, getLocalPayrollOverrides, upsertPayrollOverride, clearPayrollOverrides, computeFinancialOverview, calculateActivePeriodPayroll | ✅ |
| `officerStats.ts` | getMonthKey, computeMonthlyIncome, loadOverrides, saveOverride (localStorage `income_override:<officerId>`) | ✅ |

---

## 8. JSON Mode (`src/lib/jsonDb.ts`) — จำลอง PostgREST

**localStorage keys**: `dot_system_db_v1` (ทั้ง DB) · `dot_system_files_v1` (ไฟล์เป็น dataURL) · `dot_system_notify_v1` (cross-tab beacon)

**Collections**: system_settings, officer_ranks, **officer_generations**, officers, citizens, vehicles, licenses, service_rates, service_records, duty_logs, announcements, complaints, emergency_reports, officer_leaves, audit_logs + (lazy create) service_record_officers, service_record_revenue_overrides, claim_records, revenue_sharing_config, service_payments, work_reports, work_report_cases, payroll_overrides

**จุดต่างจาก Supabase จริงที่ต้องระวัง**
| เรื่อง | พฤติกรรมใน JSON mode |
|---|---|
| `.update().select().single()` | **คืน error `No rows found`** — เพราะ update/delete คืน `data: null` |
| `.like()` | ทำงานเหมือน `ilike()` (ไม่แยก case) |
| `gt/gte/lt/lte` | เทียบเป็น **string** |
| `.or()` | รองรับแค่ `eq/neq/ilike/is`; ค่าที่มี `,` จะพัง |
| joins | **ไม่รองรับ** — ต้อง query แยกแล้ว join ในโค้ด |
| upload | จำกัด **base64 ≤ 2,000,000 ตัวอักษร** (~1.5 MB ไฟล์จริง) และไม่มี `.auth` |
| seed | มีเฉพาะ admin + 19 service_rates + 3 officer_ranks + **3 officer_generations** — **ตารางอื่นว่างหมด** |
| **DB default** | JSON mode **ไม่มี column default** — `sort_order` ต้องส่งมาเองเสมอ (ใช้ `nextSortOrder()`) |
| `jsonDbImport` | **ไม่เรียก notify** → query ที่เปิดอยู่ในแท็บเดิมยังเห็นข้อมูลเก่าจนกว่าจะ refetch |

**RPC mocks 16 ตัว** (ต้องตรงกับ SQL): `assign_record_officers`, `list_service_record_officers`, `calculate_service_revenue`, `record_service_payment`, `preview_claim_share`, `claim_service_share`, `approve_claim`, `reject_claim`, `mark_claim_paid`, `list_claims_for_officer`, `list_claims_for_commissioner`, `create_work_report_with_cases`, `get_work_report_cases`
**Backup/Restore**: `jsonDbExport()` · `jsonDbImport(file)` · `jsonDbReset()` (ล้างเหลือแค่ admin)

---

## 9. localStorage Keys (ทั้งหมด)

| Key | เจ้าของ | เก็บอะไร |
|---|---|---|
| `dot_officer` | AuthContext | Officer session (รวม `password_hash`) |
| `dot_access_token` | AuthContext | access token |
| `*-auth-token` | Supabase SDK | session ของ Supabase (ถ้ามี) |
| `dot_revenue_sharing_config` | revenueSharing.ts | cache/fallback ของ RevenueConfig[] (เขียนก่อนลอง DB) |
| `dot_manual_budget_injections` | payrollEngine.ts | **ประวัติงบเติมพิเศษ (รายเบราว์เซอร์)** |
| `dot_payroll_snapshots` | payrollEngine.ts | **ประวัติจ่ายเงินเดือน (รายเบราว์เซอร์)** |
| `income_override:<officerId>` | officerStats.ts | ยอดรายได้ที่แก้ไขเองรายเดือน |
| `dot_system_db_v1` | jsonDb.ts | mock DB ทั้งหมด |
| `dot_system_files_v1` | jsonDb.ts | ไฟล์ที่อัปโหลด (dataURL) |
| `dot_system_notify_v1` | jsonDb.ts | cross-tab ping |

---

## 10. สูตร / กฎทางธุรกิจ

### 10.1 หนี้ค้างชำระ (`src/lib/citizenDebt.ts` — ใช้ร่วมกันทุกหน้า)
```
getRemainingDebt(rec)  = rec.status === 'paid' ? 0 : max(0, amount - paid_amount)

isDebtExcludedStatus(s) = s === 'banned' || s === 'suspended'
→ หนี้ของประชาชนที่ถูกแบน/ระงับสิทธิ์ = **ไม่ถูกนับ** ทั้งรายได้รวมและยอดค้าง

calculateRevenueAndDebtSummary():
  paidTotal     = Σ (paid เต็ม) + Σ (partial ที่ชำระแล้ว)
  unpaidTotal   = Σ remaining ของรายการที่ "ชอบธรรม"
  totalRevenue  = paidTotal + unpaidTotal
  excludedDebt* = หนี้ของ banned/suspended (แสดงแยกใน StatsPage)
  isRecordDebtExcluded: ผูกด้วย citizen_id → fallback roblox_username (trim + lowercase)
```

### 10.2 สัดส่วนรายได้ (`revenueSharing.ts` + SQL)
```
scope = (category === 'vehicle_rescue') ? 'vehicle_rescue' : 'default'   -- binary
officer_share = round2(amount * officer_share_percent / 100)
central_share = round2(amount - officer_share)
per_officer   = (override ?? officer_share) / max(1, assigned_officer_count)
ตั้งต้น: default 10/90 · vehicle_rescue 10/90
```

### 10.3 PPS — ระบบคะแนนสะสม
- เก็บใน `officers.points` (0–100000, CHECK) + `points_period` (`YYYY-MM`) + `points_log` (jsonb array)
- `points_log` entry: `{at, by, by_name, delta, reason, balance_after, period}`
- **รางวัล 10 รายการ**: +5 … +30 · **โทษ 12 รายการ**: −5 … −100
- **6 ระดับ**: ต้องปรับปรุง (0–99) · ผ่านเกณฑ์ (100–249) · ดี (250–499) · ดีมาก (500–799) · ดีเด่น (800–999) · เจ้าหน้าที่ดีเด่น (1000+)
- การเพิ่ม/ลบ/รีเซ็ตเป็น **read-modify-write ฝั่ง client ไม่ transactional**
- `resetMonthlyPeriod` = ทุกคนที่ยังอยู่งวดเก่า → points = 0 + period ใหม่ + log การหัก

### 10.4 เวร (`dutyStats.ts`)
- `duty_rate` เก็บเป็น **BC ต่อชั่วโมง**
- `duration_minutes` คำนวณตอน checkout = `round((now - clock_in) / 60000)`
- `buildMonthlyDutyHours(logs, 7)` → ชั่วโมงรวม 7 เดือนล่าสุด (ข้าม `deleted_at`)
- `buildWorkloadByCategory(records)` → จำนวนรายการรายหมวด (default `general`)

### 10.5 เงินเดือน (`payrollEngine.ts`)
```
ค่าขึ้นเวร   = (ชั่วโมงที่เวรในงวด) × duty_rate
ส่วนแบ่งเคส = paid service share ของ officer ในงวด  (ตาม % จาก revenue_sharing_config)
โบนัส      = customBonus (React state — auto mode ไม่ persist)
ยอดสุทธิ   = duty + service + bonus
งบคงเหลือ = autoPaidRevenue + manualInjectedBudget − totalPaidOutPayroll
```

### 10.6 การเรียง/จัดกลุ่มบุคลากร (`src/lib/personnelOrder.ts` — migration 0027)
ใช้ร่วมกัน 2 หน้า ทำให้สูตรตรงกันเสมอ

**tie-breaker ตามลำดับ**: `sort_order` → ตำแหน่ง → แผนก → รุ่น → ชื่อ (ไทย, a→z)

```
โหมด "เรียงตาม":
  manual      = sort_order → ตำแหน่ง → แผนก → รุ่น → ชื่อ   (default — ตามที่หัวหน้ากรมจัด)
  rank        = ตำแหน่ง → sort_order → แผนก → รุ่น → ชื่อ
  department  = แผนก → ตำแหน่ง → sort_order → รุ่น → ชื่อ
  generation  = รุ่น → ตำแหน่ง → แผนก → sort_order → ชื่อ

โหมด "จัดกลุ่ม": none | rank | department | generation
  - ลำดับกลุ่มเรียงตาม sort_order ของอ้างอิงนั้น และ "ไม่ระบุรุ่น" อยู่ท้ายสุดเสมอ

ป้าย:
  ตำแหน่ง  = officer_ranks.label → RANK_LABELS → ค่าดิบ
  แผนก     = DEPARTMENT_LABELS → ค่าดิบ
  รุ่น      = officer_generations.label → GENERATION_FALLBACK_LABELS → `รุ่นที่ {key}`
             ค่าว่าง/null → "ไม่ระบุรุ่น"
  is_trainee = officer_generations.is_trainee (รุ่นที่ 1 เป็นทดลองงานตาม seed)

`sort_order` = ลำดับที่หัวหน้ากรมกำหนด (1..N) · เจ้าหน้าที่ใหม่ได้ max+1 อัตโนมัติ
```

---

## 11. ⚠️ ข้อควรระวัง / สิ่งที่ยังเป็น Stub (ห้ามคิดว่าเป็นฟีเจอร์ที่ใช้งานได้แล้ว)

**คอมโพเนนต์ที่ไม่ถูกใช้ (DEAD CODE)**
1. `RankedList.tsx` — ไม่มีหน้าไหน render; OperationsPage import แค่ type `RankItem` แล้วเขียน markup เอง (เสีย pagination)
2. `layout/RoleGuard.tsx` — ไม่ถูกใช้เลย (ทุกหน้าเช็ค `useAuth().isCommissioner` เอง)
3. `error-boundary.tsx` — **ไม่ได้ mount** → error ในหน้าใดจะทำให้แอปขาวทั้งแอป
4. `animations/PageTransition.tsx` — ผูกกับ `wouter` ที่ไม่ได้ใช้
5. `pages/not-found.tsx` — ไม่มี router จึงไม่มีทางถูกเรียก
6. `lib/realtime/useRealtimeSubscription.ts` — ทุกหน้าเปิด channel ตรง ๆ เอง
7. ทุก TanStack Query hook ใน `lib/api/` — รวมถึง `useLogin`

**โค้ดซ้ำ / ขัดแย้ง**
8. `OfficerManagementPage` มี `BatchDutyRateModal` **local ที่ shadow component กลาง** → หน้านี้ใช้ได้แค่หน่วย "ชั่วโมง"
9. helper parse BIT notes ถูก copy ไป 2 ที่ (`CitizenManagementPage`, `VehicleManagementPage`)
10. `ServiceRatesPage` export `SERVICE_CATEGORIES` (มีแยกอีกชุดใน `types.ts` ที่มีแค่ `{value,label}`) → page import จาก page
11. `SERVICE_CATEGORIES` ซ้ำ 3 ชุด: `types.ts:66` (value+label), `ServiceRatesPage.tsx:9` (label+icon), `ServiceRatesPublicPage.tsx` (CATEGORY_LABELS + CATEGORY_ICONS)
12. `VehicleManagementPage.tsx:15` มี `VEHICLE_TYPES` local ซ้ำกับ `VEHICLE_TYPE_LABELS` ใน `types.ts`
13. `OfficerStats.OFFICER_SHARE_PERCENT = 0.10` (hard-coded) แยกจาก `revenue_sharing_config`

**Validation เงียบ (no user feedback)**
14. `OperationsPage.submitWorkReport` — ถ้าทั้ง summary และ cases ว่าง จะ return เงียบ ๆ
15. `LeaveManagementPage.handleSubmit` — ถ้า `end_date < start_date` return เงียบ ๆ
16. `EmergencyReportPage.handleSubmit` — ถ้าไม่มี pin และไม่มีชื่อสถานที่ return เงียบ ๆ
17. `CitizenPage.handleSearch` — query ว่าง return เงียบ ๆ

**Feedback ที่หายไป**
18. **`<Toaster />` ไม่เคยถูก mount** → `toast()` ทุกครั้งใน `ServiceFeesPage` (ผล claim สำเร็จ/ไม่มีเคส/ผิดพลาด) **มองไม่เห็น**
19. ใช้ `alert()` เป็นช่องทาง error หลักใน: OfficerManagementPage (ทุก CRUD), BatchDutyRateModal (×2 ตัว), PointsManagementPage (×4), DepartmentBalancePage (ทุก sub-modal), ManualPage, AnnouncementsPage
20. ใช้ `confirm()` แบบ native ใน: ลบตำแหน่ง, ลบ log คะแนน, รีเซ็ตคะแนนเดือน, จ่าย claim, อนุมัติเงินเดือน, export CSV

**Data model ไม่ตรงกัน**
21. **สถานะร้องเรียน**: หน้าเจ้าหน้าที่เขียน `reviewing` แต่ CitizenPage/StatsPage กรอง `investigating` (ไม่มีที่ไหนเขียนค่านี้) และ DB CHECK อนุญาต `pending/reviewing/resolved/dismissed`
22. `ComplaintPage` เขียนแค่ 5 คอลัมน์ (ไม่มี `category`, `description`, `complainant_name`) แต่ `CitizenPage` render `c.category` + `c.description`
23. `ComplaintsManagementPage` ประกาศ interface `Complaint` ของตัวเอง (คนละชุดกับ `types.ts`)
24. `CitizenStatus` มี `banned` ใน TS แต่ **DB CHECK ไม่มี**
25. `audit_logs`: `types.ts` ใช้ `performed_by/performed_by_name` แต่ `payrollEngine.ts` เขียน `actor_id/actor_name/actor_rank` → schema mismatch
26. `EmergencyManagementPage` ลบ report แล้ว audit **ไม่มี `target_type`** (ต่างจากที่อื่น)
27. `PayrollOverrides` map key ใน UI ใช้ `${officer_id}_${period_month}` แต่ PK ใน DB เป็นคู่ `(officer_id, period_month)`

**สิทธิ์ที่ออกแบบไว้แต่ไม่เปิดใช้**
28. `CitizenManagementPage` มี logic `canManageCitizen = isCommissioner || rank === 'inspector'` แต่ `App.tsx:94` บล็อก inspector ออกจากหน้านี้ → **dead logic**
29. `App.tsx:69` `commissionerOnlyPages` **ไม่รวม** `points-management` และ `department-balance` (แต่ JSX guard ครอบไว้) — ผลคือ AccessDenied ไม่แสดง ถูก redirect ไป dashboard แทน
30. Migration 0017 auth bridge (`get_current_officer` ฯลฯ) สร้างไว้แต่ **ไม่มีโค้ด client เรียกใช้**
31. `officer_generations` (0027) ใช้ `for select using (true)` เพื่อให้หน้าทำเนียบบุคลากร (หน้าสาธารณะ) อ่านได้ — ข้อมูลเป็น label อย่างเดียว แต่ก็ยังเปิดอ่านให้ `anon` เช่นเดียวกับ `manual_items`

**ความคงข้อมูล / การเก็บข้อมูล**
31. **ประวัติเงินเดือน + งบเติมพิเศษเก็บใน localStorage** → ไม่ซิงก์ข้ามเครื่อง, หายเมื่อล้าง storage, ถูกลบเมื่อ jsonDbReset
32. **โบนัสใน auto mode ไม่ถูก persist** แต่ถูกรวมใน snapshot ที่อนุมัติแล้ว
33. การลบต่างกัน: officer = **soft** · duty_log = **soft** · vehicle = **hard** · service_record = **hard** · announcement = **hard**
34. `assign_record_officers` เป็น **full replace** — ถ้าเรียกซ้ำโดยไม่ส่ง ids ครบจะลบ assignment เดิมทั้งหมด
35. Points / work reports ใช้ read-modify-write ฝั่ง client → ข้อมูลหายได้เมื่อมีการเขียนพร้อมกัน
36. `postpaid` logic: `status='paid'` แต่ `paid_amount < amount` → **ถือว่าไม่มีหนี้** (getRemainingDebt คืน 0)
37. **การจัดลำดับเจ้าหน้าที่ (0027) เขียน `sort_order` ทีละแถวด้วย `Promise.all`** — ไม่ atomic ถ้าผิดพลาดกลางคันจะเหลือบางแถวอัปเดตแล้ว (โค้ดย้อน state กลับ แต่ข้อมูลใน DB อาจไม่ตรง)
38. **ลบ `officer_generations` ไม่ได้ลบข้อมูลใน `officers.generation`** — officer ที่ผูกกับรุ่นนั้นจะยังคงมี key เดิม และแสดงเป็น `รุ่นที่ {key}` (ไม่ใช่ label เดิม)

**ฟีเจอร์ที่ UI มีแต่ทำงานเหมือนกัน / ไม่มีจริง**
37. ปุ่ม "ติดต่อด่วน" ใน DashboardPage เรียกฟังก์ชันเดียวกับปุ่ม "บัตร" → **ไม่มีฟีเจอร์ติดต่อ**
38. ปุ่มตา (eye) ใน ComplaintsManagementPage **ไม่มี onClick** → ปุ่มตาย
39. `KpiCard` รับ props `trend` / `trendLabel` แต่ไม่เคย render
40. ManualPage มี anchor ซ่อนไป Canva ด้วย `<ExternalLink size={0}/>`
41. ไม่มีการตรวจหนี้วันลาชนกับตารางเวร
42. ไม่มีการตรวจอนุญาตชนกับ work reports ของคนอื่น
43. การจัดลำดับเจ้าหน้าที่ (Drag & Drop / ปุ่มขึ้น-ลง) **ใช้งานได้เฉพาะผู้ที่เปิดหน้าจัดการเจ้าหน้าที่** (= commissioner) และ **ไม่มี audit log** สำหรับการจัดลำดับใหม่

---

## 12. Invariants — กฎที่ต้องรักษาเมื่อแก้โค้ด

1. **ทุกฟีเจอร์ที่เขียนต้องทำงานได้ทั้ง 2 โหมด** — ถ้าเพิ่ม RPC ต้องเพิ่ม mock ใน `jsonDb.ts` ด้วย และต้อง fallback เมื่อ RPC ไม่มี
2. **สูตรทางธุรกิจต้องตรงกัน 3 ที่**: SQL RPC ↔ `jsonDb.ts` mock ↔ `src/lib/api/*.ts` fallback
3. **service_records ที่แก้ไขต้องเรียก `assignRecordOfficers` + `recalculateRecord`** ครบทั้งคู่ (ห่อด้วย try/catch)
4. **การเปลี่ยนสถานะเจ้าหน้าที่ต้องระลึกว่า session ใน localStorage จะถูกล้างใน 5 นาที** ถ้า set เป็น suspended/deleted
5. **audit_logs action name ที่ใช้จริง**: `FORCE_CHECKOUT`, `FORCE_CHECKOUT_ALL`, `ENABLE_LOGIN`, `DISABLE_LOGIN`, `ENABLE_DUTY_SYSTEM`, `DISABLE_DUTY_SYSTEM`, `DELETE_DUTY_LOG`, `UPDATE_COMPLAINT_STATUS`, `EMERGENCY_<STATUS>`, `UPDATE_EMERGENCY_LOCATION`, `UPDATE_EMERGENCY_HANDLER`, `DELETE_EMERGENCY_REPORT`, `IMPOUND_VEHICLE`, `RELEASE_VEHICLE`, `DELETE_VEHICLE`, `DELETE_OFFICER`, `BUDGET_INJECTION`, `PAYROLL_PAYOUT_SNAPSHOT`, `PAYROLL_MANUAL_OVERRIDE`
    **ไม่มี audit** สำหรับ: announcement, service_rates, officer_leaves, points
6. **เงินทุกจุดใช้หน่วย BC** · `duty_rate` = BC/ชั่วโมง
7. **รูปที่อัปโหลดทั้งหมดอยู่ใน folder ใด folder หนึ่ง**: `announcements | officers | evidence | vehicles | manual` (ชื่อ = ชื่อ bucket)
8. **หน้าไหนที่เขียนข้อมูลต้องระบุ `updated_at`** (ยกเว้น `complaints`, `manual_items` ที่ไม่มีคอลัมน์นี้)
9. **สถานะร้องเรียนที่ UI ใช้**: `pending → reviewing → resolved | dismissed`
10. **การลบเจ้าหน้าที่/เวร = soft delete** (`status='deleted'` / `deleted_at`) · query ต้องกรอง `deleted_at is null` เสมอ
11. **`manual_items.variant`** = `'officer' | 'citizen'`
12. **รูปแบบ `emergency_reports.location`**: `JSON.stringify({map:{lat,lng,zoom}, label})` หรือ string ธรรมดา — reader ต้องรองรับทั้งสอง
13. **ตรรกะเรียง/จัดกลุ่ม/ป้ายรุ่นของบุคลากรต้องอยู่ใน `src/lib/personnelOrder.ts` เท่านั้น** — `PersonnelPage` และ `OfficerManagementPage` ต้อง import จากที่นี่ ห้ามเขียน comparator/label ซ้ำในหน้า
14. **เจ้าหน้าที่ใหม่ต้องส่ง `sort_order = max(sort_order)+1` เสมอ** (ใช้ `nextSortOrder()`) เพราะ JSON mode ไม่มี DB default
15. **การจัดลำดับใหม่ต้อง update เฉพาะแถวที่ `sort_order` เปลี่ยนจริง** และ **ต้อง optimistic update + ย้อนกลับเมื่อ error**
16. **การจัดลำดับห้ามแตะเจ้าหน้าที่ที่ถูกกรองออก** — ใช้การแทนที่เฉพาะ slot ของแถวที่มองเห็น (ดู `commitReorder`)
17. **shift_code มีแค่ `s1` / `s2`** (กะที่ 1 / กะที่ 2) — ห้ามใช้ `day`/`night` เด็ดขาด · เวลามาจาก `shiftWindowFor(weekday, shift)` (จ–ศ กับ ส–อ ต่างกัน)
18. **`duty_schedules` / `schedule_overrides` = 1 แถวต่อ 1 คน** — ห้ามเขียนหลายคนรวมฟิลด์เดียว · UNIQUE อยู่ที่ `(slot, officer_id)`
19. **การอนุมัติใบลาเขียน `schedule_overrides` ด้วยคีย์ 3 ชั้น** `(override_date, shift_code, officer_id)` — ห้ามค้นแค่วัน+กะ เพราะจะทับของคนอื่น
20. **การให้/หักคะแนนอัตโนมัติต้องผ่าน `addAutomaticPoints()`** เท่านั้น (มันตรวจ `auto_points_enabled` ใน `points.ts`) · `addOfficerPoints()` ใช้เฉพาะการให้คะแนนด้วยมือ
21. **ก่อนให้คะแนนอัตโนมัติทุกครั้งต้องเขียน `points_award_marks` ด้วย mark_key** เพื่อกันการให้ซ้ำ
22. **`policy` ของ `system_settings` ต้องเป็น read + update แบบ `using(true)`** — ห้ามย้อนกลับไปใช้ `current_rank()` (ระบบไม่ได้ login ผ่าน Supabase Auth จึงได้ NULL เสมอ)
23. **ตัดคะแนนขาดเวรต้องมีเงื่อนไขว่าอยู่ในตารางเวรด้วย** — ใช้ `resolveScheduledOfficerIds()` ไม่ใช่นับจาก duty_logs อย่างเดียว