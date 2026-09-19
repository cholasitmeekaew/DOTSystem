# DOTSystem — Bit Cities Department of Transportation

ระบบจัดการกรมขนส่ง (Department of Transportation) สำหรับเซิร์ฟเวอร์ ER:LC roleplay **Bit Cities** — ออกแบบมาให้ทำงานได้ทั้งแบบ **offline (localStorage)** และ **online (Supabase)** ผ่าน flag เดียว

## ✨ ฟีเจอร์หลัก

### 🌐 หน้าประชาชน (Public)
- **ระบบค้นหาประชาชน** — ค้นหาด้วย Roblox Username / Discord / ทะเบียนรถ
- **6 แท็บข้อมูล**: ข้อมูลรวม, ยานพาหนะ, ใบอนุญาต, ค่าบริการ, ประวัติแจ้งเหตุ, ประวัติร้องเรียน
- **ตรวจสอบยานพาหนะ** — ดูสถานะถูกยึด/ปกติ พร้อมรูปหลักฐาน
- **อัตราค่าบริการ** — 13+ รายการ จัดหมวดหมู่ (กู้ภัย / โยธา / ไฟฟ้า / จราจร / ฉุกเฉิน)
- **ร้องเรียน** + **แจ้งเหตุฉุกเฉิน** — ส่งฟอร์มพร้อมแนบรูป

### 👮 หน้าเจ้าหน้าที่ (Officer)
- **Dashboard** — สถิติการปฏิบัติงาน, ประกาศ, เจ้าหน้าที่ที่กำลังปฏิบัติหน้าที่
- **ปฏิบัติการ** — ลงเวลาเข้า-ออกเวร, ดูบัตรประจำตัวดิจิทัล
- **ค่าบริการ** — บันทึกค่าบริการ + แนบหลักฐาน
- **อัตราค่าบริการ** — จัดการ rates (commissioner)
- **จัดการเจ้าหน้าที่ / ประชาชน / ยานพาหนะ / ใบขับขี่** (commissioner)
- **เรื่องร้องเรียน / ประกาศ / การลา**

### 🎨 UI / UX
- Dark theme (navy + amber) + glass-morphism cards
- Animation (Framer Motion + CSS keyframes): fadeInUp, scaleIn, shimmer skeleton, glow-pulse
- Sticky search + tab bars
- Responsive ทุก breakpoint (mobile → desktop)

## 🏗 โครงสร้างระบบ

```
src/
├── components/
│   ├── animations/        # MotionWrappers, PageTransition
│   ├── layout/            # RoleGuard
│   └── ui/                # shadcn/ui primitives
├── hooks/                 # useAuth, useRole, useQueryProvider
├── lib/
│   ├── api/               # TanStack Query hooks (officers, dutyLogs, vehicles, ...)
│   ├── realtime/          # useRealtimeSubscription
│   ├── AuthContext.tsx
│   ├── crypto.ts          # password hashing
│   ├── jsonDb.ts          # localStorage mock (replicates Supabase API)
│   ├── supabase.ts        # auto-detect json|supabase mode
│   ├── storage.ts
│   └── types.ts           # Domain types
├── pages/
│   ├── officer/           # 11 officer pages
│   └── public/            # 6 public pages
├── data/seed.ts           # JSON mode seed
├── App.tsx
├── main.tsx
└── index.css
supabase/
└── migrations/            # SQL สำหรับ Supabase mode
    ├── 0001_init.sql
    ├── 0002_rls.sql
    ├── 0003_realtime.sql
    ├── 0004_storage.sql
    └── 0005_default_service_rates.sql
```

## 🚀 เริ่มใช้งาน

### Dev (JSON mode — ไม่ต้อง Supabase)
```bash
pnpm install
pnpm dev
```
เปิด http://localhost:3000

Login: `admin` / `admin1234`

### Production (Supabase mode)
ดูรายละเอียดที่ [`supabase/README.md`](./supabase/README.md)

## 🧰 Stack

- **Vite 7** + **React 19** + **TypeScript 5**
- **Tailwind CSS v4** (custom navy/amber theme)
- **shadcn/ui** (Radix UI primitives ครบเซ็ต)
- **TanStack Query v5** (caching + realtime invalidation)
- **Framer Motion** (transitions, stagger)
- **wouter** (lightweight routing)
- **lucide-react** (icons)
- **zod** (validation)
- **Supabase** (optional — Postgres/Auth/Realtime/Storage)

## 🔐 Roles (3 ระดับ)

| `rank` | ชื่อไทย | สิทธิ์ |
|---|---|---|
| `commissioner` | หัวหน้ากรมขนส่ง | ทุกอย่าง |
| `inspector` | ผู้คุมสอบกรมขนส่ง | ตรวจสอบ ลงเวลา บันทึกค่าบริการ |
| `officer` | พนักงาน | ลงเวลา ดูข้อมูล |

## 📝 License

MIT
