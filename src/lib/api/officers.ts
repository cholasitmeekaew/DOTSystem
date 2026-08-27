/**
 * Officers API — จัดการข้อมูลเจ้าหน้าที่
 *
 * ทุก page ที่ต้องดึง officers ให้ใช้ hooks ในไฟล์นี้
 * แทนการเรียก supabase.from('officers') ตรง
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabase';
import type { Officer, OfficerStatus, Department } from '../types';

export const officerKeys = {
  all: ['officers'] as const,
  list: (filter?: { status?: OfficerStatus; department?: Department }) =>
    ['officers', 'list', filter ?? {}] as const,
  byId: (id: string) => ['officers', 'byId', id] as const,
  onDuty: () => ['officers', 'onDuty'] as const,
};

export function useOfficers(filter?: { status?: OfficerStatus; department?: Department }) {
  return useQuery({
    queryKey: officerKeys.list(filter),
    queryFn: async () => {
      let q = supabase.from('officers').select('*').order('name');
      if (filter?.status) q = q.eq('status', filter.status);
      if (filter?.department) q = q.eq('department', filter.department);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Officer[];
    },
  });
}

export function useOnDutyOfficers() {
  return useQuery({
    queryKey: officerKeys.onDuty(),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('officers')
        .select('*')
        .eq('is_on_duty', true)
        .eq('status', 'active')
        .order('name');
      if (error) throw error;
      return (data ?? []) as Officer[];
    },
  });
}

export function useOfficer(id: string | null | undefined) {
  return useQuery({
    queryKey: officerKeys.byId(id ?? ''),
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

export function useCreateOfficer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Omit<Officer, 'id' | 'created_at' | 'updated_at'>) => {
      const { data, error } = await supabase
        .from('officers')
        .insert(input)
        .select()
        .single();
      if (error) throw error;
      return data as Officer;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: officerKeys.all });
    },
  });
}

export function useUpdateOfficer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Officer> }) => {
      const { data, error } = await supabase
        .from('officers')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data as Officer;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: officerKeys.all });
      qc.invalidateQueries({ queryKey: officerKeys.byId(data.id) });
    },
  });
}

export function useDeleteOfficer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('officers')
        .update({ status: 'deleted', updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: officerKeys.all }),
  });
}
