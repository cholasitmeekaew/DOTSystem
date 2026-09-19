/**
 * Service Rates API — อัตราค่าบริการ
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabase';
import type { ServiceRate } from '../types';

export const serviceRateKeys = {
  all: ['service_rates'] as const,
  list: () => ['service_rates', 'list'] as const,
  active: () => ['service_rates', 'active'] as const,
};

export function useServiceRates(onlyActive = false) {
  return useQuery({
    queryKey: onlyActive ? serviceRateKeys.active() : serviceRateKeys.list(),
    queryFn: async () => {
      let q = supabase.from('service_rates').select('*').order('category').order('name');
      if (onlyActive) q = q.eq('is_active', true);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as ServiceRate[];
    },
  });
}

export function useCreateServiceRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Omit<ServiceRate, 'id' | 'created_at' | 'updated_at'>) => {
      const { data, error } = await supabase
        .from('service_rates')
        .insert(input)
        .select()
        .single();
      if (error) throw error;
      return data as ServiceRate;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: serviceRateKeys.all }),
  });
}

export function useUpdateServiceRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<ServiceRate> }) => {
      const { data, error } = await supabase
        .from('service_rates')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data as ServiceRate;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: serviceRateKeys.all }),
  });
}

export function useDeleteServiceRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('service_rates').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: serviceRateKeys.all }),
  });
}
