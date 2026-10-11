/* =============================================================
 * leaveQuota.ts
 * -------------------------------------------------------------
 * โควตาการลาประจำเดือน + การคำนวณจำนวนวันลาแบบ real-time
 *
 * กฎการนับ:
 *   - จำนวนวันลา นับรวมวันเริ่มและวันสิ้นสุด (inclusive)
 *   - ใบลาที่ "ใช้โควตา" = สถานะ approved เท่านั้น
 *     (pending ยังไม่จองโควตา, cancelled/rejected ไม่นับ)
 *   - นับเฉพาะวันที่ตกอยู่ในเดือนเดียวกับที่กำลังตรวจสอบ
 *     (ลาข้ามเดือนต้องถูกแยกคิดตามเดือนของแต่ละวัน)
 *   - quota_days = 0 แปลว่า "ไม่จำกัดโควตา"
 * ============================================================= */

import type { OfficerLeave, LeaveQuota, LeaveType, LeaveStatus } from './types';
import { DEFAULT_LEAVE_QUOTAS, LEAVE_TYPE_LABELS } from './types';

export const MS_PER_DAY = 86_400_000;

/** 'YYYY-MM' ของวันที่ (local time) */
export function monthKey(iso: string): string {
  return (iso ?? '').slice(0, 7);
}

/** เดือนปัจจุบัน 'YYYY-MM' */
export function currentMonthKey(): string {
  return new Date().toISOString().slice(0, 7);
}

/** จำนวนวันระหว่าง start → end แบบรวมปลายทั้งสองข้าง */
export function daysBetween(start: string, end: string): number {
  if (!start || !end) return 0;
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  if (Number.isNaN(s) || Number.isNaN(e)) return 0;
  return Math.floor((e - s) / MS_PER_DAY) + 1;
}

/** จำนวนวันลาที่ตกอยู่ในเดือน 'YYYY-MM' (รองรับลาข้ามเดือน) */
export function daysInMonth(leave: OfficerLeave, month: string): number {
  const s = new Date(leave.start_date).getTime();
  const e = new Date(leave.end_date).getTime();
  if (Number.isNaN(s) || Number.isNaN(e)) return 0;

  const monthStart = new Date(`${month}-01T00:00:00`).getTime();
  const monthEndDate = new Date(monthStart);
  monthEndDate.setMonth(monthEndDate.getMonth() + 1);
  const monthEnd = monthEndDate.getTime() - 1;

  const from = Math.max(s, monthStart);
  const to = Math.min(e, monthEnd);
  if (to < from) return 0;
  return Math.floor((to - from) / MS_PER_DAY) + 1;
}

/** สถานะใบลาที่ "กินโควตา" */
export function consumesQuota(status: LeaveStatus | null | undefined): boolean {
  return status === 'approved';
}

/** อ่านโควตาจากตาราง leave_quotas โดย fallback ไปค่าตั้งต้น */
export function resolveQuotas(rows: LeaveQuota[] | null | undefined): Record<LeaveType, number> {
  const base: Record<LeaveType, number> = { ...DEFAULT_LEAVE_QUOTAS };
  for (const row of rows ?? []) {
    if (!row?.leave_type) continue;
    base[row.leave_type] = Number(row.quota_days ?? 0);
  }
  return base;
}

/** ตัวอย่างสถานะโควตาของเจ้าหน้าที่ 1 คน ใน 1 เดือน */
export interface QuotaUsage {
  leaveType: LeaveType;
  label: string;
  /** โควตาทั้งหมด (0 = ไม่จำกัด) */
  quota: number;
  unlimited: boolean;
  /** วันลาที่อนุมัติแล้วในเดือนนี้ */
  used: number;
  /** โควตาคงเหลือ (ถ้าไม่จำกัดจะเป็น null) */
  remaining: number | null;
  /** สัดส่วนที่ใช้ 0..1 (ไม่จำกัด = 0) */
  ratio: number;
}

export function buildQuotaUsage(
  leaves: OfficerLeave[],
  quotas: Record<LeaveType, number>,
  month: string,
  excludeLeaveId?: string | null,
): Record<LeaveType, QuotaUsage> {
  const out = {} as Record<LeaveType, QuotaUsage>;

  for (const type of Object.keys(LEAVE_TYPE_LABELS) as LeaveType[]) {
    const quota = Number(quotas[type] ?? 0);
    const unlimited = quota <= 0;

    const used = leaves.reduce((sum, l) => {
      if (l.id === excludeLeaveId) return sum;      // ไม่นับใบลาที่กำลังแก้ไข
      if (l.leave_type !== type) return sum;
      if (!consumesQuota(l.status)) return sum;
      return sum + daysInMonth(l, month);
    }, 0);

    const remaining = unlimited ? null : Math.max(0, quota - used);

    out[type] = {
      leaveType: type,
      label: LEAVE_TYPE_LABELS[type],
      quota,
      unlimited,
      used,
      remaining,
      ratio: unlimited || quota === 0 ? 0 : Math.min(1, used / quota),
    };
  }

  return out;
}

/** ผลการตรวจสอบใบลาที่ผู้ใช้กำลังกรอก */
export interface LeaveValidation {
  ok: boolean;
  days: number;
  month: string;
  usage: QuotaUsage | null;
  /** เหตุผลที่ไม่ผ่าน (ภาษาไทย ใช้แสดงผลได้เลย) */
  message: string | null;
}

export function validateLeaveRequest(params: {
  startDate: string;
  endDate: string;
  leaveType: LeaveType;
  leaves: OfficerLeave[];
  quotas: Record<LeaveType, number>;
  excludeLeaveId?: string | null;
  /** เดือนที่ต้องการตรวจสอบ (default = เดือนของวันเริ่มลา) */
  month?: string;
}): LeaveValidation {
  const { startDate, endDate, leaveType, leaves, quotas, excludeLeaveId } = params;
  const month = params.month ?? monthKey(startDate);

  if (!startDate || !endDate) {
    return { ok: false, days: 0, month, usage: null, message: 'กรุณาเลือกวันที่เริ่มและวันที่สิ้นสุด' };
  }
  if (new Date(endDate) < new Date(startDate)) {
    return { ok: false, days: 0, month, usage: null, message: 'วันที่สิ้นสุดต้องไม่น้อยกว่าวันที่เริ่มลา' };
  }

  const usageMap = buildQuotaUsage(leaves, quotas, month, excludeLeaveId);
  const usage = usageMap[leaveType];
  const days = daysBetween(startDate, endDate);

  if (days <= 0) {
    return { ok: false, days, month, usage, message: 'จำนวนวันลาไม่ถูกต้อง' };
  }

  if (!usage.unlimited && usage.remaining !== null && days > usage.remaining) {
    const over = days - usage.remaining;
    return {
      ok: false,
      days,
      month,
      usage,
      message: `เกินโควตา ${usage.label} ของเดือนนี้ (คงเหลือ ${usage.remaining} วัน แต่ขอ ${days} วัน — เกิน ${over} วัน)`,
    };
  }

  if (usage.unlimited) {
    return { ok: true, days, month, usage, message: null };
  }

  const left = (usage.remaining ?? 0) - days;
  return {
    ok: true,
    days,
    month,
    usage,
    message: left > 0 ? `ใช้ไป ${days} วัน · คงเหลือโควตาเดือนนี้ ${left} วัน` : null,
  };
}

/** รายการวันลาของเดือนหนึ่ง (สำหรับตารางสรุปฝั่ง commissioner) */
export interface MonthlyQuotaSummary {
  month: string;
  byType: Array<QuotaUsage & { leaves: OfficerLeave[] }>;
}

export function buildMonthlyQuotaSummary(
  leaves: OfficerLeave[],
  quotas: Record<LeaveType, number>,
  month: string,
): MonthlyQuotaSummary {
  const base = buildQuotaUsage(leaves, quotas, month);
  const byType = (Object.keys(LEAVE_TYPE_LABELS) as LeaveType[]).map((type) => ({
    ...base[type],
    leaves: leaves.filter(
      (l) => l.leave_type === type && consumesQuota(l.status) && daysInMonth(l, month) > 0,
    ),
  }));
  return { month, byType };
}

/** ข้อความสรุปแบบบรรทัดเดียว เช่น "ลาป่วย 2/3 วัน" หรือ "ลาคลอด ไม่จำกัด" */
export function formatQuotaLine(usage: QuotaUsage): string {
  if (usage.unlimited) return `${usage.label} ${usage.used} วัน · ไม่จำกัดโควตา`;
  return `${usage.label} ${usage.used}/${usage.quota} วัน`;
}