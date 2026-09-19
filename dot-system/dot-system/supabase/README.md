# Supabase Setup

## 1. สร้างโปรเจค

1. ไปที่ https://supabase.com/dashboard → **New Project**
2. เลือก region ใกล้ที่สุด (Singapore)
3. ตั้ง database password → รอ provisioning (~2 นาที)

## 2. Apply migrations

ไปที่ **SQL Editor** แล้วรันทีละไฟล์ตามลำดับ:

1. `migrations/0001_init.sql` — สร้าง tables
2. `migrations/0002_rls.sql` — RLS policies
3. `migrations/0003_realtime.sql` — enable realtime
4. `migrations/0004_storage.sql` — storage buckets
5. `migrations/0005_default_service_rates.sql` — seed rates

หรือใช้ CLI:

```bash
supabase link --project-ref <your-project-id>
supabase db push
```

## 3. ตั้งค่า env

คัดลอก `.env.example` → `.env`:

```env
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-public-key>
VITE_USE_MOCK=false
```

หา URL + anon key ได้ที่ **Project Settings → API**

## 4. ตั้ง auth

ไปที่ **Authentication → Providers**:

- **Email**: เปิดไว้ (default)
- ถ้าจะใช้ Discord OAuth → เปิด Discord provider แล้วใส่ client ID/secret

## 5. ทดสอบ

```bash
npm run dev
```

เปิด http://localhost:5173 → login `admin` / `admin1234` → ตรวจสอบว่า:
- Dashboard โหลดข้อมูลจาก Postgres
- เปิด 2 tab → สร้าง service record ใน tab A → tab B เห็น realtime update
- เปลี่ยน rank ใน DB ตรง → RLS block หน้า commissioner-only

## 6. Migration ข้อมูลจาก JSON mode (ถ้ามี)

ถ้าเคยใช้ JSON mode แล้วอยากย้ายข้อมูลเข้า Supabase:

1. Export จากหน้า Dashboard → "สำรองข้อมูล (.json)"
2. แก้ไฟล์ JSON ให้ตรงกับ schema ใน `0001_init.sql`
3. Insert ผ่าน SQL Editor หรือ `supabase db remote commit`

## ตัวอย่าง query ทดสอบ

```sql
-- ดูจำนวน officer แยกตาม rank
select rank, count(*) from officers group by rank;

-- ดู service records วันนี้
select * from service_records where service_date = current_date;

-- ดู duty logs เดือนนี้
select officer_name, count(*) as shifts, sum(duration_minutes) as total_minutes
from duty_logs
where clock_in >= date_trunc('month', current_date)
  and deleted_at is null
group by officer_name
order by total_minutes desc;
```
