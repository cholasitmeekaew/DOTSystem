/**
 * Emergency Reports API — แจ้งเหตุฉุกเฉิน
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabase';
import type { EmergencyReport, EmergencyReportStatus } from '../types';

export const emergencyKeys = {
  all: ['emergency_reports'] as const,
  list: (status?: EmergencyReportStatus) => ['emergency_reports', 'list', status ?? 'all'] as const,
  byDiscord: (discord: string) => ['emergency_reports', 'byDiscord', discord] as const,
};

export function useEmergencyReports(status?: EmergencyReportStatus) {
  return useQuery({
    queryKey: emergencyKeys.list(status),
    queryFn: async () => {
      let q = supabase
        .from('emergency_reports')
        .select('*')
        .order('created_at', { ascending: false });
      if (status) q = q.eq('status', status);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as EmergencyReport[];
    },
  });
}

export function useCreateEmergencyReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Omit<EmergencyReport, 'id' | 'created_at' | 'updated_at'>) => {
      const { data, error } = await supabase
        .from('emergency_reports')
        .insert(input)
        .select()
        .single();
      if (error) throw error;
      return data as EmergencyReport;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: emergencyKeys.all }),
  });
}

export function useRespondEmergency() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      respondedBy,
      respondedByName,
    }: {
      id: string;
      respondedBy: string;
      respondedByName: string;
    }) => {
      const { data, error } = await supabase
        .from('emergency_reports')
        .update({
          status: 'responding',
          responded_by: respondedBy,
          responded_by_name: respondedByName,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data as EmergencyReport;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: emergencyKeys.all }),
  });
}

export function useResolveEmergency() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from('emergency_reports')
        .update({
          status: 'resolved',
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data as EmergencyReport;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: emergencyKeys.all }),
  });
}
