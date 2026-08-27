/**
 * Complaints API — เรื่องร้องเรียน
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabase';
import type { Complaint } from '../types';

export const complaintKeys = {
  all: ['complaints'] as const,
  list: (status?: string) => ['complaints', 'list', status ?? 'all'] as const,
};

export function useComplaints(status?: string) {
  return useQuery({
    queryKey: complaintKeys.list(status),
    queryFn: async () => {
      let q = supabase.from('complaints').select('*').order('created_at', { ascending: false });
      if (status) q = q.eq('status', status);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Complaint[];
    },
  });
}

export function useCreateComplaint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Omit<Complaint, 'id' | 'created_at'>) => {
      const { data, error } = await supabase
        .from('complaints')
        .insert(input)
        .select()
        .single();
      if (error) throw error;
      return data as Complaint;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: complaintKeys.all }),
  });
}

export function useUpdateComplaintStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { data, error } = await supabase
        .from('complaints')
        .update({ status })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data as Complaint;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: complaintKeys.all }),
  });
}
