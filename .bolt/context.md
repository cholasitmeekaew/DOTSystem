# DOTSystem — Bolt Context

> ไฟล์นี้อธิบายโปรเจคให้ AI coding assistant (เช่น Bolt, Cursor, Claude Code) เข้าใจภายใน 1 นาที อ่านก่อนเสมอก่อนแนะนำการแก้ไข

## โปรเจคนี้คืออะไร

**DOT System** — ระบบจัดการ **กรมขนส่ง (Department of Transportation)** สำหรับเซิร์ฟเวอร์ roleplay **ER:LC** (Emergency Response: Liberty County) ภายใต้เมือง **BIT CITIES** เป็น web app ที่ให้:

- **เจ้าหน้าที่ DOT** ลงเวลาเข้า-ออกเวร, บันทึกค่าบริการ, จัดการใบขับขี่/ทะเบียนรถ/อายัดรถ
- **หัวหน้ากรม (Commissioner)** จัดการเจ้าหน้าที่, อัตราค่าบริการ, ประกาศ, รับเรื่องร้องเรียน
- **ประชาชน** ตรวจสอบข้อมูลตัวเอง, ยื่นคำร้อง, แจ้งเหตุฉุกเฉิน

**โหมดการทำงาน**: รองรับ 2 โหมด auto-switch ผ่าน `VITE_SUPABASE_URL`
- **JSON mode (default)**: localStorage-backed DB ที่เลียนแบบ Supabase API — ไม่ต้องตั้ง Supabase
- **Supabase mode**: ตั้ง URL + Anon Key ใน `.env` แล้วใช้ Postgres จริง

## Stack

- **Vite 7** + **React 19** + **TypeScript 5**
- **Tailwind CSS v4** + custom theme (navy/amber)
- **shadcn/ui** (Radix UI primitives ครบเซ็ต)
- **TanStack Query v5** (ติดตั้งแล้ว ใช้ใน hooks/)
- **wouter** (lightweight router)
- **@supabase/supabase-js** (ใช้เฉพาะ Supabase mode)
- **lucide-react** icons
- **zod** validation
- **react-hook-form**

## โครงสร้างไฟล์ (อ่าน quick map)

```
src/
├── lib/
│   ├── supabase.ts          # Auto-detect mode (json | supabase), ส่งออก supabase client
│   ├── jsonDb.ts            # localStorage mock + realtime bus — ใช้แทน Supabase ใน json mode
│   ├── AuthContext.tsx      # Officer session (login/logout/isCommissioner)
│   ├── crypto.ts            # hashPassword() — SHA-256
│   ├── types.ts             # Domain types (Officer, ServiceRecord, Vehicle, etc.)
│   ├── api/                 # ✨ API layer — เรียก supabase.from() ผ่านที่นี่
│   ├── realtime/            # ✨ Realtime hooks (useRealtimeSubscription)
│   └── utils.ts             # cn() helper
├── hooks/                   # ✨ useAuth, useOfficers, useServiceRecords, useDispatchChannel
├── pages/
│   ├── officer/             # หน้าเจ้าหน้าที่ (login required)
│   │   ├── DashboardPage.tsx
│   │   ├── OperationsPage.tsx       # ลงเวลาเข้า-ออกเวร
│   │   ├── ServiceFeesPage.tsx      # บันทึกค่าบริการ
│   │   ├── ServiceRatesPage.tsx     # จัดการอัตรา (commissioner only)
│   │   ├── OfficerManagementPage.tsx
│   │   ├── CitizenManagementPage.tsx
│   │   ├── VehicleManagementPage.tsx
│   │   ├── LicensePage.tsx          # ใบขับขี่
│   │   ├── ComplaintsManagementPage.tsx
│   │   ├── AnnouncementsPage.tsx
│   │   ├── EmergencyManagementPage.tsx
│   │   └── LeaveManagementPage.tsx
│   └── public/              # หน้าประชาชน (ไม่ต้อง login)
│       ├── HomePage.tsx
│       ├── CitizenPage.tsx
│       ├── VehicleCheckPage.tsx
│       ├── ServiceRatesPublicPage.tsx
│       ├── ComplaintPage.tsx
│       └── EmergencyReportPage.tsx
├── components/
│   ├── OfficerLayout.tsx    # Sidebar + topbar — filter เมนูตาม role
│   ├── PublicLayout.tsx
│   ├── Badge.tsx
│   ├── IdCard.tsx
│   ├── Modal.tsx
│   ├── PageHeader.tsx
│   ├── RankedList.tsx
│   └── ui/                  # shadcn primitives
├── data/seed.ts             # Seed data + type JsonDb
└── App.tsx                  # Router (public <-> officer based on auth)

supabase/migrations/         # ✨ SQL migrations (เตรียมไว้สำหรับ Supabase mode)
```

## Roles (3 ระดับ)

เก็บใน `Officer.rank` เป็น string ใช้ `RANK_LABELS` map เป็นภาษาไทย

| `rank` key | ชื่อไทย | สิทธิ์ |
|---|---|---|
| `commissioner` | หัวหน้ากรมขนส่ง | ทุกอย่าง + จัดการเจ้าหน้าที่/อัตรา/ประกาศ |
| `inspector` | ผู้คุมสอบกรมขนส่ง | ตรวจสอบ ลงเวลา บันทึกค่าบริการ รับแจ้งเหตุ |
| `officer` | พนักงาน | ลงเวลา ดูข้อมูล |

มี 5 แผนก (Department) เก็บใน `Officer.department`:
- `civil_maintenance` (โยธาซ่อมบำรุง)
- `vehicle_rescue` (กู้ภัยรถยก)
- `electrical` (การไฟฟ้า)
- `traffic_management` (จัดการจราจร)
- `emergency_assistance` (ช่วยเหลือฉุกเฉิน)

## กฎเหล็กสำหรับ AI ที่จะแก้ไข

1. **อย่าเปลี่ยน query API** — เรียก `supabase.from('table').select().eq()` ได้เลย ทั้ง Supabase จริงและ JSON mock รองรับ API เดียวกัน
2. **ใช้ API layer** ใน `src/lib/api/` เสมอ ห้ามเรียก `supabase.from()` ตรงในหน้า component — เพื่อให้ cache + realtime invalidate ทำงาน
3. **ใช้ types ใน `src/lib/types.ts`** ห้าม cast `as unknown as` ถ้าไม่จำเป็น
4. **Role guard** — ใช้ `useAuth().isCommissioner` หรือ `<RoleGuard roles={['commissioner']}>` ห้ามเช็ค `officer.rank === 'commissioner'` ซ้ำในหลายที่
5. **Realtime** — subscribe ใน `useEffect` ผ่าน `useRealtimeSubscription('table_name', callback)` ห้ามเรียก `supabase.channel()` ตรง
6. **Form validation** — ใช้ `react-hook-form` + `zod` resolver
7. **UI components** — ใช้ shadcn/ui ใน `src/components/ui/` ห้ามสร้าง button ใหม่
8. **ภาษา** — UI ทั้งหมดเป็น **ภาษาไทย** label/button/message

## นิยามสำคัญ

- **ServiceRecord** = รายการค่าบริการที่เรียกเก็บ (โยธา/กู้ภัย/ไฟฟ้า/จราจร/ฉุกเฉิน)
- **ServiceRate** = อัตราค่าบริการ (13 รายการ default ใน seed.ts)
- **DutyLog** = การลงเวลาเข้า-ออกเวร
- **Citizen** = ประชาชนที่ลงทะเบียนในระบบ (มี status: normal/watched/suspended)
- **Vehicle** = รถที่ลงทะเบียน (มี is_impounded, impound_reason)
- **License** = ใบขับขี่
- **Complaint** = เรื่องร้องเรียนจากประชาชน
- **EmergencyReport** = การแจ้งเหตุฉุกเฉิน (accident/breakdown/towing/other)
- **AuditLog** = บันทึกการกระทำ (FORCE_CHECKOUT, DISABLE_LOGIN ฯลฯ)
- **Announcement** = ประกาศ (pin/unpin, แนบรูป)
- **OfficerLeave** = การลางาน (sick/personal/vacation/maternity/ordained/other)

## Default login (JSON mode)

- Username: `admin`
- Password: `admin1234`
- Role: `commissioner`

ตั้ง `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` ใน `.env` เพื่อสลับเป็น Supabase mode (Postgres จริง + RLS)

## Common tasks

- **เพิ่มหน้าใหม่**: สร้างใน `src/pages/officer/MyPage.tsx` แล้วเพิ่มใน `OfficerLayout.navItems` + `App.tsx` + กำหนด role
- **เพิ่ม API endpoint**: สร้างใน `src/lib/api/myEntity.ts` แล้ว export hooks `useMyEntities()`, `useCreateMyEntity()`
- **เพิ่ม table**: เพิ่มใน `data/seed.ts` (JsonDb) + เขียน migration ใน `supabase/migrations/` + เพิ่ม type ใน `lib/types.ts`
- **เพิ่ม realtime**: ใช้ `useRealtimeSubscription('table', () => queryClient.invalidateQueries(...))`
- **เพิ่ม RLS policy**: เขียนใน `supabase/migrations/00xx_rls.sql` — ใช้ `current_rank()` helper function
