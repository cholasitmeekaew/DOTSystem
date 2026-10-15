/* =============================================================
 * workReportsAdmin.ts
 * -------------------------------------------------------------
 * ฟังก์ชันจัดการรายงานปฏิบัติงานสำหรับหัวหน้ากรม (ใช้ร่วมกันหลายหน้า)
 * ============================================================= */

import { supabase } from '../supabase';
import { addOfficerPoints } from './points';
import type { WorkReport, WorkReportCase } from '../types';

/** ป้ายประเภทงานของรายงาน */
export const DUTY_CATEGORY_LABELS: Record<string, string> = {
  patrol: 'ลาดตระเวน',
  incident: 'รับแจ้งเหตุ',
  ticket: 'ออกใบสั่ง',
  traffic: 'จัดการจราจร',
  rescue: 'ช่วยเหลือ/กู้ภัย',
  other: 'อื่นๆ',
};

export function dutyCategoryLabel(value: string | null | undefined): string {
  return value ? (DUTY_CATEGORY_LABELS[value] ?? value) : '—';
}

export interface DeleteReportResult {
  pointsReverted: number;
}

/**
 * ลบรายงานปฏิบัติงาน + คืนคะแนนที่เคยให้ไป (ถ้าอนุมัติแล้ว)
 *
 * ต้องคืนคะแนนด้วย เพราะ applyReportApprovalPoints เขียน +10 ลง
 * points_award_marks (mark_key = report:<id>) และ points_log ซึ่งเป็น
 * ledger ที่บันทึก balance_after ไว้แล้ว ถ้าลบรายงานทิ้งอย่างเดียว
 * คะแนนจะค้างโดยไม่มีรายงานรองรับ และ mark จะยังกันไม่ให้ให้คะแนนซ้ำ
 *
 * ใช้ addOfficerPoints ตรง ๆ (ไม่ผ่าน addAutomaticPoints) เพราะการคืน
 * ของที่ "เคยให้ไปแล้ว" ไม่ควรขึ้นกับสวิตช์ PPS ที่เปิด/ปิดอยู่ตอนนี้
 *
 * work_report_cases ถูกลบตาม (on delete cascade)
 */
export async function deleteWorkReport(
  target: Pick<WorkReport, 'id' | 'officer_id' | 'officer_name' | 'reviewed_points' | 'status'>,
  actor: { id: string; name: string },
): Promise<DeleteReportResult> {
  const awarded = target.reviewed_points ?? 0;
  const markKey = `report:${target.id}`;

  const { data: mark } = await supabase
    .from('points_award_marks').select('id').eq('mark_key', markKey).maybeSingle();

  let pointsReverted = 0;
  if (mark && awarded > 0 && target.officer_id) {
    await addOfficerPoints(
      target.officer_id,
      -awarded,
      'ยกเลิกรายงานปฏิบัติงานที่เคยอนุมัติ (ลบรายงาน)',
      actor.id,
      actor.name,
    );
    pointsReverted = awarded;
  }

  // ลบ mark ทิ้ง เผื่อมีการส่งรายงานเดิมนี้เข้ามาใหม่ในภายหลัง
  if (mark) await supabase.from('points_award_marks').delete().eq('mark_key', markKey);

  const { error } = await supabase.from('work_reports').delete().eq('id', target.id);
  if (error) throw error;

  await supabase.from('audit_logs').insert({
    action: 'DELETE_WORK_REPORT',
    target_type: 'work_report',
    target_id: target.id,
    performed_by: actor.id,
    performed_by_name: actor.name,
    details: {
      officer_name: target.officer_name,
      status_before: target.status ?? 'pending',
      points_reverted: pointsReverted,
    },
  });

  return { pointsReverted };
}

/**
 * โหลดเคสของรายงาน 1 ฉบับ
 *
 * ต้องใช้ RPC get_work_report_cases เป็นตัวแรก
 * เพราะการ query ตรงจาก work_report_cases ถูก RLS บล็อก (policy ใช้ auth.uid())
 * และระบบนี้ไม่มี Supabase Auth → ได้ 0 แถวเสมอ โดยไม่ error
 *
 * เคยพลาดตรงนี้: หน้าประวัติรายงานทั้งหมด query ตรง จึงขึ้น "ไม่มีเคสในรายงานนี้"
 * ทั้งที่รายงานนั้นมีเคสจริง
 */
export async function loadReportCases(
  reportId: string,
): Promise<WorkReportCase[]> {
  const { data, error } = await supabase.rpc('get_work_report_cases', {
    p_work_report_id: reportId,
  });
  if (!error) return (data ?? []) as WorkReportCase[];

  // fallback ถ้า RPC ยังไม่ถูก grant — จะได้ 0 แถวแต่อย่างน้อยไม่ error
  const fallback = await supabase
    .from('work_report_cases').select('*')
    .eq('work_report_id', reportId).order('created_at');
  return (fallback.data ?? []) as WorkReportCase[];
}

/**
 * จำนวนเคสของทุกรายงาน ในครั้งเดียว
 *
 * ตาราง work_report_cases ถูก RLS บัง (policy ใช้ auth.uid()) และระบบนี้
 * ไม่มี Supabase Auth → query ตรงได้ 0 แถวเสมอโดยไม่ error
 * การ์ดในตารางจึงเคยแสดง "0 เคส" ทั้งที่ modal แสดงจำนวนจริง
 * ต้องใช้ RPC ซึ่ง migration 0035 สร้างไว้ (ยังไม่รัน → คืนค่าว่าง)
 */
export interface CaseCount {
  work_report_id: string;
  case_count: number;
  completed_count: number;
}

export async function loadCaseCounts(
  reportIds: string[] = [],
): Promise<{
  counts: Map<string, CaseCount>;
  unavailable: boolean;
}> {
  // ทางหลัก: RPC สรุปทั้งตารางในครั้งเดียว (migration 0035)
  const { data, error } = await supabase.rpc('get_work_report_case_counts');

  if (!error && data) {
    const rows = data as Array<{ work_report_id: string; case_count: number; completed_count: number }>;
    return {
      counts: new Map(rows.map((r) => [r.work_report_id, {
        work_report_id: r.work_report_id,
        case_count: Number(r.case_count) || 0,
        completed_count: Number(r.completed_count) || 0,
      }])),
      unavailable: false,
    };
  }

  // ยังไม่ได้รัน migration 0035 → ถอยไปเรียกทีละรายงาน
  // ยังดีกว่าการคืนค่าว่าง เพราะจะแสดง "0 เคส" ทั้งที่มีเคสจริง
  if (reportIds.length === 0) {
    return { counts: new Map(), unavailable: true };
  }

  const counts = new Map<string, CaseCount>();
  await Promise.all(reportIds.map(async (id) => {
    const list = await loadReportCases(id);
    if (list.length === 0) return;
    counts.set(id, {
      work_report_id: id,
      case_count: list.length,
      completed_count: list.filter((c: WorkReportCase) => c.case_status === 'completed').length,
    });
  }));

  return { counts, unavailable: false };
}
