/**
 * Audit Logs API — บันทึกการกระทำ
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabase';
import type { AuditLog } from '../types';

export const auditLogKeys = {
  all: ['audit_logs'] as const,
  list: (filter?: { action?: string; targetType?: string }) =>
    ['audit_logs', 'list', filter ?? {}] as const,
};

/**
 * บันทึก audit log — เรียกทุกครั้งที่ action สำคัญ
 */
export function useLogAudit() {
  return useMutation({
    mutationFn: async (entry: {
      action: string;
      target_type: string;
      target_id?: string | null;
      performed_by: string;
      performed_by_name: string;
      details?: Record<string, unknown>;
    }) => {
      const { data, error } = await supabase
        .from('audit_logs')
        .insert({
          action: entry.action,
          target_type: entry.target_type,
          target_id: entry.target_id ?? null,
          performed_by: entry.performed_by,
          performed_by_name: entry.performed_by_name,
          details: entry.details ?? {},
        })
        .select()
        .single();
      if (error) throw error;
      return data as AuditLog;
    },
  });
}

export function useAuditLogs(filter?: { action?: string; targetType?: string; limit?: number }) {
  return useQuery({
    queryKey: auditLogKeys.list(filter),
    queryFn: async () => {
      let q = supabase.from('audit_logs').select('*').order('created_at', { ascending: false });
      if (filter?.action) q = q.eq('action', filter.action);
      if (filter?.targetType) q = q.eq('target_type', filter.targetType);
      if (filter?.limit) q = q.limit(filter.limit);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as AuditLog[];
    },
  });
}
