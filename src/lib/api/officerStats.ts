import { Officer, DutyLog, ServiceRecord } from '../types';

export interface MonthlyIncome {
  month: string;            // 'YYYY-MM'
  duty_count: number;       // จำนวนครั้งที่เข้าเวร (เฉพาะที่ออกเวรแล้ว)
  duty_hours: number;       // ชั่วโมงรวมที่เข้าเวรจริง
  duty_income: number;      // duty_rate (ต่อชม.) × duty_hours
  service_income: number;   // 10% ของยอดบริการที่ชำระแล้ว (หารเฉลี่ยตามจำนวนเจ้าหน้าที่ที่ดูแลเคส)
  total: number;            // duty_income + service_income
  override: number | null;  // ค่าที่ user แก้เอง (localStorage)
}

/**
 * เจ้าหน้าที่ได้ 10% ของยอดบริการที่ชำระแล้ว
 * ยอดนี้จะถูกหารเฉลี่ยให้เจ้าหน้าที่ที่ดูแลเคสนั้นๆ
 */
export const OFFICER_SHARE_PERCENT = 0.10;

/** @deprecated ใช้ OFFICER_SHARE_PERCENT แทน — คงไว้เพื่อ backward compat */
export const DEPARTMENT_SHARE = OFFICER_SHARE_PERCENT;

export function getMonthKey(iso: string): string {
  return iso.slice(0, 7); // 'YYYY-MM'
}

/**
 * คำนวณรายได้ของเจ้าหน้าที่ต่อเดือน
 *
 * ค่าขึ้นเวร = duty_rate (บาท/ชม.) × ชั่วโมงทำงานจริง (จาก duration_minutes)
 * นับเฉพาะเวรที่มี clock_out แล้วเท่านั้น ตัดยอดรายเดือนตามวันที่เข้าเวร
 *
 * @param officer - ข้อมูลเจ้าหน้าที่
 * @param dutyLogs - ประวัติเข้าเวร
 * @param records - ค่าบริการที่เจ้าหน้าที่คนนี้ดูแล
 * @param overrides - ค่า override (localStorage)
 * @param recordOfficerCounts - Map<record_id, จำนวนเจ้าหน้าที่ที่ดูแลเคสนั้น>
 */
export function computeMonthlyIncome(
  officer: Officer,
  dutyLogs: DutyLog[],
  records: ServiceRecord[],
  overrides?: Record<string, number>,
  recordOfficerCounts?: Map<string, number>,
): { months: MonthlyIncome[]; average: number; hasOverride: boolean } {
  // === 1) รายได้จากค่าขึ้นเวร: duty_rate (ต่อชม.) × ชั่วโมงทำงานจริง ===
  // นับเฉพาะเวรที่มี clock_out + duration_minutes แล้ว ตัดยอดรายเดือนตาม clock_in
  const dutyCountByMonth = new Map<string, number>();
  const dutyHoursByMonth = new Map<string, number>();
  for (const d of dutyLogs) {
    if (d.deleted_at) continue;
    if (!d.clock_out || d.duration_minutes == null) continue; // ยังไม่ออกเวร ไม่นับ
    const m = getMonthKey(d.clock_in);
    dutyCountByMonth.set(m, (dutyCountByMonth.get(m) ?? 0) + 1);
    const hours = Math.round((d.duration_minutes / 60) * 100) / 100; // ปัดทศนิยม 2 ตำแหน่ง
    dutyHoursByMonth.set(m, (dutyHoursByMonth.get(m) ?? 0) + hours);
  }

  // === 2) รายได้จากค่าบริการ: 10% ของยอดบริการที่ชำระแล้ว ÷ จำนวนเจ้าหน้าที่ดูแลเคส ===
  const serviceByMonth = new Map<string, number>();
  for (const r of records) {
    if (r.status !== 'paid') continue;
    const m = getMonthKey(r.service_date);
    const amt = Number(r.amount) || 0;

    // จำนวนเจ้าหน้าที่ที่ดูแลเคสนี้ (สำหรับหารเฉลี่ย)
    const officerCount = recordOfficerCounts?.get(r.id)
      ?? r.assigned_officer_count
      ?? 1;
    const sharePerOfficer = (amt * OFFICER_SHARE_PERCENT) / Math.max(1, officerCount);

    serviceByMonth.set(m, (serviceByMonth.get(m) ?? 0) + sharePerOfficer);
  }

  const allMonths = new Set([...dutyCountByMonth.keys(), ...dutyHoursByMonth.keys(), ...serviceByMonth.keys()]);
  const months: MonthlyIncome[] = [];
  for (const m of [...allMonths].sort().reverse()) {
    const duty_count = dutyCountByMonth.get(m) ?? 0;
    const duty_hours = Math.round((dutyHoursByMonth.get(m) ?? 0) * 100) / 100;
    const duty_income = Math.round((officer.duty_rate ?? 0) * duty_hours * 100) / 100;
    const service_income = Math.round((serviceByMonth.get(m) ?? 0) * 100) / 100;
    const total = Math.round((duty_income + service_income) * 100) / 100;
    const override = overrides?.[m] ?? null;
    months.push({ month: m, duty_count, duty_hours, duty_income, service_income, total, override });
  }

  const sumIncome = months.reduce((s, m) => s + (m.override ?? m.total), 0);
  const average = months.length > 0 ? Math.round((sumIncome / months.length) * 100) / 100 : 0;
  const hasOverride = months.some((m) => m.override != null);

  return { months, average, hasOverride };
}

const overrideKey = (officerId: string) => `income_override:${officerId}`;

export function loadOverrides(officerId: string): Record<string, number> {
  try {
    const raw = localStorage.getItem(overrideKey(officerId));
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

export function saveOverride(officerId: string, month: string, value: number | null): Record<string, number> {
  const current = loadOverrides(officerId);
  if (value == null || Number.isNaN(value)) {
    delete current[month];
  } else {
    current[month] = value;
  }
  localStorage.setItem(overrideKey(officerId), JSON.stringify(current));
  return current;
}
