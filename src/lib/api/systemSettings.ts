/**
 * System Settings API — ตั้งค่าระบบ (login_enabled, duty_system_enabled)
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabase';
import type { SystemSettings } from '../types';

export const settingsKeys = {
  all: ['system_settings'] as const,
  current: () => ['system_settings', 'current'] as const,
};

export function useSystemSettings() {
  return useQuery({
    queryKey: settingsKeys.current(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('system_settings')
        .select('*')
        .eq('id', 1)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as SystemSettings | null;
    },
  });
}

export function useUpdateSystemSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      patch,
      updatedBy,
      updatedByName,
    }: {
      patch: Partial<SystemSettings>;
      updatedBy: string;
      updatedByName: string;
    }) => {
      const { data, error } = await supabase
        .from('system_settings')
        .update({
          ...patch,
          updated_at: new Date().toISOString(),
          updated_by: updatedBy,
          updated_by_name: updatedByName,
        })
        .eq('id', 1)
        .select()
        .single();
      if (error) throw error;
      return data as SystemSettings;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: settingsKeys.all }),
  });
}
