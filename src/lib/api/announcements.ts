/**
 * Announcements API — ประกาศ
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabase';
import type { Announcement } from '../types';

export const announcementKeys = {
  all: ['announcements'] as const,
  recent: (limit: number) => ['announcements', 'recent', limit] as const,
};

export function useAnnouncements(limit?: number) {
  return useQuery({
    queryKey: announcementKeys.recent(limit ?? 100),
    queryFn: async () => {
      let q = supabase
        .from('announcements')
        .select('*')
        .order('is_pinned', { ascending: false })
        .order('created_at', { ascending: false });
      if (limit) q = q.limit(limit);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Announcement[];
    },
  });
}

export function useCreateAnnouncement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Omit<Announcement, 'id' | 'created_at' | 'updated_at'>) => {
      const { data, error } = await supabase
        .from('announcements')
        .insert(input)
        .select()
        .single();
      if (error) throw error;
      return data as Announcement;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: announcementKeys.all }),
  });
}

export function useUpdateAnnouncement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Announcement> }) => {
      const { data, error } = await supabase
        .from('announcements')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data as Announcement;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: announcementKeys.all }),
  });
}

export function useDeleteAnnouncement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('announcements').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: announcementKeys.all }),
  });
}
