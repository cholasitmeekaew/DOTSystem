/**
 * useRealtimeSubscription — subscribe table changes
 *
 * ทำงานได้ทั้ง Supabase จริง และ JSON mode (jsonDb มี realtime bus ในตัว)
 *
 * @example
 *   useRealtimeSubscription('duty_logs', () => {
 *     queryClient.invalidateQueries({ queryKey: ['duty_logs'] });
 *   });
 */
import { useEffect } from 'react';
import { supabase } from '../supabase';

export type RealtimeEvent = 'INSERT' | 'UPDATE' | 'DELETE' | '*';

export function useRealtimeSubscription(
  table: string,
  onChange: (event: RealtimeEvent, payload: unknown) => void,
  events: RealtimeEvent | RealtimeEvent[] = '*',
  filter?: string,
) {
  useEffect(() => {
    const eventList = Array.isArray(events) ? events : [events];
    const channel = supabase
      .channel(`rt_${table}_${Math.random().toString(36).slice(2, 8)}`)
      .on(
        // @ts-expect-error — supabase typing for jsonDb client is loose
        'postgres_changes',
        { event: eventList.join(','), schema: 'public', table, filter },
        (payload: { eventType: string; new: unknown; old: unknown }) => {
          onChange((payload.eventType as RealtimeEvent) ?? '*', payload);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, filter]);
}

/**
 * Subscribe หลาย table พร้อมกัน แล้ว invalidate queries
 */
export function useRealtimeInvalidate(
  table: string,
  queryKeysToInvalidate: readonly (readonly unknown[])[],
  events: RealtimeEvent | RealtimeEvent[] = '*',
  filter?: string,
) {
  useEffect(() => {
    const eventList = Array.isArray(events) ? events : [events];
    const channel = supabase
      .channel(`rt_inv_${table}_${Math.random().toString(36).slice(2, 8)}`)
      .on(
        // @ts-expect-error — see above
        'postgres_changes',
        { event: eventList.join(','), schema: 'public', table, filter },
        () => {
          // import dynamically to avoid circular dep
          import('@tanstack/react-query').then(({ useQueryClient }) => {
            const qc = useQueryClient();
            for (const k of queryKeysToInvalidate) {
              qc.invalidateQueries({ queryKey: k as unknown[] });
            }
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, filter, JSON.stringify(queryKeysToInvalidate)]);
}
