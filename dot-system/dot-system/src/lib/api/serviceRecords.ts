/**
 * Service Records API — บันทึกค่าบริการ
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabase';
import type { ServiceRecord, ServiceStatus } from '../types';

export const serviceRecordKeys = {
  all: ['service_records'] as const,
  list: (filter?: { status?: ServiceStatus; officerId?: string; limit?: number }) =>
    ['service_records', 'list', filter ?? {}] as const,
  recent: (limit: number) => ['service_records', 'recent', limit] as const,
};

export function useServiceRecords(filter?: { status?: ServiceStatus; officerId?: string; limit?: number }) {
  return useQuery({
    queryKey: serviceRecordKeys.list(filter),
    queryFn: async () => {
      let q = supabase
        .from('service_records')
        .select('*')
        .order('created_at', { ascending: false });
      if (filter?.status) q = q.eq('status', filter.status);
      if (filter?.officerId) q = q.eq('officer_id', filter.officerId);
      if (filter?.limit) q = q.limit(filter.limit);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as ServiceRecord[];
    },
  });
}

export function useCreateServiceRecord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Omit<ServiceRecord, 'id' | 'created_at' | 'updated_at'>) => {
      const { data, error } = await supabase
        .from('service_records')
        .insert(input)
        .select()
        .single();
      if (error) throw error;
      return data as ServiceRecord;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: serviceRecordKeys.all }),
  });
}

export function useUpdateServiceRecord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<ServiceRecord> }) => {
      const { data, error } = await supabase
        .from('service_records')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data as ServiceRecord;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: serviceRecordKeys.all }),
  });
}

export function useDeleteServiceRecord() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('service_records').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: serviceRecordKeys.all }),
  });
}
