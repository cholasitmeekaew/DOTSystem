/**
 * Officer Leaves API — จัดการการลา
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabase';
import type { OfficerLeave, LeaveStatus } from '../types';

export const leaveKeys = {
  all: ['officer_leaves'] as const,
  list: (status?: LeaveStatus) => ['officer_leaves', 'list', status ?? 'all'] as const,
  byOfficer: (officerId: string) => ['officer_leaves', 'byOfficer', officerId] as const,
};

export function useOfficerLeaves(status?: LeaveStatus) {
  return useQuery({
    queryKey: leaveKeys.list(status),
    queryFn: async () => {
      let q = supabase
        .from('officer_leaves')
        .select('*')
        .order('created_at', { ascending: false });
      if (status) q = q.eq('status', status);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as OfficerLeave[];
    },
  });
}

export function useCreateLeave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Omit<OfficerLeave, 'id' | 'created_at' | 'updated_at'>) => {
      const { data, error } = await supabase
        .from('officer_leaves')
        .insert(input)
        .select()
        .single();
      if (error) throw error;
      return data as OfficerLeave;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: leaveKeys.all }),
  });
}

export function useReviewLeave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      status,
      reviewedBy,
      reviewedByName,
      reviewNote,
    }: {
      id: string;
      status: LeaveStatus;
      reviewedBy: string;
      reviewedByName: string;
      reviewNote?: string;
    }) => {
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from('officer_leaves')
        .update({
          status,
          reviewed_by: reviewedBy,
          reviewed_by_name: reviewedByName,
          reviewed_at: now,
          review_note: reviewNote ?? null,
          updated_at: now,
        })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data as OfficerLeave;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: leaveKeys.all }),
  });
}
