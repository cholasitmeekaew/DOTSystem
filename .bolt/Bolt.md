# Bolt.md — Project Rules for AI

## ทักทาย

สวัสดี! ก่อนแก้ไขอะไรในโปรเจคนี้ กรุณา:

1. อ่าน `.bolt/context.md` ก่อน (มี architecture overview, file map, conventions)
2. อ่าน `src/lib/types.ts` เพื่อเข้าใจ data models
3. อ่าน `src/lib/AuthContext.tsx` เพื่อเข้าใจ auth pattern

## กฎการเขียนโค้ด (สำคัญมาก)

### ✅ DO

- ใช้ API hooks จาก `src/lib/api/*` แทนการเรียก `supabase.from()` ตรงใน components
- ใช้ TanStack Query สำหรับ data fetching, mutations, cache
- ใช้ `useRealtimeSubscription()` จาก `src/lib/realtime/` สำหรับ live updates
- ใช้ shadcn/ui components จาก `src/components/ui/*`
- ใช้ types จาก `src/lib/types.ts` ห้าม cast `any` หรือ `as unknown as` ถ้าไม่จำเป็น
- ใช้ `useAuth()` hook ทุกครั้งที่ต้องการข้อมูล user/role
- เขียน UI labels เป็น **ภาษาไทย**
- เพิ่ม audit log ทุกครั้งที่ action สำคัญ (insert ลง `audit_logs` table)

### ❌ DON'T

- ห้ามเรียก `supabase.from()` ตรงใน component — ต้องผ่าน `src/lib/api/*`
- ห้ามใช้ `useState` + `useEffect` ดึงข้อมูลเอง — ใช้ `useQuery` แทน
- ห้าม subscribe realtime ด้วย `supabase.channel()` ตรง — ใช้ `useRealtimeSubscription()`
- ห้ามสร้าง UI component ใหม่ที่มีอยู่แล้ว (button, input, dialog) — ใช้ shadcn
- ห้ามเช็ค role ด้วย `officer.rank === 'commissioner'` ในหลายที่ — ใช้ `useAuth().isCommissioner` หรือ `<RoleGuard>`
- ห้ามแก้ `src/lib/jsonDb.ts` เว้นแต่จะเพิ่ม query operator ใหม่ (ส่วนนี้ replicate Supabase API)
- ห้ามลบหรือเปลี่ยน schema ของ `seedData` (backward compatibility กับ localStorage ของ user)

## Patterns ที่ใช้บ่อย

### 1) เพิ่ม API hook ใหม่

```ts
// src/lib/api/announcements.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabase';
import { isJsonMode } from '../supabase';
import type { Announcement } from '../types';

export const useAnnouncements = () =>
  useQuery({
    queryKey: ['announcements'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('announcements')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as Announcement[];
    },
  });

export const useCreateAnnouncement = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Omit<Announcement, 'id' | 'created_at' | 'updated_at'>) => {
      const { data, error } = await supabase
        .from('announcements')
        .insert(input)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['announcements'] }),
  });
};
```

### 2) Realtime subscription

```tsx
// ใน component
useRealtimeSubscription('announcements', (payload) => {
  queryClient.invalidateQueries({ queryKey: ['announcements'] });
});
```

### 3) Role guard

```tsx
<RoleGuard roles={['commissioner']}>
  <DangerousAction />
</RoleGuard>
```

### 4) Form with validation

```tsx
const form = useForm<z.infer<typeof schema>>({
  resolver: zodResolver(schema),
});
```

## โครงสร้างไฟล์เมื่อเพิ่มฟีเจอร์ใหม่

1. Types ใน `src/lib/types.ts` (ถ้ามี entity ใหม่)
2. API hooks ใน `src/lib/api/<entity>.ts`
3. Page ใน `src/pages/officer/<PageName>.tsx`
4. เพิ่ม nav item ใน `src/components/OfficerLayout.tsx`
5. เพิ่ม route ใน `src/App.tsx` (ถ้าจำเป็น)
6. เพิ่ม permission check ใน `App.tsx` (commissionerOnlyPages array)
7. เพิ่ม seed ใน `src/data/seed.ts` (ถ้ามี table ใหม่)
8. เขียน migration ใน `supabase/migrations/00xx_*.sql` (สำหรับ Supabase mode)

## คำถามที่ถามบ่อย

**Q: ทำไมไม่ใช้ Supabase ตลอด?**
A: เพราะ user ส่วนใหญ่ dev ใน Replit/Bolt แบบไม่ตั้งค่า Supabase — JSON mode ให้ทำงานได้ทันที สลับเป็น Supabase เมื่อพร้อม deploy จริง

**Q: ทำไมใช้ wouter ไม่ใช้ react-router?**
A: wouter เบากว่า (1.5KB) และ pattern ใช้ง่ายกว่า — แต่ component นี้ยังใช้ useState สำหรับ routing ใน App.tsx อยู่

**Q: audit log เก็บอะไรบ้าง?**
A: ทุก action ที่กระทบข้อมูลสำคัญ เช่น FORCE_CHECKOUT, DISABLE_LOGIN, CREATE_OFFICER ฯลฯ เก็บเป็น `action`, `target_type`, `target_id`, `performed_by`, `details: jsonb`

**Q: จะเพิ่ม Discord OAuth login ได้ไหม?**
A: ได้ แต่ต้องเพิ่มใน Supabase mode เท่านั้น (JSON mode ไม่มี OAuth server) — ใช้ `supabase.auth.signInWithOAuth({ provider: 'discord' })`

**Q: ทำไมไม่มี test?**
A: โปรเจคนี้ยังไม่มี test setup — ถ้าจะเพิ่มใช้ Vitest + Testing Library
