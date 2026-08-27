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
      const { data, error } = await supabase
        .from('officers')
        .select('*')
        .eq('username', username.trim())
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new Error('ไม่พบบัญชีผู้ใช้นี้ในระบบ');
      const officer = data as Officer;
      if (officer.status === 'deleted' || officer.status === 'suspended') {
        throw new Error('บัญชีนี้ถูกระงับหรือลบออกจากระบบ กรุณาติดต่อหัวหน้ากรม');
      }
      if (officer.password_hash !== hash) {
        throw new Error('รหัสผ่านไม่ถูกต้อง');
      }
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
