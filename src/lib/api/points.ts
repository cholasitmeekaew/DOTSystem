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

/* =============================================================
 * Kill Switch: system_settings.auto_points_enabled
 * -------------------------------------------------------------
 * false → หยุดการคำนวณคะแนนอัตโนมัติทั้งหมดทันที
 *         (หัวหน้ากรมยังให้/หักคะแนนเองผ่าน addOfficerPoints ได้ตามปกติ)
 * อ่านค่าไม่ได้ หรือคอลัมน์ยังไม่มี → ถือว่าปิด เพื่อไม่ให้คะแนนที่
 * ยังไม่ได้อนุมัติโดยอัตโนมัติ
 * ============================================================= */
export async function isAutoPointsEnabled(): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('system_settings')
      .select('auto_points_enabled')
      .eq('id', 1)
      .maybeSingle();
    if (error) return false;
    // null/undefined = คอลัมน์ยังไม่มี → ปิดไว้
    return (data as { auto_points_enabled?: boolean } | null)?.auto_points_enabled === true;
  } catch {
    return false;
  }
}

/**
 * ให้คะแนนอัตโนมัติ — ผ่าน kill switch ก่อนเสมอ
 * ใช้แทนการเรียก addOfficerPoints ตรง ๆ ในทุกจุดที่คะแนนถูกคำนวณอัตโนมัติ
 */
export async function addAutomaticPoints(
  officerId: string,
  delta: number,
  reason: string,
  actorId: string,
  actorName: string,
): Promise<PointsTxResult | null> {
  if (!(await isAutoPointsEnabled())) return null;
  return addOfficerPoints(officerId, delta, reason, actorId, actorName);
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

  // jsonDb (โหมด offline) ไม่คืนแถวหลัง update → single() จะได้ PGRST116
  // ถือว่าสำเร็จได้ เพราะ entry ถูกคำนวณจากค่าที่อ่านมาแล้ว
  if (error && error.code !== 'PGRST116') throw error;

  return {
    officer: (data as unknown as Officer) ?? ({
      id: officerId,
      points: newPoints,
      points_period: period,
      points_log: [...oldLog, entry],
    } as unknown as Officer),
    entry,
  };
}

/**
 * ลบประวัติคะแนน 1 รายการ (ตาม index ใน points_log ที่เก็บไว้)
 * แล้วย้อนยอดคงเหลือกลับ (กันติดลบ) — ใช้เมื่อบันทึกผิด
 */
export async function deleteOfficerPointsLog(
  officerId: string,
  logIndex: number,
): Promise<Officer> {
  const { data: current, error: fetchErr } = await supabase
    .from('officers')
    .select('points, points_log')
    .eq('id', officerId)
    .single();
  if (fetchErr) throw fetchErr;

  const oldPoints = (current?.points as number) ?? 0;
  const oldLog = ((current?.points_log as PointsLogEntry[]) ?? []).slice();
  if (logIndex < 0 || logIndex >= oldLog.length) {
    throw new Error('ไม่พบประวัติรายการนี้แล้ว');
  }
  const [removed] = oldLog.splice(logIndex, 1);
  const newPoints = Math.max(0, oldPoints - (removed?.delta ?? 0));

  const { data, error } = await supabase
    .from('officers')
    .update({ points: newPoints, points_log: oldLog })
    .eq('id', officerId)
    .select('*')
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return (data as unknown as Officer) ?? ({ id: officerId, points: newPoints } as unknown as Officer);
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
