/**
 * Citizens API — ฐานข้อมูลประชาชน
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabase';
import type { Citizen, CitizenStatus } from '../types';

export const citizenKeys = {
  all: ['citizens'] as const,
  list: (filter?: { status?: CitizenStatus; search?: string }) =>
    ['citizens', 'list', filter ?? {}] as const,
  byId: (id: string) => ['citizens', 'byId', id] as const,
};

export function useCitizens(filter?: { status?: CitizenStatus; search?: string }) {
  return useQuery({
    queryKey: citizenKeys.list(filter),
    queryFn: async () => {
      let q = supabase.from('citizens').select('*').order('roblox_username');
      if (filter?.status) q = q.eq('status', filter.status);
      if (filter?.search) {
        q = q.or(`roblox_username.ilike.%${filter.search}%,discord_username.ilike.%${filter.search}%`);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Citizen[];
    },
  });
}

export function useCitizen(id: string | null | undefined) {
  return useQuery({
    queryKey: citizenKeys.byId(id ?? ''),
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('citizens')
        .select('*')
        .eq('id', id!)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as Citizen | null;
    },
  });
}

export function useCreateCitizen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Omit<Citizen, 'id' | 'created_at' | 'updated_at'>) => {
      const { data, error } = await supabase
        .from('citizens')
        .insert(input)
        .select()
        .single();
      if (error) throw error;
      return data as Citizen;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: citizenKeys.all }),
  });
}

export function useUpdateCitizen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Citizen> }) => {
      const { data, error } = await supabase
        .from('citizens')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data as Citizen;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: citizenKeys.all });
      qc.invalidateQueries({ queryKey: citizenKeys.byId(data.id) });
    },
  });
}
