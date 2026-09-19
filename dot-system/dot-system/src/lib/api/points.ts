import { supabase } from '../supabase';
import { Officer, PointsLogEntry } from '../types';

export async function fetchLeaderboard(limit = 20): Promise<Officer[]> {
  // ลอง order by points ก่อน — ถ้า column ยังไม่มี fallback เป็น order by name
  const tryOrder = async (orderCol: string, ascending = false) => {
    const { data, error } = await supabase
      .from('officers')
      .select('*')
      .eq('status', 'active')
      .order(orderCol, { ascending })
      .limit(limit);
    return { data, error };
  };
  let res = await tryOrder('points', false);
  if (res.error && /column.*point(s|_period|_log)?.*does not exist/i.test(res.error.message)) {
    res = await tryOrder('name', true);
  }
  if (res.error) throw res.error;
  const list = (res.data as unknown as Officer[]) ?? [];
  return list.slice().sort((a, b) => (b.points ?? 0) - (a.points ?? 0)).slice(0, limit);
}

export interface PointsTxResult {
  officer: Officer;
  entry: PointsLogEntry;
}

export async function addOfficerPoints(
  officerId: string,
  delta: number,
  reason: string,
  actorId: string,
  actorName: string,
): Promise<PointsTxResult> {
  const { data: current, error: fetchErr } = await supabase
    .from('officers')
    .select('points, points_period, points_log')
    .eq('id', officerId)
    .single();
  if (fetchErr) throw fetchErr;

  const oldPoints = (current?.points as number) ?? 0;
  const oldLog = (current?.points_log as PointsLogEntry[]) ?? [];
  const newPoints = Math.max(0, oldPoints + delta);
  const period = (current?.points_period as string | null) ?? new Date().toISOString().slice(0, 7);

  const entry: PointsLogEntry = {
    at: new Date().toISOString(),
    by: actorId,
    by_name: actorName,
    delta,
    reason,
    balance_after: newPoints,
    period,
  };

  const { data, error } = await supabase
    .from('officers')
    .update({
      points: newPoints,
      points_log: [...oldLog, entry],
    })
    .eq('id', officerId)
    .select('*')
    .single();
  if (error) throw error;
  return { officer: data as unknown as Officer, entry };
}

export async function resetMonthlyPeriod(
  actorId: string,
  actorName: string,
): Promise<{ affected: number }> {
  const newPeriod = new Date().toISOString().slice(0, 7);

  const { data: all, error: fetchErr } = await supabase
    .from('officers')
    .select('id, points_period, points_log, points');
  if (fetchErr) throw fetchErr;

  let affected = 0;
  for (const row of (all ?? []) as Array<{ id: string; points_period: string | null; points_log: PointsLogEntry[]; points: number }>) {
    if (row.points_period && row.points_period < newPeriod) {
      const { error: upErr } = await supabase
        .from('officers')
        .update({
          points: 0,
          points_period: newPeriod,
          points_log: [
            {
              at: new Date().toISOString(),
              by: actorId,
              by_name: actorName,
              delta: -row.points,
              reason: `รีเซ็ตคะแนนประจำเดือน (เก่า: ${row.points_period})`,
              balance_after: 0,
              period: newPeriod,
            },
          ],
        })
        .eq('id', row.id);
      if (upErr) throw upErr;
      affected++;
    }
  }
  return { affected };
}
