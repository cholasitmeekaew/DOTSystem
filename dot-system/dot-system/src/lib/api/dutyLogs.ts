/**
 * Duty Logs API — ลงเวลาเข้า-ออกเวร
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabase';
import type { DutyLog } from '../types';
import { officerKeys } from './officers';

export const dutyLogKeys = {
  all: ['duty_logs'] as const,
  list: (filter?: { officerId?: string; includeDeleted?: boolean }) =>
    ['duty_logs', 'list', filter ?? {}] as const,
  active: (officerId: string) => ['duty_logs', 'active', officerId] as const,
};

export function useDutyLogs(filter?: { officerId?: string; limit?: number; includeDeleted?: boolean }) {
  return useQuery({
    queryKey: dutyLogKeys.list(filter),
    queryFn: async () => {
      let q = supabase
        .from('duty_logs')
        .select('*')
        .order('clock_in', { ascending: false });
      if (filter?.officerId) q = q.eq('officer_id', filter.officerId);
      if (!filter?.includeDeleted) q = q.is('deleted_at', null);
      if (filter?.limit) q = q.limit(filter.limit);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as DutyLog[];
    },
  });
}

export function useActiveDutyLog(officerId: string | null | undefined) {
  return useQuery({
    queryKey: dutyLogKeys.active(officerId ?? ''),
    enabled: !!officerId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('duty_logs')
        .select('*')
        .eq('officer_id', officerId!)
        .is('clock_out', null)
        .is('deleted_at', null)
        .order('clock_in', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as DutyLog | null;
    },
  });
}

export function useClockIn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      officerId,
      officerName,
    }: {
      officerId: string;
      officerName: string;
    }) => {
      const now = new Date().toISOString();
      // 1) สร้าง duty_log
      const { data: log, error: logErr } = await supabase
        .from('duty_logs')
        .insert({ officer_id: officerId, officer_name: officerName, clock_in: now })
        .select()
        .single();
      if (logErr) throw logErr;
      // 2) อัพเดต officer.is_on_duty
      await supabase
        .from('officers')
        .update({ is_on_duty: true, updated_at: now })
        .eq('id', officerId);
      return log as DutyLog;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: dutyLogKeys.all });
      qc.invalidateQueries({ queryKey: officerKeys.all });
      qc.invalidateQueries({ queryKey: dutyLogKeys.active(vars.officerId) });
    },
  });
}

export function useClockOut() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      logId,
      officerId,
      forced = false,
      forcedBy,
      forcedByName,
    }: {
      logId: string;
      officerId: string;
      forced?: boolean;
      forcedBy?: string | null;
      forcedByName?: string | null;
    }) => {
      const now = new Date();
      // ดึง log ปัจจุบันเพื่อคำนวณ duration
      const { data: current } = await supabase
        .from('duty_logs')
        .select('clock_in')
        .eq('id', logId)
        .maybeSingle();
      const dur = current?.clock_in
        ? Math.round((now.getTime() - new Date(current.clock_in).getTime()) / 60000)
        : 0;
      await supabase
        .from('duty_logs')
        .update({
          clock_out: now.toISOString(),
          duration_minutes: dur,
          forced_by: forcedBy ?? null,
          forced_by_name: forcedByName ?? null,
          checkout_method: forced ? 'forced' : 'normal',
        })
        .eq('id', logId);
      await supabase
        .from('officers')
        .update({ is_on_duty: false, updated_at: now.toISOString() })
        .eq('id', officerId);
      return { durationMinutes: dur };
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: dutyLogKeys.all });
      qc.invalidateQueries({ queryKey: officerKeys.all });
      qc.invalidateQueries({ queryKey: dutyLogKeys.active(vars.officerId) });
    },
  });
}

export function useDeleteDutyLog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      deletedBy,
      deletedByName,
      reason,
    }: {
      id: string;
      deletedBy: string;
      deletedByName: string;
      reason: string;
    }) => {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from('duty_logs')
        .update({
          deleted_at: now,
          deleted_by: deletedBy,
          deleted_by_name: deletedByName,
          delete_reason: reason,
        })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: dutyLogKeys.all }),
  });
}
