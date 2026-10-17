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

/**
 * เพดานคะแนนสูงสุด — ต้องตรงกับ CHECK constraint ใน migration 0037
 *
 * ไม่มีเพดานล่างแล้ว: หักเกินคงเหลือได้เต็มจำนวนและเกินเป็นคะแนนติดลบ
 * (คะแนนค้างหัก) ทุกครั้งที่ได้คะแนนใหม่ หนี้จะถูกกู้คืนหักก่อนโดยอัตโนมัติ
 * ตอนก่อนหน้านี้ระบบหยุดที่ 0 ทำให้ "โดนหักแต่ไม่มีผล" หนี้หายเงียบ ๆ
 */
export const POINTS_MAX = 100000;

/** คะแนนติดลบ = ยังต้องกู้คืนให้ถึง 0 */
export function pointsDebt(points: number): number {
  return points < 0 ? -points : 0;
}

/**
 * สวิตช์ "บังคับส่งรายงานปฏิบัติงาน" เปิดอยู่ไหม
 *
 * ถ้าปิด = ไม่มีระบบรายงาน → ห้ามหักคะแนนเพราะ "ไม่ส่งรายงาน"
 * เพราะเจ้าหน้าที่ไม่ได้ทำผิดอะไร ระบบไม่ได้เปิดให้ส่ง
 */
export async function isWorkReportsEnabled(): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('system_settings')
      .select('work_reports_enabled')
      .eq('id', 1)
      .maybeSingle();
    if (error) return false;   // อ่านไม่ได้ = ปิดไว้เพื่อความปลอดภัย ไม่หักผิดคน
    return (data as { work_reports_enabled?: boolean } | null)?.work_reports_enabled === true;
  } catch {
    return false;
  }
}

export function clampPoints(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(POINTS_MAX, Math.round(value));
}

/**
 * ฟังก์ชัน atomic ในฐานข้อมูลมีอยู่จริงไหม
 *
 * ตรวจครั้งเดียวแล้วจำไว้ เพราะถ้ายังไม่ได้รัน migration 0042
 * จะได้ error ทุกครั้งที่ให้คะแนน ซึ่งช้าและทำให้ UI เหมือนค้าง
 */
let atomicRpcAvailable: boolean | null = null;

async function hasAtomicPointsRpc(): Promise<boolean> {
  if (atomicRpcAvailable !== null) return atomicRpcAvailable;
  try {
    // ต้องส่งพารามิเตอร์ครบทุกตัว (รวม p_points_max)
    // PostgREST จับคู่ฟังก์ชันจากชุดพารามิเตอร์ที่ส่งมา
    // ถ้าส่งไม่ครบอาจได้ PGRST202 แล้วเข้าใจผิดว่า "ยังไม่มีฟังก์ชัน"
    // → ใช้โค้ดเดิมที่ไม่ atomic ไปตลอดโดยไม่มีใครรู้
    const { error } = await supabase.rpc('add_officer_points', {
      p_officer_id: '00000000-0000-0000-0000-000000000000',
      p_delta: 0,
      p_reason: '',
      p_actor_id: '',
      p_actor_name: '',
      p_points_max: POINTS_MAX,
    });
    // ไม่มีฟังก์ชัน -> PGRST202 / 404 / 42883
    const missing = !error
      || error.code === 'PGRST202'
      || error.code === '42883'
      || /not found|does not exist|找不到|ไม่พบฟังก์ชัน/i.test(error.message);
    atomicRpcAvailable = !missing;
  } catch {
    atomicRpcAvailable = false;
  }
  return atomicRpcAvailable;
}

/** ล้าง cache ใช้ตอนทดสอบหรือหลังรัน migration เสร็จ */
export function resetAtomicPointsRpcCache(): void {
  atomicRpcAvailable = null;
}

export async function addOfficerPoints(
  officerId: string,
  delta: number,
  reason: string,
  actorId: string,
  actorName: string,
): Promise<PointsTxResult> {
  // ถ้าฐานข้อมูลรองรับฟังก์ชัน atomic (migration 0042) ให้ใช้
  // ทำงานข้างใน DB เพื่อล็อกแถว กันสองคนหักพร้อมกันแล้วคะแนนทับกัน
  if (await hasAtomicPointsRpc()) {
    const { data, error } = await supabase.rpc('add_officer_points', {
      p_officer_id: officerId,
      p_delta: delta,
      p_reason: reason,
      p_actor_id: actorId,
      p_actor_name: actorName,
      p_points_max: POINTS_MAX,
    });
    if (error) throw error;
    const out = data as { officer: unknown; entry: PointsLogEntry } | null;
    if (out?.officer) {
      return { officer: out.officer as Officer, entry: out.entry };
    }
  }

  // ทางสำรอง (ยังไม่ได้รัน migration 0042 หรือโหมด json)
  // หมายเหตุ: ทางนี้ยังมีความเสี่ยง lost update — ให้รัน 0042 เพื่อปิดช่องโหว่
  const { data: current, error: fetchErr } = await supabase
    .from('officers')
    .select('points, points_period, points_log')
    .eq('id', officerId)
    .single();
  if (fetchErr) throw fetchErr;

  const oldPoints = (current?.points as number) ?? 0;
  const oldLog = (current?.points_log as PointsLogEntry[]) ?? [];
  const newPoints = clampPoints(oldPoints + delta);
  // บันทึก "ค่าที่ให้จริง" ไม่ใช่ค่าที่ขอ เพื่อให้ balance_after สอดคล้องเสมอ
  const appliedDelta = newPoints - oldPoints;
  // หักเกินคงเหลือได้เต็มจำนวน (ติดลบเป็นหนี้) → ไม่ต้องจำกัดที่ 0 แล้ว
  // จึงเหลือกรณีเดียวที่ต้องเตือน คือการให้คะแนนเกินเพดานบน
  const clampedNote = appliedDelta !== delta && delta > 0
    ? ` (ขอ +${delta} แต่ถูกจำกัดที่ ${POINTS_MAX.toLocaleString()})`
    : '';
  const period = (current?.points_period as string | null) ?? new Date().toISOString().slice(0, 7);

  const entry: PointsLogEntry = {
    at: new Date().toISOString(),
    by: actorId,
    by_name: actorName,
    delta: appliedDelta,
    reason: reason + clampedNote,
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
  const newPoints = clampPoints(oldPoints - (removed?.delta ?? 0));

  const { data, error } = await supabase
    .from('officers')
    .update({ points: newPoints, points_log: oldLog })
    .eq('id', officerId)
    .select('*')
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return (data as unknown as Officer) ?? ({ id: officerId, points: newPoints } as unknown as Officer);
}

/* =============================================================
 * รีเซ็ตคะแนนสะสมประจำเดือน
 * ============================================================= */

export type PointsResetMode =
  /** เฉพาะคนที่ยังไม่ได้เข้างวดปัจจุบัน (งวดเก่ากว่า หรือไม่มีค่างวดเลย) */
  | 'stale'
  /** ทุกคน ไม่ว่างวดไหน */
  | 'all';

export interface PointsResetResult {
  mode: PointsResetMode;
  period: string;
  /** จำนวนคนที่รีเซ็ต */
  affected: number;
  /** จำนวนคนที่ข้าม (ไม่เข้าเงื่อนไข) */
  skipped: number;
  /** ผู้ที่รีเซ็ตสำเร็จ */
  names: string[];
  /** ผู้ที่รีเซ็ตไม่สำเร็จ */
  failures: Array<{ name: string; message: string }>;
}

function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7);
}

/** นับจำนวนคนที่จะถูกรีเซ็ตล่วงหน้า (เอาไว้แสดงในกล่องยืนยัน) */
export async function previewPointsReset(mode: PointsResetMode = 'all'): Promise<{
  period: string;
  total: number;
  affected: number;
  skipped: number;
  pointsBefore: number;
}> {
  const period = currentPeriod();
  const { data, error } = await supabase
    .from('officers')
    .select('id, name, points, points_period, status');
  if (error) throw error;

  const rows = (data ?? []) as Array<{
    id: string; name: string; points: number; points_period: string | null; status: string;
  }>;

  let affected = 0;
  let skipped = 0;
  let pointsBefore = 0;

  for (const row of rows) {
    if (row.status === 'deleted') { skipped += 1; continue; }
    const isStale = !row.points_period || row.points_period < period;
    const target = mode === 'all' || isStale;
    if (target) { affected += 1; pointsBefore += Number(row.points) || 0; }
    else skipped += 1;
  }

  return { period, total: rows.length, affected, skipped, pointsBefore };
}

/**
 * รีเซ็ตคะแนนสะสมเป็น 0
 *
 * ข้อผิดพลาดที่เคยทำให้ปุ่มกดแล้วไม่มีอะไรเกิดขึ้น:
 *   1. เงื่อนไขเดิม `points_period < เดือนนี้` เป็น false เกือบเสมอ
 *      เพราะคอลัมน์ points_period มี default = เดือนปัจจุบัน → ไม่มีใครเข้าเงื่อนไข
 *   2. คนที่ points_period IS NULL ถูกข้ามไปเฉย ๆ
 *   3. points_log ถูก "แทนที่" ทั้งประวัติทิ้ง แทนที่จะต่อท้าย
 */
export async function resetMonthlyPeriod(
  actorId: string,
  actorName: string,
  mode: PointsResetMode = 'all',
): Promise<PointsResetResult> {
  const period = currentPeriod();

  const { data, error: fetchErr } = await supabase
    .from('officers')
    .select('id, name, points, points_period, points_log, status');
  if (fetchErr) throw fetchErr;

  const rows = (data ?? []) as Array<{
    id: string;
    name: string;
    points: number | null;
    points_period: string | null;
    points_log: PointsLogEntry[] | null;
    status: string;
  }>;

  const result: PointsResetResult = {
    mode, period, affected: 0, skipped: 0, names: [], failures: [],
  };

  for (const row of rows) {
    if (row.status === 'deleted') { result.skipped += 1; continue; }

    const isStale = !row.points_period || row.points_period < period;
    if (mode === 'stale' && !isStale) { result.skipped += 1; continue; }

    const oldPoints = clampPoints(Number(row.points) || 0);
    const oldLog = (row.points_log as PointsLogEntry[]) ?? [];
    const entry: PointsLogEntry = {
      at: new Date().toISOString(),
      by: actorId,
      by_name: actorName,
      delta: -oldPoints,
      reason: mode === 'all'
        ? `รีเซ็ตคะแนนทั้งหมดเป็น 0 (งวดก่อน: ${row.points_period ?? 'ไม่ระบุ'})`
        : `รีเซ็ตคะแนนประจำเดือน (งวดก่อน: ${row.points_period ?? 'ไม่ระบุ'})`,
      balance_after: 0,
      period,
    };

    // ต่อท้ายประวัติเดิม ไม่ลบทิ้ง — คง audit trail ไว้
    const { error: upErr } = await supabase
      .from('officers')
      .update({
        points: 0,
        points_period: period,
        points_log: [...oldLog, entry],
      })
      .eq('id', row.id);

    if (upErr) {
      result.failures.push({ name: row.name, message: upErr.message });
    } else {
      result.affected += 1;
      result.names.push(row.name);
    }
  }

  return result;
}

/* =============================================================
 * ล้างประวัติคะแนนทั้งหมด (ของทุกคน) — การกระทำแบบย้อนกลับไม่ได้
 * ============================================================= */

export type ClearHistoryMode =
  /** ล้างประวัติอย่างเดียว คงยอดคะแนนไว้ */
  | 'log_only'
  /** ล้างประวัติ + รีเซ็ตยอดคะแนนเป็น 0 */
  | 'full';

export interface ClearHistoryPreview {
  total: number;
  /** คนที่มีประวัติอยู่จริง */
  withLog: number;
  /** จำนวนรายการประวัติทั้งหมดที่จะถูกลบ */
  entries: number;
  pointsTotal: number;
}

export async function previewClearHistory(): Promise<ClearHistoryPreview> {
  const { data, error } = await supabase
    .from('officers')
    .select('id, points, points_log, status');
  if (error) throw error;

  const rows = (data ?? []) as Array<{
    points: number | null;
    points_log: PointsLogEntry[] | null;
    status: string;
  }>;

  let withLog = 0;
  let entries = 0;
  let pointsTotal = 0;

  for (const r of rows) {
    if (r.status === 'deleted') continue;
    const n = Array.isArray(r.points_log) ? r.points_log.length : 0;
    if (n > 0) withLog += 1;
    entries += n;
    pointsTotal += Number(r.points) || 0;
  }

  return { total: rows.length, withLog, entries, pointsTotal };
}

/**
 * ล้างประวัติคะแนนของทุกคน
 *  - mode 'log_only' → points_log = []  (ยอดคะแนนคงเดิม)
 *  - mode 'full'      → points_log = [] + points = 0 + points_period = งวดปัจจุบัน
 *
 * ทำทีละคนและเก็บรายคนที่ล้มเหลว ไม่หยุดกลางคัน
 */
export async function clearAllPointsHistory(
  actorId: string,
  actorName: string,
  mode: ClearHistoryMode = 'full',
): Promise<{ cleared: number; entries: number; failed: Array<{ name: string; message: string }> }> {
  const period = currentPeriod();

  const { data, error: fetchErr } = await supabase
    .from('officers')
    .select('id, name, points, points_log, status');
  if (fetchErr) throw fetchErr;

  const rows = (data ?? []) as Array<{
    id: string; name: string; points: number | null;
    points_log: PointsLogEntry[] | null; status: string;
  }>;

  const result = { cleared: 0, entries: 0, failed: [] as Array<{ name: string; message: string }> };

  for (const row of rows) {
    if (row.status === 'deleted') continue;

    const log = Array.isArray(row.points_log) ? row.points_log : [];
    if (log.length === 0 && mode === 'log_only') continue;

    // ล็อกรายการก่อนลบ เพื่อให้ตรวจสอบย้อนหลังได้จาก audit_logs
    const patch: Record<string, unknown> = { points_log: [] };
    if (mode === 'full') {
      patch.points = 0;
      patch.points_period = period;
    }

    const { error } = await supabase.from('officers').update(patch).eq('id', row.id);

    if (error) {
      result.failed.push({ name: row.name, message: error.message });
      continue;
    }

    result.cleared += 1;
    result.entries += log.length;

    if (log.length > 0 || mode === 'full') {
      await supabase.from('audit_logs').insert({
        action: mode === 'full' ? 'CLEAR_POINTS_HISTORY_AND_RESET' : 'CLEAR_POINTS_HISTORY',
        target_type: 'officer',
        target_id: row.id,
        performed_by: actorId,
        performed_by_name: actorName,
        details: {
          officer_name: row.name,
          deleted_entries: log.length,
          points_before: Number(row.points) || 0,
          mode,
        },
      });
    }
  }

  return result;
}
