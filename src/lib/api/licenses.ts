/**
 * Licenses API — ใบขับขี่
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabase';
import type { License } from '../types';

export const licenseKeys = {
  all: ['licenses'] as const,
  list: (filter?: { citizenId?: string; status?: string; robloxUsername?: string }) =>
    ['licenses', 'list', filter ?? {}] as const,
  byId: (id: string) => ['licenses', 'byId', id] as const,
};

export function useLicenses(filter?: { citizenId?: string; status?: string; robloxUsername?: string }) {
  return useQuery({
    queryKey: licenseKeys.list(filter),
    queryFn: async () => {
      let q = supabase.from('licenses').select('*').order('created_at', { ascending: false });
      if (filter?.citizenId) q = q.eq('citizen_id', filter.citizenId);
      if (filter?.status) q = q.eq('status', filter.status);
      if (filter?.robloxUsername) q = q.ilike('roblox_username', `%${filter.robloxUsername}%`);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as License[];
    },
  });
}

export function useCreateLicense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Omit<License, 'id' | 'created_at' | 'updated_at'>) => {
      const { data, error } = await supabase
        .from('licenses')
        .insert(input)
        .select()
        .single();
      if (error) throw error;
      return data as License;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: licenseKeys.all }),
  });
}

export function useUpdateLicense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<License> }) => {
      const { data, error } = await supabase
        .from('licenses')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data as License;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: licenseKeys.all });
      qc.invalidateQueries({ queryKey: licenseKeys.byId(data.id) });
    },
  });
}
