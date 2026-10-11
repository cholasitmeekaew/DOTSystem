/* =============================================================
 * autoPoints.ts — เครื่องยนต์ให้คะแนนอัตโนมัติ (PPS Engine)
 * -------------------------------------------------------------
 * เกณฑ์การให้คะแนน (เพิ่ม)
 *   +5   คะแนน / ชั่วโมง  เมื่อออกเวรตามปกติ        (duty_logs.duration_minutes)
 *   +10  คะแนน          เมื่อรายงานปฏิบัติงานได้รับอนุมัติ (work_reports.status='approved')
 *   +5   คะแนน          เมื่อปิดเคสค่าบริการสำเร็จ  (service_records.status='paid')
 *
 * เกณฑ์การหักคะแนน
 *   -5   ไม่เข้าเวรติดต่อกัน 1 สัปดาห์
 *   -5   ออกเวรโดยไม่ส่งรายงานปฏิบัติงาน
 *   -15  ถูกบังคับให้ออกเวร            (checkout_method='forced')
 *   -30  ถูกร้องเรียนและผลตรวจสอบเป็นจริง (complaints.status='verified')
 *
 * หลักการสำคัญ
 *   1) สวิตช์ system_settings.auto_points_enabled = false → ข้ามทุกกระบวนการอัตโนมัติ
 *      (การให้/หักคะแนนโดยหัวหน้ากรมเองในหน้า "จัดการคะแนน" ยังทำงานปกติ)
 *   2) กันให้คะแนนซ้ำด้วย points_award_marks.mark_key (UNIQUE)
 *   3) ทุกการเปลี่ยนแปลงเขียนลง officers.points_log ผ่าน addOfficerPoints()
 * ============================================================= */

import { supabase } from '../supabase';
import type {
  Officer, DutyLog, WorkReport, ServiceRecord, SystemSettings,
} from '../types';
import { addOfficerPoints } from './points';

/* ---------- เกณฑ์คะแนน ---------- */

export const AUTO_POINTS_RULES = {
  perDutyHour: 5,          // ต่อชั่วโมงที่ออกเวรปกติ
  reportApproved: 10,      // รายงานปฏิบัติงานได้รับอนุมัติ
  serviceClosed: 5,        // ปิดเคสค่าบริการ
  absenceWeek: -5,         // ไม่เข้าเวร 1 สัปดาห์
  missingReport: -5,       // ออกเวรไม่ส่งรายงาน
  forceCheckout: -15,      // ถูกบังคับออกเวร
  complaintVerified: -30,  // ร้องเรียนผลตรวจสอบเป็นจริง
} as const;

/** เรียกโดยเครื่องยนต์อัตโนมัติ (ผู้เรียกถือว่า "ระบบ") */
export const AUTO_POINTS_ACTOR = { id: 'system:auto-points', name: 'ระบบ PPS อัตโนมัติ' };

/* ---------- สวิตช์เปิด/ปิด ---------- */

export async function getSystemSettings(): Promise<SystemSettings | null> {
  const { data } = await supabase.from('system_settings').select('*').eq('id', 1).maybeSingle();
  return (data as SystemSettings | null) ?? null;
}

/**
 * ตรวจว่าเครื่องยนต์คะแนนอัตโนมัติเปิดอยู่หรือไม่
 * ถ้าอ่านค่าไม่ได้ (เช่น ยังไม่ได้ apply migration 0028) ให้ถือว่าปิดไว้
 * เพื่อไม่ให้คะแนนที่ไม่ได้อนุมัติโดยอัตโนมัติ
 */
export async function isAutoPointsEnabled(): Promise<boolean> {
  try {
    const settings = await getSystemSettings();
    // undefined = คอลัมน์ยังไม่มี → ปิดไว้เพื่อความปลอดภัย
    return settings?.auto_points_enabled === true;
  } catch {
    return false;
  }
}

/* ---------- แกนหลัก: ให้คะแนนแบบกันซ้ำ ---------- */

export interface AutoAwardResult {
  awarded: boolean;
  delta: number;
  /** เหตุผลที่ถูกข้าม (kill switch ปิด / ให้คะแนนไปแล้ว / ไม่มีคะแนน) */
  skipReason?: 'disabled' | 'duplicate' | 'zero' | 'no_officer' | 'error';
  balanceAfter?: number;
  error?: string;
}

/** เช็คว่าเคยให้คะแนนในเหตุการณ์นี้แล้วหรือยัง */
async function alreadyAwarded(markKey: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('points_award_marks')
    .select('id')
    .eq('mark_key', markKey)
    .maybeSingle();
  if (error) return false;           // ยังไม่มีตาราง/อ่านไม่ได้ → ปล่อยให้เขียนได้
  return !!data;
}

/**
 * ให้คะแนนอัตโนมัติ 1 รายการ
 * @param markKey คีย์กันซ้ำ เช่น 'dutyout:<log_id>' — ต้องไม่ซ้ำกันในระบบ
 */
export async function awardAutoPoints(params: {
  officerId: string | null | undefined;
  delta: number;
  reason: string;
  markKey: string;
}): Promise<AutoAwardResult> {
  const { officerId, delta, reason, markKey } = params;

  if (!officerId) return { awarded: false, delta, skipReason: 'no_officer' };
  if (delta === 0) return { awarded: false, delta, skipReason: 'zero' };

  if (!(await isAutoPointsEnabled())) {
    return { awarded: false, delta, skipReason: 'disabled' };
  }

  if (await alreadyAwarded(markKey)) {
    return { awarded: false, delta, skipReason: 'duplicate' };
  }

  try {
    const result = await addOfficerPoints(
      officerId,
      delta,
      reason,
      AUTO_POINTS_ACTOR.id,
      AUTO_POINTS_ACTOR.name,
    );
    // ประทับหลังให้สำเร็จเท่านั้น — ถ้าให้คะแนนไม่ได้จะไม่ข้ามรอบหน้า
    await supabase.from('points_award_marks').insert({
      mark_key: markKey,
      officer_id: officerId,
      delta,
      reason,
    });
    return {
      awarded: true,
      delta,
      balanceAfter: result.entry.balance_after,
    };
  } catch (e) {
    return { awarded: false, delta, skipReason: 'error', error: (e as Error).message };
  }
}

/* ---------- เหตุการณ์เฉพาะ ---------- */

/** +5/ชม. เมื่อออกเวรปกติ · -15 เมื่อถูกบังคับออกเวร */
export async function applyCheckoutPoints(log: DutyLog): Promise<AutoAwardResult | null> {
  if (!log?.officer_id || !log.clock_out) return null;

  const forced = log.checkout_method === 'forced';

  if (forced) {
    return awardAutoPoints({
      officerId: log.officer_id,
      delta: AUTO_POINTS_RULES.forceCheckout,
      reason: `ถูกบังคับให้ออกเวร${log.forced_by_name ? ` โดย ${log.forced_by_name}` : ''}`,
      markKey: `force:${log.id}`,
    });
  }

  const minutes = Number(log.duration_minutes ?? 0);
  const hours = Math.floor(minutes / 60);
  if (hours <= 0) return null;

  return awardAutoPoints({
    officerId: log.officer_id,
    delta: hours * AUTO_POINTS_RULES.perDutyHour,
    reason: `ปฏิบัติหน้าที่ครบ ${hours} ชั่วโมง`,
    markKey: `dutyout:${log.id}`,
  });
}

/** +10 เมื่อรายงานปฏิบัติงานได้รับอนุมัติ */
export async function applyReportApprovalPoints(report: WorkReport): Promise<AutoAwardResult | null> {
  if (!report?.officer_id) return null;
  return awardAutoPoints({
    officerId: report.officer_id,
    delta: AUTO_POINTS_RULES.reportApproved,
    reason: 'รายงานปฏิบัติงานได้รับการอนุมัติ',
    markKey: `report:${report.id}`,
  });
}

/** +5 เมื่อปิดเคสค่าบริการสำเร็จ (จ่ายให้ทุกคนที่รับเคส) */
export async function applyServiceClosedPoints(
  record: ServiceRecord,
  assignedOfficerIds: string[] = [],
): Promise<AutoAwardResult[]> {
  if (!record?.id || record.status !== 'paid') return [];

  const targets = new Set<string>();
  if (record.officer_id) targets.add(record.officer_id);
  for (const id of assignedOfficerIds) if (id) targets.add(id);
  if (targets.size === 0) return [];

  const results: AutoAwardResult[] = [];
  for (const officerId of targets) {
    results.push(await awardAutoPoints({
      officerId,
      delta: AUTO_POINTS_RULES.serviceClosed,
      reason: `ปิดเคสค่าบริการสำเร็จ: ${record.service_name}`,
      markKey: `feeclose:${record.id}:${officerId}`,
    }));
  }
  return results;
}

/** -5 เมื่อออกเวรโดยไม่ส่งรายงานปฏิบัติงาน (เฉพาะเวรที่ปิดก่อนวันนี้) */
export async function applyMissingReportPoints(
  logs: DutyLog[],
  reportedDutyLogIds: Set<string>,
): Promise<AutoAwardResult[]> {
  const today = new Date().toISOString().slice(0, 10);
  const results: AutoAwardResult[] = [];

  for (const log of logs) {
    if (!log?.officer_id || !log.clock_out || !log.clock_in) continue;
    if (log.checkout_method === 'forced') continue;   // บังคับออกเวรมีบทลงโทษของตัวเองแล้ว
    if (log.deleted_at) continue;
    if (log.clock_out.slice(0, 10) >= today) continue; // วันนี้ยังให้เขียนรายงานทีหลังได้
    if (reportedDutyLogIds.has(log.id)) continue;

    results.push(await awardAutoPoints({
      officerId: log.officer_id,
      delta: AUTO_POINTS_RULES.missingReport,
      reason: 'ออกเวรโดยไม่ได้ส่งรายงานปฏิบัติงาน',
      markKey: `noreport:${log.id}`,
    }));
  }
  return results;
}

/** -5 เมื่อไม่เข้าเวรติดต่อกัน 1 สัปดาห์ (คิดครั้งเดียวต่อสัปดาห์/คน) */
export async function applyWeeklyAbsencePoints(params: {
  officers: Officer[];
  dutyLogs: DutyLog[];
  approvedLeaveOfficerIds: string[];
}): Promise<AutoAwardResult[]> {
  const { officers, dutyLogs, approvedLeaveOfficerIds } = params;
  if (!(await isAutoPointsEnabled())) return [];

  const today = new Date();
  const weekStart = new Date(today);
  weekStart.setDate(weekStart.getDate() - 7);
  const weekStartIso = weekStart.toISOString().slice(0, 10);
  const todayIso = today.toISOString().slice(0, 10);
  const onLeave = new Set(approvedLeaveOfficerIds);

  const workedSince = new Map<string, number>();
  for (const log of dutyLogs) {
    if (!log?.officer_id || log.deleted_at || !log.clock_in) continue;
    if (log.clock_in.slice(0, 10) < weekStartIso) continue;
    if (log.clock_in.slice(0, 10) > todayIso) continue;
    workedSince.set(log.officer_id, (workedSince.get(log.officer_id) ?? 0) + 1);
  }

  const results: AutoAwardResult[] = [];
  for (const officer of officers) {
    if (officer.status !== 'active') continue;
    if ((workedSince.get(officer.id) ?? 0) > 0) continue;
    if (onLeave.has(officer.id)) continue;   // กำลังลาอยู่ = ไม่ถือว่าขาดเวร

    results.push(await awardAutoPoints({
      officerId: officer.id,
      delta: AUTO_POINTS_RULES.absenceWeek,
      reason: 'ไม่เข้าเวรติดต่อกัน 1 สัปดาห์',
      markKey: `absent7:${officer.id}:${todayIso}`,
    }));
  }
  return results;
}

/** -30 เมื่อถูกร้องเรียนและผลตรวจสอบเป็นจริง */
export async function applyVerifiedComplaintPoints(params: {
  complaintId: string;
  accusedOfficerName: string | null;
  accusedOfficerId?: string | null;
}): Promise<AutoAwardResult | null> {
  const { complaintId, accusedOfficerName, accusedOfficerId } = params;
  if (!accusedOfficerId) return null;

  return awardAutoPoints({
    officerId: accusedOfficerId,
    delta: AUTO_POINTS_RULES.complaintVerified,
    reason: `ถูกร้องเรียนและผลตรวจสอบเป็นจริง${accusedOfficerName ? ` (${accusedOfficerName})` : ''}`,
    markKey: `complaint:${complaintId}`,
  });
}

/* ---------- ตัวช่วยอ่านข้อมูลประกอบ ---------- */

/** ดึง id ของ duty_log ที่มีรายงานปฏิบัติงานแล้ว */
export async function fetchReportedDutyLogIds(): Promise<Set<string>> {
  const { data } = await supabase
    .from('work_reports')
    .select('duty_log_id')
    .not('duty_log_id', 'is', null);
  const set = new Set<string>();
  for (const row of (data ?? []) as { duty_log_id: string | null }[]) {
    if (row?.duty_log_id) set.add(row.duty_log_id);
  }
  return set;
}

/** สรุปผลการทำงานของ PPS engine (สำหรับแสดงใน UI) */
export interface AutoPointsRunSummary {
  awarded: number;
  skipped: number;
  totalDelta: number;
  details: Array<{ reason: string; delta: number; skip?: AutoAwardResult['skipReason'] }>;
}

export function summarize(results: AutoAwardResult[]): AutoPointsRunSummary {
  const summary: AutoPointsRunSummary = { awarded: 0, skipped: 0, totalDelta: 0, details: [] };
  for (const r of results) {
    if (r.awarded) {
      summary.awarded += 1;
      summary.totalDelta += r.delta;
    } else {
      summary.skipped += 1;
    }
  }
  return summary;
}