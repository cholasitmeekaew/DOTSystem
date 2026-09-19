# รายงานการพัฒนาฟีเจอร์ กดรับส่วนแบ่งเคส (Claim Share)

## วันที่: 15 กันยายน 2568

---

## 1. สรุปโครงการ

เพิ่มฟีเจอร์ "กดรับส่วนแบ่งเคส" ในหน้า **ค่าบริการ (Service Fees)** ซึ่งให้เจ้าหน้าที่ (จนท.) สามารถกดรับส่วนแบ่งรายได้จากเคสบริการที่ตัวเองดูแลและประชาชนชำระเงินแล้ว ก่อนที่ Commissioner จะอนุมัติคำขอนั้นก่อนที่จะเข้าสู่ระบบจ่ายเงินเดือน

---

## 2. ปัญหา / ความต้องการ

- เดิมระบบมีกลไก Claim ทั้งหมด (Backend RPC, ตาราง claim_records, หน้าอนุมัติ) แต่ **ไม่มีปุ่มให้เจ้าหน้าที่กดรับจากหน้าค่าบริการ**
- เจ้าหน้าที่ต้องเข้าทางหน้า "ประวัติการทำงาน" (OfficerHistoryModal) เพื่อกดรับส่วนแบ่ง ซึ่งไม่สะดวกและไม่เห็นบริบทของแต่ละเคส
- ต้องการให้การกดรับส่วนแบ่งจากหน้าค่าบริการสามารถ:
  - สร้างคำขอสถานะ `pending`
  - ปรากฏในเมนู **🪙 อนุมัติส่วนแบ่งเคส** (DepartmentBalancePage)
  - รอ Commissioner อนุมัติ ก่อนจะเข้าสู่ **💸 จ่ายเงินเดือนประจำงวด**
  - ถ้าจ่ายเกินเดือน → ยอดส่วนแบ่งล้าง (เหลือ 0)
  - ถ้าไม่อนุมัติ → ส่วนแบ่งจะขึ้นในเดือนถัดไป

---

## 3. ไฟล์ที่แก้ไข

### `src/pages/officer/ServiceFeesPage.tsx`

#### 3.1 การเพิ่ม Imports
```typescript
// Icon สำหรับปุ่ม
HandCoins (from 'lucide-react')

// Type ใหม่
ClaimRecord (from '../../lib/types')

// Hook สำหรับ Toast
useToast (from '../../hooks/use-toast')

// API functions ใหม่
submitClaim, translateClaimError, fetchOfficerClaims (from '../../lib/api/claimShare')
```

#### 3.2 การเพิ่ม State
```typescript
const [officerClaims, setOfficerClaims] = useState<ClaimRecord[]>([]);
const [claimingRecord, setClaimingRecord] = useState<string | null>(null);
const [assignedOfficerMap, setAssignedOfficerMap] = useState<Record<string, string[]>>({});
```

#### 3.3 การเพิ่มฟังก์ชัน
| ฟังก์ชัน | วัตถุประสงค์ |
|---------|-------------|
| `loadOfficerClaims()` | ดึงรายการ claim ของ officer จาก DB |
| `isRecordClaimed(rec)` | ตรวจสอบว่า record นี้ถูก claim ไปแล้วหรือยัง |
| `handleClaimShare(rec)` | เรียก submitClaim + Toast + Refresh |

#### 3.4 การแก้ไข fetchAll()
- เพิ่มการดึง `service_record_officers` ต่อ record → สร้าง `assignedOfficerMap` (record_id → [officer_ids])
- ใช้สำหรับตรวจสอบว่า officer คนปัจจุบันดูแล record นี้หรือไม่

#### 3.5 การแก้ไข useEffect
- เพิ่ม `loadOfficerClaims()` ในการเริ่มต้นโหลดข้อมูล

#### 3.6 การแก้ไขคอลัมน์การกระทำ (Actions Column)
- **ก่อน**: แสดงเฉพาะ แก้ไข / ลบ / บันทึกชำระเงิน
- **หลัง**: เพิ่มปุ่ม 🪙 รับส่วนแบ่งเคส (เฉพาะ conditions ด้านล่าง)

**เงื่อนไขการแสดงปุ่ม:**
1. Record status = `paid`
2. Officer ปัจจุบันเป็นผู้ดูแล (`officer_id` หรืออยู่ใน `assignedOfficerMap`)
3. ยังไม่ได้ claim สำหรับ period+scope นี้ (`isRecordClaimed === false`)
4. ผู้ใช้ไม่ใช่ Commissioner

---

## 4. ลำดับการทำงานของระบบ

```
┌─────────────────────────────────────────────────────────────┐
│  Officer (จนท.)                                              │
│  ดูหน้า ค่าบริการ (ServiceFeesPage)                            │
│  เห็นรายการเคสที่ชำระแล้ว                                     │
│  กด 🪙 รับส่วนแบ่งเคส                                          │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  submitClaim(officerId, period, scope, actorId)              │
│  → เรียก RPC: claim_service_share                             │
│  → INSERT claim_records (status = 'pending')                 │
│  → Toast: "ส่งคำขอรับส่วนแบ่งสำเร็จ"                            │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  Commissioner (หัวหน้า)                                        │
│  ดูหน้า การเงิน & สัดส่วน (DepartmentBalancePage)               │
│  แท็บ 🪙 อนุมัติส่วนแบ่งเคส (Claim)                              │
│  เห็นรายการ pending → กด อนุมัติ / ปฏิเสธ                      │
└──────────────────────┬──────────────────────────────────────┘
                       │
              ┌────────┴────────┐
              ▼                 ▼
    approve_claim()      reject_claim()
    status → 'approved'  status → 'rejected'
    accumulated_share += amount

              ▼ (approved)
┌─────────────────────────────────────────────────────────────┐
│  Commissioner กด จ่าย (mark_claim_paid)                       │
│  → status → 'paid'                                          │
│  → accumulated_share = MAX(accumulated - amount, 0)          │
│  → ถ้าจ่ายเกินยอด → ยอดเหลือ 0 (ล้าง)                          │
│  → ถ้าไม่จ่าย → จะขึ้นในงวดถัดไป (อยู่ใน approved ต่อ)          │
└─────────────────────────────────────────────────────────────┘
```

---

## 5. ตารางข้อมูลและ RPC ที่เกี่ยวข้อง (มีอยู่แล้ว)

### ตาราง `claim_records` (Migration 0009)
| Column | Type | หมายเหตุ |
|--------|------|---------|
| id | uuid | PK |
| officer_id | uuid | FK → officers |
| service_record_id | uuid | FK → service_records |
| amount | numeric(10,2) | ยอดส่วนแบ่งต่อคน |
| scope | text | 'default' / 'vehicle_rescue' |
| officer_share_percent | numeric(5,2) | % ส่วนแบ่ง |
| claim_period | text | 'YYYY-MM' |
| record_count | integer | จำนวนเคส |
| status | text | pending/approved/rejected/paid |
| claimed_by / approved_by / paid_by | uuid | Audit |
| created_at | timestamptz | เวลาสร้าง |

### RPC ที่ใช้งาน
| RPC | วัตถุประสงค์ |
|-----|-------------|
| `preview_claim_share` | คำนวณยอดที่จะได้รับ (ยังไม่ claim) |
| `claim_service_share` | ส่งคำขอรับส่วนแบ่ง (bulk insert pending) |
| `approve_claim` | อนุมัติ + increment accumulated_share |
| `reject_claim` | ปฏิเสธ |
| `mark_claim_paid` | จ่ายแล้ว + decrement accumulated_share |

---

## 6. กฎเกณฑ์การคำนวณส่วนแบ่ง

### 6.1 สูตรคำนวณยอดส่วนแบ่ง
```
ยอดต่อคน = (amount × officer_share_percent / 100) / จำนวนเจ้าหน้าที่ที่ได้รับมอบหมาย
```

### 6.2 Scope การคำนวณ
| Scope | เงื่อนไข |
|-------|---------|
| `default` | เคสทั่วไป (โยธา, ไฟฟ้า, จราจร, ฉุกเฉิน) |
| `vehicle_rescue` | กู้ภัยรถยก |

### 6.3 กฎการ carry over / ล้างยอด
- **อนุมัติแต่ไม่จ่าย**: ยอดคงอยู่ใน status `approved` → จะเข้างวดถัดไปอีก (สามารถจ่ายได้)
- **จ่ายแล้ว**: `accumulated_share = MAX(accumulated - amount, 0)` → ล้างยอดอัตโนมัติถ้าเกิน
- **ปฏิเสธ**: status `rejected` → สามารถกดรับใหม่ได้
- **ยังไม่ได้กด**: ไม่ปรากฏใน claim เลย → ไม่เข้างวดใด ๆ

---

## 7. การทดสอบ (Verification)

### Build Status
```
✓ npm run build — ผ่าน (Vite v7.3.6)
✓ npx tsc --noEmit — ไม่มี TypeScript errors
```

### สถานการณ์ทดสอบ
1. **Officer ล็อกอิน → หน้า ค่าบริการ** → เห็นปุ่ม 🪙 บน record ที่ paid และตัวเองดูแล
2. **กดปุ่ม → ส่งคำขอด** → Toast "ส่งคำขอรับส่วนแบ่งสำเร็จ" → ปุ่มหายไป (claimed แล้ว)
3. **Commissioner → DepartmentBalancePage → 🪙 อนุมัติ** → เห็นรายการใหม่ status pending
4. **กดอนุมัติ** → status → approved → accumulated_share เพิ่ม
5. **กดจ่าย** → status → paid → accumulated_share ลดลง (floor 0)
6. **กดปฏิเสธ** → status → rejected → Officer สามารถกดรับใหม่ได้

---

## 8. สรุป

| รายการ | สถานะ |
|--------|-------|
| TypeScript compile | ✅ ผ่าน |
| Production build | ✅ ผ่าน |
| ปุ่มรับส่วนแบ่งใน ServiceFeesPage | ✅ เสร็จ |
| การเชื่อมโยงกับ ClaimApprovalTable | ✅ มีอยู่แล้ว |
| การเชื่อมโยงกับ Payroll | ✅ มีอยู่แล้ว |
| Toast notification | ✅ เสร็จ |
| การตรวจสอบซ้ำ (Duplicate check) | ✅ isRecordClaimed |

**ผลกระทบต่อระบบ**: ไม่มีผลกระทบต่อระบบเดิม (No Breaking Changes) — เป็นการเพิ่มฟีเจอร์แบบ Additive เท่านั้น
