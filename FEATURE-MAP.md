# แผนผังฟีเจอร์ระบบ DOT System

> สำรวจเมื่อ 2026-10-15 · commit `7c48c8f` · React + TypeScript + Vite + Supabase
> 162 ไฟล์ / ~41,000 บรรทัด · โหมดปัจจุบัน = **Supabase จริง** (ไม่ใช่ mock)

---

## 0. ภาพรวมสถาปัตยกรรม

| ชั้น | รายละเอียด |
|---|---|
| Routing | **ไม่มี React Router** ใช้ `useState` เป็นตัวแปรหน้า (`src/App.tsx:71`) |
| Data | ยิง `supabase` **ตรงจากหน้าเพจ** เกือบทั้งระบบ — ไม่มี service layer จริง |
| Auth | localStorage + SHA-256 (`src/lib/crypto.ts`) — **ไม่มี Supabase Auth** |
| Realtime | `supabase.channel()` ~10 จุด ในไฟล์หน้าเพจ โดยตรง |
| API layer | `src/lib/api/*.ts` 23 ไฟล์ — **ประมาณ 13 ไฟล์เป็น dead code** |

---

## 1. การยืนยันตัวตน และสิทธิ์

### การทำงาน
1. `LoginPage.tsx:39` hash รหัสผ่าน SHA-256 (ไม่มี salt)
2. `LoginPage.tsx:41` query `officers` แบบ `select('*')` → ได้ `password_hash` **ของแถวนั้น** กลับมาทั้งแถว
3. เทียบ hash ที่บรรทัด 59 → สำเร็จก็เก็บ officer ทั้งก้อนลง `localStorage['dot_officer']`
4. `AuthContext.tsx:113` เขียน session · `:126` logout ลบ key
5. ระดับสิทธิ์ = เทียบ string `officer.rank` ตรง ๆ (`commissioner` / `inspector` / `officer`)

### ช่องโหว่ที่ยืนยันแล้ว
| # | ปัญหา | ที่อยู่ | ผลกระทบ |
|---|---|---|---|
| 1 | แก้ `localStorage.dot_officer.rank` = `commissioner` | `AuthContext.tsx:113,142` | ได้สิทธิ์เต็ม ไม่ต้องรู้รหัส |
| 2 | `select('*')` คืน `password_hash` | `LoginPage.tsx:43` | ดึง hash ไป crack ได้ |
| 3 | `select('*')` คืน hash ของ**ทุกคน** ในหน้า public | `PersonnelPage.tsx:62` | รหัสผ่านของทุกเจ้าหน้าที่รั่วสาธารณะ |
| 4 | `PersonnelPage` แสดง `username` (ที่ใช้ login) ของทุกคน | `:530,830` | ทำ brute force ได้ |
| 5 | RLS เปิด `using(true)` ให้ anon | `0029:24`, `0026:20`, `0028:168` | anon ปิด PPS engine / แก้คู่มือ / แก้ตารางเวรได้ |
| 6 | `disable row level security` | `0015:16-17` | `work_reports`, `service_payments` เปิดหมด |
| 7 | Supabase key **คนละโปรเจกต์** hardcode ใน Git | `scripts/create-user.mjs:3-4` | ต้อง rotate |
| 8 | รหัส admin `admin1234` อยู่ใน bundle | `src/data/seed.ts:1-2` | login เป็นหัวหน้ากรมได้ |
| 9 | หน้า `emergency` หลุดจาก `commissionerOnlyPages` | `App.tsx:79-86` | **ยืนยันแล้วว่าไม่มีในลิสต์** — ทุกเจ้าหน้าที่เห็นข้อมูลฉุกเฉินประชาชน |

### โครง Route Guard (`App.tsx:79-86`)
ป้องกัน 16 หน้า: `admin-menu, officer-management, citizen-management, points-management, department-balance, service-rates, complaints, announcements, vehicles, admin-settings, report-approvals, leave-approvals, roster-admin, manual-edit, duty-logs-admin, work-reports-admin`

---

## 2. เวร (Duty Logs)

### การทำงาน
- **เข้าเวร** `OperationsPage.tsx:789` → insert `duty_logs` + ตั้ง `officers.is_on_duty=true`
- **ออกเวร** `:807` → หา log ที่ `clock_out IS NULL` → คำนวณนาที → update → `is_on_duty=false` → **ให้คะแนน +5/ชม.** → เปิดฟอร์มรายงาน
- **ฟิลด์**: `officer_id, clock_in, clock_out, duration_minutes, checkout_method, forced_by, forced_by_name, deleted_at, deleted_by, delete_reason`
- **"กะ" ไม่มีคอลัมน์จริง** — เดาจาก `clock_in` เทียบช่วงเวลา (`DutyLogsAdminPage.tsx:46`)
- **ลบ = soft delete** (`deleted_at`) เพื่อให้คะแนนย้อนตรวจได้

### Force Checkout — มี 4 ทาง
| ทาง | ที่อยู่ | หัก −15? |
|---|---|---|
| ปุ่มใน OperationsPage | `OperationsPage.tsx:857` | ✅ |
| ปุ่มบน Dashboard | `DashboardPage.tsx:127` | ❌ **ไม่หัก** |
| ปิดระบบเวร (mass) | `AdminSettingsPage.tsx:218` | ❌ **ไม่หัก** (แก้แล้ววันนี้) |
| Hook `useClockOut` | `dutyLogs.ts:87` | dead code |

---

## 3. ตารางเวร (Roster)

### โครงสร้าง
- `duty_schedules` — ผังประจำสัปดาห์ (วนซ้ำ)
- `schedule_overrides` — ยกเว้นรายวัน (`swap` / `leave` / `extra` / `off`)
- กะ: จ–ศ 18:30–21:30 (2 กะ) · ส–อ 18:30–23:00 (2 กะ) — `types.ts:277`

### สุ่มตารางอัตโนมัติ — `rosterRandomizer.ts:157`
กฎ 5 ข้อ: ทุกช่องมีผู้นำ ≥1 · เติมตามโควตา · **ห้ามคนที่ลา** · คนละ 1 กะ/วัน · กระจายภาระ
ใช้ PRNG แบบ LCG + seed → กด "สุ่มใหม่" ด้วย seed เดิมได้ผลเดิม

⚠️ **บันทึกแล้วทับ `duty_schedules` ที่ใช้ทุกสัปดาห์** ไม่ใช่แค่สัปดาห์ที่เลือก (มีคำเตือนใน UI แล้ว)

### เชื่อมกับการลา
อนุมัติใบลา → เขียน override ทุกวัน × 2 กะ (`LeaveManagementPage.tsx:203`) · ปฏิเสธ/ยกเลิก → ลบ override

---

## 4. การลา (Leave)

| ประเภท | ควตา/เดือน |
|---|---|
| ลาป่วย | 3 |
| ลากิจ | 2 |
| ลาพักร้อน | 3 |
| ลาคลอด / บวช / อื่นๆ | ไม่จำกัด |

- สถานะ: `pending` → `approved` / `rejected` / `cancelled`
- **นับวันรวมปลายทั้งสองข้าง** และตัดส่วนที่ข้ามเดือน (`leaveQuota.ts:31-54`)
- กินโควตาเฉพาะ `approved` เท่านั้น (`:57`)
- validate real-time ก่อนส่ง + บล็อกปุ่มบันทึก (`:131-182`)

---

## 5. ยานพาหนะ (Vehicles)

**ไม่มีระบบจองใช้รถ** — เป็นทะเบียนรถ + ยึด/ปล่อยยึดเท่านั้น
- ยึด: อัปโหลดรูป → `is_impounded=true` + เหตุผล/สถานที่/ผู้ยึด + audit `IMPOUND_VEHICLE`
- ปล่อย: `is_impounded=false` + audit `RELEASE_VEHICLE`
- ⚠️ ปล่อยยึด **ไม่ล้าง** `impound_reason/location/at/by` (ค้างไว้ ต่างจาก hook ที่ควรจะล้าง)

---

## 6. รายงานปฏิบัติงาน (Work Reports)

### การทำงาน
- ส่งผ่าน RPC `create_work_report_with_cases` (`OperationsPage.tsx:655`)
- **หมวดงาน 6 ค่า**: `patrol, incident, ticket, traffic, rescue, other`
- **เคสย่อย** `case_status`: `completed` / `in_progress` / `transferred`
- ผูกกับเวร 1:1 ผ่าน `work_reports.duty_log_id`
- อ่านเคสต้องใช้ RPC `get_work_report_cases` เพราะ query ตรงโดน RLS

### สถานะ: `pending` → `approved` / `rejected`
| เหตุการณ์ | ผลคะแนน |
|---|---|
| อนุมัติ | +10 (mark `report:<id>`) |
| อนุมัติ + เคส `completed` | +5 ต่อเคส (mark `case:<id>`) |
| ยกเลิกอนุมัติ | **คืนรวมรายงาน+เคส** + ลบ mark (แก้แล้ววันนี้) |
| ลบรายงานที่อนุมัติแล้ว | คืนคะแนน + ลบ mark + audit `DELETE_WORK_REPORT` |

✅ `reviewed_points` บันทึก "คะแนนที่ให้จริง" หลัง clamp แล้ว → ตรงกับ `points_log` เสมอ

---

## 7. ระบบคะแนน PPS

### ที่เก็บ
- `officers.points` = คะแนนปัจจุบัน (clamp `0–100,000`)
- `officers.points_period` = งวด `YYYY-MM`
- `officers.points_log` = **JSON array ledger** `{at, by, by_name, delta, reason, balance_after, period}`
- `points_award_marks` = ตารางกันให้ซ้ำ (`mark_key` UNIQUE)

### กฎทั้งหมด
| key | ค่า | เหตุการณ์ | mark_key |
|---|---|---|---|
| `perDutyHour` | **+5**/ชม. | ออกเวรปกติ | `dutyout:<log>` |
| `reportApproved` | **+10** | รายงานอนุมัติ | `report:<id>` |
| `caseCompleted` | **+5** | เคส `completed` | `case:<id>` |
| `serviceClosed` | **+5** | จ่ายครบบิล (ทุกคนที่รับเคส) | `feeclose:<rec>:<off>` |
| `absenceWeek` | **−5** | ไม่เข้าเวร 7 วัน | `absent7:<id>:<date>` |
| `missingReport` | **−5** | ออกเวรไม่ส่งรายงาน | `noreport:<log>` |
| `forceCheckout` | **−15** | ถูกบังคับออกเวร | `force:<log>` |
| `complaintVerified` | **−30** | ร้องเรียนยืนยัน | `complaint:<id>` |

- **Kill switch** `system_settings.auto_points_enabled` — error/null → ถือว่า **ปิด** (fail-closed)
- เช็ค 2 ชั้น: `awardAutoPoints()` + `addAutomaticPoints()`
- ปิดสวิตช์ = หัวหน้ากรมยังให้/หักเองได้ผ่าน `addOfficerPoints` (ไม่ผ่าน kill switch)
- `revertReportApprovalPoints` เรียกตรงโดยตั้งใจ เพื่อให้การคืนไม่ขึ้นกับสวิตช์

### ⚠️ ปัญหาโครงสร้าง
✅ `points_log` เขียนผ่าน `add_officer_points()` ที่ล็อกแถวด้วย `FOR UPDATE` แล้ว (ต้องรัน migration `0042` — ถ้ายังไม่รันจะ fallback เป็น read-modify-write แบบเดิม)

---

## 8. ค่าบริการ / ส่วนแบ่ง / เงินเดือน

### Service Records
- ราคาจาก `service_rates` เป็น **ค่า default** — ผู้ใช้แก้เองได้
- บังคับเลือกผู้ดูแลเคส ≥1 คน → เขียน `service_record_officers`
- ชำระผ่าน RPC `record_service_payment` รองรับผ่อน
- สถานะจริง 3 ทาง: `paid` / `partial` / `unpaid` (type ประกาศแค่ 2)
- เจ้าหน้าที่กด "รับส่วนแบ่ง" → `claim_service_share` → ledger `claim_records`
  สูตร: `override → record.officer_share → amount × pct / จำนวนผู้รับเคส`

### Payroll (`payrollEngine.ts`)
```
duty_income    = Σ ชั่วโมงเวร × duty_rate
service_income = Σ claim ที่ status='approved'
bonus          = กรอกเอง
total_net      = ทั้งสอง + bonus
```
```
netAvailableBudget = (รายได้paid + งบที่เติมเอง) − Σ snapshots
```

🔴 **snapshots + งบที่เติมเก็บใน localStorage** (`payrollEngine.ts:56-57`) → ล้างเบราว์เซอร์ = งบที่จ่ายแล้วหาย = **อนุมัติจ่ายงวดเดิมซ้ำได้**

---

## 9. ร้องเรียน / ฉุกเฉิน / ประชาชน

### Complaints
- ชาวบ้านส่งจากหน้า public (ไม่ต้อง login, ไม่มี rate limit)
- สถานะ 5: `pending, reviewing, verified, resolved, dismissed`
- `verified` → **−30 PPS** หาเจ้าหน้าที่จาก **ชื่อ (text)** → ไม่เจอก็ไม่หัก
- ⚠️ ไม่มีการคืนคะแนนถ้าเปลี่ยนสถานะออกจาก `verified`
- ✅ ทุกฝั่งใช้ `'reviewing'` ตรงกับ `complaints_status_check` แล้ว พร้อมแผนที่ป้าย `COMPLAINT_STATUS_LABELS`

### Emergency
- ชาวบ้านแจ้งพิกัดแผนที่ + อัปโหลดรูป
- Flow: `pending → responding → resolved` / `dismissed`
- 🔴 **หน้า EmergencyManagementPage ไม่มี rank guard** → ทุกเจ้าหน้าที่เห็นข้อมูลฉุกเฉินของประชาชน

### Citizens
- ตารางเล็กมาก: `roblox_username, discord_username, status, notes` (ไม่มีชื่อ-สกุล/เลขบัตร)
- 🔴 **หน้า public ค้นด้วยชื่อ Roblox/Discord + ทะเบียนรถ** แล้วเห็นยอดค้างชำระ สถานะแบน ประวัติร้องเรียน ประวัติฉุกเฉิน ของคนอื่น — ไม่มี auth ต้องเดาชื่อเท่านั้น

---

## 10. หน้าสาธารณะ (10 หน้า)

| หน้า | ข้อมูลเปิดสาธารณะ | ประเมิน |
|---|---|---|
| HomePage | ประกาศ, เจ้าหน้าที่ที่เข้าเวร (เวลาจริง) | พอใช้ |
| CitizenPage | **ค้นชื่อ → ข้อมูลบุคคลทั้งหมด** | 🔴 รั่ว |
| ComplaintPage | ส่งร้องเรียน | ควรเพิ่ม rate limit |
| EmergencyReportPage | แจ้งเหตุ | ควรเพิ่ม rate limit |
| LeaderboardPage | ชื่อ+ยศ+แผนก+คะแนน | พอใช้ |
| StatsPage | `select('*')` 11 ตาราง + activity feed เผยเคสร้องเรียนจริง | 🔴 รั่ว |
| ManualPage | คู่มือ (ผู้ใช้ทุกคนที่ login เพิ่ม/ลบได้) | 🟠 |
| **PersonnelPage** | **เผย `username` (ใช้ login) ของทุกคน + ยอดรายบุคคล** | 🔴 รั่ว |
| ServiceRatesPublicPage | ราคามาตรฐาน | เหมาะสม |
| TermsPage | static | — |

---

## 11. Realtime

| ไฟล์ | ตาราง |
|---|---|
| `ProfilePage.tsx:163` | `work_reports, officer_leaves, officers, officer_login_logs` |
| `PointsManagementPage.tsx:87` | `officers` (UPDATE) |
| `ServiceFeesPage.tsx:94-103` | `service_records, service_rates, citizens, service_payments` + poll 30 วิ |
| `OperationsPage.tsx:498-504` | `duty_logs, work_reports, duty_schedules` |
| `LeaveManagementPage.tsx:118` | `officer_leaves` |
| `CitizenManagementPage.tsx:104-110` | `citizens, service_rates, service_records` |
| `CitizenPage.tsx:206` | หน้า **public** ก็ subscribe realtime |

✅ ProfilePage subscribe `duty_logs` แล้ว → สถิติเวรอัปเดตสด
⚠️ `useRealtimeSubscription.ts` (hook กลาง) = **dead code** ไม่มีใครใช้

---

## 12. Audit Logs — จุดที่พังจริง

### 🔴 บั๊กยืนยันแล้ว: `audit_logs` ไม่มีคอลัมน์ `actor_id`
คอลัมน์จริง: `id, action, target_type, target_id, performed_by, performed_by_name, details, created_at`

`payrollEngine.ts` เขียน `actor_id`/`actor_name` ที่บรรทัด **102, 151, 226** → **insert ล้มเหลวทั้ง 3 จุด**
→ audit `BUDGET_INJECTION`, `PAYROLL_PAYOUT_SNAPSHOT`, `PAYROLL_MANUAL_OVERRIDE` **ไม่เคยถูกบันทึก**
→ ยืนยันจาก DB: `audit_logs` 345 แถว ไม่มี action ทั้ง 3 ชื่อนี้เลย

### action ที่ถูกเขียนจริง (จาก DB)
```
DELETE_DUTY_LOG 68 · DISABLE_DUTY_SYSTEM 73 · ENABLE_DUTY_SYSTEM 73
DELETE_OFFICER 11 · FORCE_CHECKOUT 33 · EMERGENCY_RESPONDING 4 · EMERGENCY_RESOLVED 4
EMERGENCY_DISMISSED 2 · DELETE_EMERGENCY_REPORT 4 · DELETE_VEHICLE 6 · IMPOUND_VEHICLE 1
UPDATE_EMERGENCY_LOCATION 1 · UPDATE_DEPT_BALANCE 1 · SET_DEPARTMENT_BUDGET 1
FORCE_CHECKOUT_ALL 6 · ENABLE_AUTO_POINTS 9 · DISABLE_AUTO_POINTS 7
CLEAR_POINTS_HISTORY_AND_RESET 22 · DELETE_WORK_REPORT 13
DISABLE_WORK_REPORTS 3 · ENABLE_WORK_REPORTS 3
```

### สิ่งที่ "ควร" audit แต่ไม่มี
- อนุมัติ/ปฏิเสธรายงาน · สร้าง/แก้/ลบ service_records · ชำระเงิน
- ให้/หักคะแนน (`addOfficerPoints`, `resetMonthlyPeriod`, `deleteOfficerPointsLog`)
- CRUD ประชาชน / ประกาศ · approve-reject-paid claim
- **ไม่มีหน้า Admin สำหรับดู audit log** — เขียนเยอะแต่อ่านไม่ได้

---

## 13. Dead Code — `src/lib/api/` 13/23 ไฟล์

ยืนยันด้วย grep: ไม่มีไฟล์ไหน import เลยแม้แต่ไฟล์เดียว
```
serviceRecords · serviceRates · vehicles · citizens · licenses
announcements · complaints · emergencyReports · officerLeaves
auditLogs · systemSettings · auth · (dutyLogs 4 ตัว) · realtime/useRealtimeSubscription
```
→ ~50 export ที่ไม่มีใครเรียก · แต่**มีตรรกะต่างจากที่หน้าเพจทำจริง** (เช่น `useReleaseVehicle` ล้างข้อมูลการยึด แต่ `VehicleManagementPage` ไม่ล้าง)

---

## 14. จำนวนข้อมูลจริงใน DB ตอนนี้

| ตาราง | แถว | ตาราง | แถว |
|---|---|---|---|
| officers | 25 | vehicles | 796 |
| duty_logs | 195 | service_records | 155 |
| service_rates | 19 | audit_logs | 345 |
| duty_schedules | 56 | points_award_marks | 35 |
| announcements | 2 | work_reports | 2 |
| work_report_cases | **0** | claim_records | 0 |
| officer_leaves | 0 | complaints | 0 |
| emergency_reports | 0 | officer_login_logs | 0 |
| schedule_overrides | 0 | | |

---

## 15. ลำดับที่แนะนำให้แก้

### 🔴 P0 — เสี่ยงสูง / ข้อมูลรั่ว
1. **`emergency` หลุด route guard** → เพิ่มใน `App.tsx:79-86` (1 บรรทัด)
2. **`PersonnelPage` เผย `username`** → ตัดออกจาก select + UI
3. **`CitizenPage` ค้นข้อมูลบุคคลโดยไม่มี auth** → จำกัด/ขอ OTP
4. **audit `actor_id` ผิดคอลัมน์** → เปลี่ยนเป็น `performed_by` 3 จุด
5. **`payroll snapshots` ใน localStorage** → ย้ายเข้า DB

### 🟠 P1 — ความถูกต้อง
6. ~~Force checkout ทาง Dashboard ไม่หัก −15~~ ✅ รวมเป็น `api/forceCheckout.ts` จุดเดียว
7. ~~`reviewed_points` = 10 แม้สวิตช์ปิด~~ ✅ บันทึกยอดที่ให้จริงหลัง clamp
8. ~~Complaint `investigating` vs `reviewing`~~ ✅ ใช้ `reviewing` ตาม CHECK constraint + เพิ่มป้าย `verified`
9. ~~Complaint verified → คืนคะแนนเมื่อเปลี่ยนสถานะออก~~ ✅ `revertVerifiedComplaintPoints()`
10. ~~ProfilePage ไม่ subscribe `duty_logs`~~ ✅ เพิ่มแล้ว
11. ~~`points_log` แบบ read-modify-write~~ ✅ `add_officer_points()` ใช้ `FOR UPDATE` (ต้องรัน migration `0042_atomic_points.sql`)

### 🟡 P2 — สถาปัตยกรรม
12. ตัด `select('*')` ทุกจุดที่แตะ `officers` (หยุด `password_hash` รั่ว)
13. ย้าย `dot_officer` ไม่เก็บ `password_hash`
14. ลบ/ต่อสาย dead code 13 ไฟล์ หรือ wire ให้ใช้จริง
15. รวม logic rank ที่กระจาย 5+ จุด เป็น helper เดียว

### 🔵 P3 — พื้นฐาน
16. เชื่อม Supabase Auth จริง → คืน RLS `0002_rls.sql` ที่เขียนไว้ดีแล้วให้มีผล
17. เปลี่ยน SHA-256 → bcrypt/argon2 + per-user salt
18. Rotate Supabase key, ย้าย key ออกจาก `scripts/create-user.mjs`
19. เพิ่ม rate limit / lockout หน้า login และฟอร์ม public
