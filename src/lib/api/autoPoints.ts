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
import { addAutomaticPoints, addOfficerPoints, isAutoPointsEnabled } from './points';

/* ---------- เกณฑ์คะแนน ---------- */

export const AUTO_POINTS_RULES = {
  perDutyHour: 5,          // ต่อชั่วโมงที่ออกเวรปกติ
  reportApproved: 10,      // รายงานปฏิบัติงานได้รับอนุมัติ
  serviceClosed: 5,        // ปิดเคสค่าบริการ
  caseCompleted: 5,        // ปิดเคสย่อยในรายงานปฏิบัติงาน 1 เคส
  absenceWeek: -5,         // ไม่เข้าเวร 1 สัปดาห์
  missingReport: -5,       // ออกเวรไม่ส่งรายงาน
  forceCheckout: -15,      // ถูกบังคับออกเวร
  complaintVerified: -30,  // ร้องเรียนผลตรวจสอบเป็นจริง
} as const;

/**
 * คำอธิบายกฎสำหรับแสดงในหน้าตั้งค่า
 * สร้างจาก AUTO_POINTS_RULES โดยตรง เพื่อไม่ให้ตัวเลขใน UI
 * ผิดไปจากค่าที่ระบบใช้จริง (เคยลืม −15 ของการถูกบังคับออกเวรไปแล้ว)
 */
export const AUTO_POINTS_SUMMARY = [
  `+${AUTO_POINTS_RULES.perDutyHour}/ชม. ออกเวร`,
  `+${AUTO_POINTS_RULES.reportApproved} รายงานได้รับอนุมัติ`,
  `+${AUTO_POINTS_RULES.caseCompleted} ปิดเคส`,
  `+${AUTO_POINTS_RULES.serviceClosed} รับชำระครบ`,
  `${AUTO_POINTS_RULES.absenceWeek} ขาดเวรต่อสัปดาห์`,
  `${AUTO_POINTS_RULES.missingReport} ไม่ส่งรายงาน`,
  `${AUTO_POINTS_RULES.forceCheckout} ถูกบังคับออกเวร`,
  `${AUTO_POINTS_RULES.complaintVerified} ร้องเรียนผลเป็นจริง`,
].join(' · ');

/** เรียกโดยเครื่องยนต์อัตโนมัติ (ผู้เรียกถือว่า "ระบบ") */
export const AUTO_POINTS_ACTOR = { id: 'system:auto-points', name: 'ระบบ PPS อัตโนมัติ' };

/* ---------- สวิตช์เปิด/ปิด ---------- */

export async function getSystemSettings(): Promise<SystemSettings | null> {
  const { data } = await supabase.from('system_settings').select('*').eq('id', 1).maybeSingle();
  return (data as SystemSettings | null) ?? null;
}

export { isAutoPointsEnabled };

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
    // addAutomaticPoints ตรวจ kill switch ซ้ำอีกชั้น (ป้องกันสวิตช์ถูกปิดระหว่างรอบ)
    const result = await addAutomaticPoints(
      officerId,
      delta,
      reason,
      AUTO_POINTS_ACTOR.id,
      AUTO_POINTS_ACTOR.name,
    );
    if (!result) return { awarded: false, delta, skipReason: 'disabled' };
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

/** +5 ต่อเคสย่อยที่ปิดสำเร็จ (case_status = 'completed') */
export async function applyCompletedCasePoints(
  report: WorkReport,
  cases: Array<{ id: string; case_status?: string | null }>,
): Promise<AutoAwardResult[]> {
  if (!report?.officer_id) return [];

  const done = cases.filter((c) => c.case_status === 'completed');
  if (done.length === 0) return [];

  const results: AutoAwardResult[] = [];
  for (const c of done) {
    results.push(await awardAutoPoints({
      officerId: report.officer_id,
      delta: AUTO_POINTS_RULES.caseCompleted,
      reason: 'ปิดเคสปฏิบัติงานสำเร็จ 1 เคส',
      // markKey ต่อเคส → กันการให้ซ้ำถ้าอนุมัติรายงานเดิมซ้ำ
      markKey: `case:${c.id}`,
    }));
  }
  return results;
}

/**
 * +5 / -5 เมื่อสถานะเคสย่อยเปลี่ยนเป็น "เสร็จสิ้น" หรือออกจาก "เสร็จสิ้น"
 *
 * เกณฑ์ PPS: ปิดเคสสำเร็จ 1 เคส = +5 คะแนน
 * ต้องผูกกับ "การเปลี่ยนสถานะเคสย่อย" ไม่ใช่แค่ตอนอนุมัติรายงาน
 * เพราะเคสที่ยังไม่เสร็จ ณ วันอนุมัติ อาจถูกปิดให้เสร็จในภายหลัง
 *
 * markKey ต่อเคส → กันให้ซ้ำ และใช้ตัด mark เมื่อเคสถูกเปิดใหม่
 */
export async function applyCaseStatusPoints(params: {
  caseId: string;
  caseStatus: string | null | undefined;
  officerId: string | null | undefined;
  officerName?: string;
}): Promise<AutoAwardResult | null> {
  const { caseId, caseStatus, officerId } = params;
  if (!caseId || !officerId) return null;

  const markKey = `case:${caseId}`;
  const done = caseStatus === 'completed';

  const { data: mark } = await supabase
    .from('points_award_marks').select('id, delta').eq('mark_key', markKey).maybeSingle();

  // ยังไม่เสร็จ และยังไม่เคยให้คะแนน → ไม่ต้องทำอะไร
  if (!done && !mark) return null;

  // เคยได้คะแนนแล้วแต่ถูกเปลี่ยนกลับไปไม่เสร็จ → ต้องคืน
  if (!done) {
    // การคืนของที่เคยให้ไปแล้ว ต้องทำแม้สวิตช์ PPS ปิดอยู่
    // ไม่งั้นคะแนนจะค้างผิดถาวรจนกว่าจะเปิดสวิตช์มากดให้คะแนนอีกรอบ
    await addOfficerPoints(
      officerId,
      -AUTO_POINTS_RULES.caseCompleted,
      'เปิดเคสที่เคยปิดสำเร็จกลับเป็นยังไม่เสร็จ',
      AUTO_POINTS_ACTOR.id,
      AUTO_POINTS_ACTOR.name,
    );
    await supabase.from('points_award_marks').delete().eq('mark_key', markKey);
    return { awarded: true, delta: -AUTO_POINTS_RULES.caseCompleted };
  }

  // เสร็จแล้วและเคยได้คะแนน → ซ้ำ ให้ awardAutoPoints จัดการเอง
  return awardAutoPoints({
    officerId,
    delta: AUTO_POINTS_RULES.caseCompleted,
    reason: 'ปิดเคสปฏิบัติงานสำเร็จ 1 เคส',
    markKey,
  });
}

/**
 * คืนคะแนน +10 เมื่อยกเลิกการอนุมัติรายงาน (approved -> rejected)
 *
 * ใช้ addOfficerPoints ตรง ไม่ผ่าน awardAutoPoints เพราะการคืนของที่
 * "เคยให้ไปแล้ว" ไม่ควรขึ้นกับสวิตช์ PPS ที่เปิด/ปิดอยู่ตอนนี้
 * และลบ mark ทิ้ง เพื่อให้อนุมัติซ้ำแล้วได้คะแนนใหม่ถ้ากลับมา approved
 */
export async function revertReportApprovalPoints(
  report: Pick<WorkReport, 'id' | 'officer_id' | 'officer_name'>,
  actor: { id: string; name: string },
  cases: Array<{ id: string; case_status?: string | null }> = [],
): Promise<number> {
  if (!report?.officer_id) return 0;

  // รวมทั้งคะแนนรายงาน (+10) และคะแนนรายเคส (+5 ต่อเคสที่ปิดสำเร็จ)
  // ถ้าคืนแค่ +10 คะแนนเคสจะค้างอยู่โดยไม่มีรายงานรองรับ
  const caseIds = cases.filter((c) => c.case_status === 'completed').map((c) => `case:${c.id}`);
  const markKeys = [`report:${report.id}`, ...caseIds];

  const { data: marks } = await supabase
    .from('points_award_marks').select('mark_key, delta').in('mark_key', markKeys);
  const existing = (marks ?? []) as Array<{ mark_key: string; delta: number }>;
  if (existing.length === 0) return 0;   // ไม่เคยได้คะแนน -> ไม่ต้องคืน

  const total = existing.reduce((sum, m) => sum + Number(m.delta ?? 0), 0);

  // สวิตช์ปิดอยู่ → คืนไม่ได้ ตามเกณฑ์ "ระงับทุกกรณี"
  // คง mark ไว้ เพื่อให้เปิดสวิตช์แล้วเรียกซ้ำแล้วคืนได้
  if (!(await isAutoPointsEnabled())) return 0;

  await addAutomaticPoints(
    report.officer_id,
    -total,
    existing.length > 1
      ? `ยกเลิกการอนุมัติรายงานปฏิบัติงาน (คืนรายงาน + เคสที่ปิดสำเร็จ)`
      : 'ยกเลิกการอนุมัติรายงานปฏิบัติงาน',
    actor.id, actor.name,
  );
  // ปลดล็อก mark ทิ้งทั้งหมด เพื่อให้อนุมัติซ้ำแล้วได้คะแนนครบใหม่
  await supabase.from('points_award_marks').delete().in('mark_key', markKeys);
  return Math.abs(total);
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

/**
 * สแกนบิลที่ "ชำระครบแล้ว" แต่ยังไม่เคยได้คะแนน แล้วให้ +5 ให้ทุกคนที่ดูแล
 *
 * เกณฑ์ PPS: รับชำระครบ = +5 คะแนน
 *
 * ทำไมต้องมีฟังก์ชันนี้
 * ─────────────────────
 * เดิมให้คะแนนเฉพาะตอนกด "รับเงิน" ในหน้าค่าบริการเท่านั้น
 * ถ้าบิลถูกเปลี่ยนสถานะเป็น paid ที่อื่น (เช่น นำเข้าข้อมูลย้อนหลัง
 * หรือแก้ไขโดยหัวหน้ากรม) เจ้าหน้าที่จะได้คะแนนค้าง ๆ ไม่มีวันได้
 *
 * markKey รายบิลรายคน ทำให้เรียกซ้ำได้โดยไม่ให้คะแนนซ้ำ
 */
export async function applyPaidRecordsSweep(
  records: ServiceRecord[],
  assignedMap: Map<string, string[]>,
): Promise<AutoAwardResult[]> {
  const results: AutoAwardResult[] = [];

  for (const record of records) {
    // ข้ามบิลที่ยังไม่ชำระเงินจริง หรือข้อมูลไม่ครบ
    // (เคยพลาดเป็น || ทำให้ข้ามทุกแถวทันที → ไม่เคยให้คะแนนเลย)
    if (!record?.id || record.status !== 'paid') continue;

    const targets = new Set<string>();
    if (record.officer_id) targets.add(record.officer_id);
    for (const id of assignedMap.get(record.id) ?? []) {
      if (id) targets.add(id);
    }

    for (const officerId of targets) {
      results.push(await awardAutoPoints({
        officerId,
        delta: AUTO_POINTS_RULES.serviceClosed,
        reason: `ปิดเคสค่าบริการสำเร็จ: ${record.service_name}`,
        markKey: `feeclose:${record.id}:${officerId}`,
      }));
    }
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
  /**
   * เจ้าหน้าที่ที่ "มีในตารางเวร" (จากตารางเวรจริง)
   *
   * ใช้เป็นเงื่อนไขหลัก ไม่ใช่แค่ตัวกรอง เพราะถ้าไม่มีตารางเวรของสัปดาห์นั้น
   * แปลว่ายังไม่มีระบบจัดเวรในช่วงนั้น → ห้ามหักคะแนนขาดเวร
   */
  scheduledOfficerIds?: string[];
  /** เจ้าหน้าที่ที่ลาอนุมัติในแต่ละสัปดาห์ — กันไม่ให้หักคนที่วางลาไว้ */
  approvedLeaveByWeek?: Map<string, string[]>;
  /** ตารางเวรรายสัปดาห์: key = วันเริ่มสัปดาห์ (YYYY-MM-DD) → รายชื่อที่มีเวร */
  scheduledByWeek?: Map<string, string[]>;
  /** จำนวนสัปดาห์ย้อนหลังสูงสุดที่จะตรวจ */
  maxWeeks?: number;
  approvedLeaveOfficerIds: string[];
}): Promise<AutoAwardResult[]> {
  const { officers, dutyLogs, approvedLeaveOfficerIds } = params;
  if (!(await isAutoPointsEnabled())) return [];
  const WEEK = 7 * 86400000;

  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const onLeave = new Set(approvedLeaveOfficerIds);

  // นับจำนวนครั้งที่เข้าเวรของแต่ละคน แยกตามวันที่ เพื่อให้ตรวจย้อนหลังได้ทุกสัปดาห์
  const workedDays = new Map<string, Set<string>>();
  for (const log of dutyLogs) {
    if (!log?.officer_id || log.deleted_at || !log.clock_in) continue;
    const day = log.clock_in.slice(0, 10);
    if (day > todayIso) continue;
    const set = workedDays.get(log.officer_id) ?? new Set<string>();
    set.add(day);
    workedDays.set(log.officer_id, set);
  }

  // หาสัปดาห์ที่ยังตรวจได้: ไล่ย้อนจากสัปดาห์ที่แล้วไปตลอดประวัติที่มีข้อมูล
  // แต่ละสัปดาห์ใช้ markKey ของตัวเอง → ตรวจย้อนแล้วไม่หักซ้ำ
  const firstDay = [...workedDays.values()]
    .flatMap((set) => [...set])
    .sort()[0];
  if (!firstDay) return [];

  const spanWeeks = Math.ceil((Date.parse(todayIso) - Date.parse(firstDay)) / WEEK) + 1;
  const maxWeeks = Math.min(params.maxWeeks ?? 26, Math.max(1, spanWeeks));

  // ตารางเวรรายสัปดาห์ — ใช้เป็นเงื่อนไขหลัก
  // ถ้าไม่มีตารางเวรของสัปดาห์นั้น แปลว่ายังไม่มีระบบจัดเวรในช่วงนั้น
  // → ห้ามหักคะแนนขาดเวร ไม่งั้นจะหักย้อนไปถึงช่วงก่อนมีระบบ
  const scheduled = params.scheduledOfficerIds ? new Set(params.scheduledOfficerIds) : null;
  const perWeek = params.scheduledByWeek;

  if (!scheduled && !perWeek) return [];   // ไม่มีเงื่อนไขตารางเวร → ไม่หักเพื่อความปลอดภัย

  const results: AutoAwardResult[] = [];
  for (const officer of officers) {
    if (officer.status !== 'active') continue;
    if (scheduled && !scheduled.has(officer.id)) continue;
    if (onLeave.has(officer.id)) continue;   // กำลังลาอยู่ = ไม่ถือว่าขาดเวร

    const days = workedDays.get(officer.id);
    if (!days) continue;

    for (let w = 1; w <= maxWeeks; w++) {
      // สัปดาห์ที่ w = ช่วง [today - 7w, today - 7(w-1))
      const from = new Date(today);
      from.setDate(from.getDate() - 7 * w);
      void from;
      const to = new Date(today);
      to.setDate(to.getDate() - 7 * (w - 1) - 1);
      const fromIso = from.toISOString().slice(0, 10);
      const toIso = to.toISOString().slice(0, 10);

      // ต้องมีตารางเวรของสัปดาห์นี้จริง ถึงจะพิจารณาว่าขาดเวร
      // คนที่วางลาไว้ในสัปดาห์นั้น ไม่ถือว่าขาดเวร
      if (params.approvedLeaveByWeek?.get(fromIso)?.includes(officer.id)) continue;

      // ต้องมีตารางเวรของสัปดาห์นี้จริง ถึงจะพิจารณาว่าขาดเวร
      if (perWeek && !perWeek.get(fromIso)?.includes(officer.id)) continue;

      const workedInWeek = [...days].some((d) => d >= fromIso && d <= toIso);
      if (workedInWeek) continue;            // สัปดาห์นี้เข้าเวรแล้ว = ไม่ขาด

      results.push(await awardAutoPoints({
        officerId: officer.id,
        delta: AUTO_POINTS_RULES.absenceWeek,
        reason: `ไม่เข้าเวรติดต่อกัน 1 สัปดาห์ (${fromIso} ถึง ${toIso})`,
        markKey: `absent7:${officer.id}:${fromIso}`,
      }));
    }
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

/**
 * ร้องเรียนผลตรวจสอบเป็นจริง: −30 (สแกนย้อนหลังทั้งระบบ)
 *
 * ระบบเดิมหักตอนผู้ตรวจเปลี่ยนสถานะเป็น 'verified' เท่านั้น
 * ถ้าตอนนั้นเครื่องล่มหรือปิดเบราว์เซอร์ คะแนนจะค้าง
 * ฟังก์ชันนี้ไล่ทุกเรื่องร้องเรียนที่ยืนยันแล้วแต่ยังไม่ได้หักคะแนน
 *
 * ระบบผู้ถูกร้องเรียนเก็บเป็น "ชื่อ" (officer_name) ไม่ใช่ id
 * จึงต้องจับคู่ชื่อกับตาราง officers ณ ปัจจุบัน
 */
export async function applyVerifiedComplaintSweep(): Promise<AutoAwardResult[]> {
  const results: AutoAwardResult[] = [];

  const [{ data: complaints }, { data: officers }] = await Promise.all([
    supabase.from('complaints').select('id, officer_name, complainant_name').eq('status', 'verified'),
    supabase.from('officers').select('id, name').neq('status', 'deleted'),
  ]);

  // สร้างดัชนีชื่อ → id ละเลยตัวพิมพ์และช่องว่าง เพื่อให้จับคู่ผิดน้อยลง
  const byName = new Map<string, string>();
  for (const o of (officers ?? []) as Array<{ id: string; name: string }>) {
    const key = (o.name ?? '').trim().toLowerCase();
    if (key) byName.set(key, o.id);
  }

  for (const c of (complaints ?? []) as Array<{
    id: string; officer_name: string | null; complainant_name: string | null;
  }>) {
    const name = (c.officer_name ?? '').trim().toLowerCase();
    if (!name) continue;   // ร้องเรียนไม่ได้ระบุชื่อผู้ถูกกล่าวหา → หักไม่ได้
    const officerId = byName.get(name);
    if (!officerId) continue;   // ไม่พบเจ้าหน้าที่ชื่อนี้ → ข้าม (ไม่หักคนผิด)

    const res = await applyVerifiedComplaintPoints({
      complaintId: c.id,
      accusedOfficerName: c.officer_name,
      accusedOfficerId: officerId,
    });
    if (res) results.push(res);
  }

  return results;
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
/* =========================================================================
 * การสแกนคะแนนค้างรายกฎ
 * -------------------------------------------------------------------------
 * ทุกกฎคะแนนที่คำนวณตอน "เหตุการณ์" อาจไม่ได้ทำงาน ถ้าผู้ใช้ปิดเบราว์เซอร์
 * หรือเครื่องล่มกลางทาง ระบบจึงต้องมีทางไล่ย้อนหลังมาให้คะแนนที่ค้าง
 *
 * ทุกฟังก์ชันปลอดภัยเมื่อเรียกซ้ำ เพราะ awardAutoPoints จะข้ามรายการที่
 * มี mark_key อยู่แล้ว → กดสแกนเป็นร้อยครั้งก็ได้คะแนนครั้งเดียว
 * ========================================================================= */

/** ออกเวรปกติ: +5 ต่อชั่วโมงที่ทำได้ครบ */
export async function applyCheckoutPointsSweep(logs: DutyLog[]): Promise<AutoAwardResult[]> {
  const results: AutoAwardResult[] = [];
  for (const log of logs ?? []) {
    // ข้ามที่ยังออกเวรไม่เสร็จ หรือถูกบังคับออกเวร (มีกฎของตัวเองแยก)
    if (!log?.id || !log.clock_out || log.checkout_method === 'forced') continue;
    const r = await applyCheckoutPoints(log);
    if (r) results.push(r);
  }
  return results;
}

/** ถูกบังคับออกเวร: −15 */
export async function applyForceCheckoutSweep(logs: DutyLog[]): Promise<AutoAwardResult[]> {
  const results: AutoAwardResult[] = [];
  for (const log of logs ?? []) {
    if (!log?.id || !log.clock_out || log.checkout_method !== 'forced') continue;
    const r = await applyCheckoutPoints(log);
    if (r) results.push(r);
  }
  return results;
}

/** รายงานได้รับอนุมัติ: +10 */
export async function applyReportApprovalSweep(
  reports: Array<Pick<WorkReport, 'id' | 'officer_id' | 'officer_name'>>,
): Promise<AutoAwardResult[]> {
  const results: AutoAwardResult[] = [];
  for (const r of reports ?? []) {
    if (!r?.id || !r.officer_id) continue;
    const res = await applyReportApprovalPoints({ ...r, status: 'approved' } as WorkReport);
    if (res) results.push(res);
  }
  return results;
}

/**
 * ปิดเคสย่อยสำเร็จ: +5 ต่อเคส
 *
 * ต้องดึงเคสผ่าน RPC เท่านั้น เพราะ query ตรงถูก RLS บัง (ได้ 0 แถวเสมอ)
 * และต้องจำกัดจำนวนไม่ให้ยิงพร้อมกันหลายพันคำขอจนล้ม
 */
export async function applyCompletedCaseSweep(
  loadCases: (reportId: string) => Promise<Array<{ id: string; case_status?: string | null }>>,
  reports: Array<Pick<WorkReport, 'id' | 'officer_id' | 'officer_name'>>,
): Promise<AutoAwardResult[]> {
  const results: AutoAwardResult[] = [];
  // ไม่จำกัดจำนวน — ต้องครอบคลุมรายงานทั้งหมดในระบบ
  const targets = reports ?? [];

  for (const report of targets) {
    if (!report?.id || !report.officer_id) continue;
    let cases: Array<{ id: string; case_status?: string | null }>;
    try {
      cases = await loadCases(report.id);
    } catch {
      continue;   // รายงานนี้อ่านเคสไม่ได้ → ข้าม ไม่ทำให้ทั้งรอบล้ม
    }
    if (!cases?.length) continue;
    results.push(...await applyCompletedCasePoints(
      { ...report, status: 'approved' } as WorkReport,
      cases,
    ));
  }
  return results;
}
