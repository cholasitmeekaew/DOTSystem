/**
 * Auth API — login / session
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabase';
import { hashPassword } from '../crypto';
import type { Officer } from '../types';

export const authKeys = {
  current: ['auth', 'current'] as const,
};

/**
 * Login — เช็ค username + password hash ตรงกับ table officers
 * ทำงานทั้ง JSON mode และ Supabase mode (query API เดียวกัน)
 */
export function useLogin() {
  return useMutation({
    mutationFn: async ({
      username,
      password,
    }: {
      username: string;
      password: string;
    }): Promise<Officer> => {
      const hash = await hashPassword(password);

      // ตรวจรหัสผ่านฝั่งฐานข้อมูลผ่าน login_officer()
      //
      // เดิมดึง password_hash ทั้งตารางมาเทียบในเบราว์เซอร์
      // แปลว่า anon ก็ดาวน์โหลด hash ของทุกคนได้ (แก้ใน migration 0043)
      // ตอนนี้ client ไม่เห็น hash ใด ๆ และ RPC คืน null
      // ทั้งกรณี username ไม่มีและรหัสผิด เพื่อไม่ให้ผู้โจมตีรู้ว่ามีบัญชีนี้อยู่
      const { data, error } = await supabase.rpc('login_officer', {
        p_username: username.trim(),
        p_password_hash: hash,
      });
      if (error) throw new Error(error.message);
      if (!data) throw new Error('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
      const officer = data as unknown as Officer;

      // บันทึกประวัติการเข้าสู่ระบบ (เวลา/IP/อุปกรณ์) — ไม่ block การล็อกอินถ้าล้มเหลว
      void supabase.rpc('log_officer_login', {
        p_officer_id: officer.id,
        p_user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      }).then(() => undefined, () => undefined);

      return officer;
    },
  });
}

/**
 * ดึง officer by id — ใช้กรณี refresh session
 */
export function useOfficerById(id: string | null | undefined) {
  return useQuery({
    queryKey: ['officers', 'byId', id ?? ''],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('officers')
        .select('*')
        .eq('id', id!)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as Officer | null;
    },
  });
}
