import type { DutyLog, ServiceRecord } from './types';
import { SERVICE_CATEGORIES } from './types';

export const TH_MONTHS_SHORT = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];

/** นาทีสะสมของ duty log หนึ่งรายการ (fallback คำนวณจาก clock_in/out) */
export function getDutyLogMinutes(log: Pick<DutyLog, 'clock_in' | 'clock_out' | 'duration_minutes'>): number {
  let mins = Number(log.duration_minutes ?? 0);
  if (!mins || Number.isNaN(mins)) {
    try {
      const start = new Date(log.clock_in).getTime();
      const end = log.clock_out ? new Date(log.clock_out).getTime() : Date.now();
      mins = !Number.isNaN(start) && !Number.isNaN(end) && end >= start
        ? Math.round((end - start) / 60000)
        : 0;
    } catch {
      mins = 0;
    }
  }
  return Math.max(0, mins);
}

export function formatDutyHours(totalMinutes: number): string {
  if (!totalMinutes || totalMinutes <= 0) return '0 ชม.';
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h <= 0) return `${m} นาที`;
  if (m === 0) return `${h.toLocaleString('th-TH')} ชม.`;
  return `${h.toLocaleString('th-TH')} ชม. ${m} นาที`;
}

export interface MonthlyDutyHoursDatum {
  label: string;
  value: number;
  subLabel: string;
}

/** ชั่วโมงเวรรวมย้อนหลัง N เดือน (รวมเดือนปัจจุบัน) จาก duty logs */
export function buildMonthlyDutyHours(
  logs: Array<Pick<DutyLog, 'clock_in' | 'clock_out' | 'duration_minutes' | 'deleted_at'>>,
  months = 7,
): MonthlyDutyHoursDatum[] {
  const now = new Date();
  const buckets: { key: number; label: string; minutes: number }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({
      key: d.getFullYear() * 12 + d.getMonth(),
      label: TH_MONTHS_SHORT[d.getMonth()],
      minutes: 0,
    });
  }
  const byKey = new Map(buckets.map((b) => [b.key, b]));
  for (const log of logs) {
    if (log.deleted_at || !log.clock_in) continue;
    const start = new Date(log.clock_in);
    if (Number.isNaN(start.getTime())) continue;
    const b = byKey.get(start.getFullYear() * 12 + start.getMonth());
    if (!b) continue;
    b.minutes += getDutyLogMinutes(log);
  }
  return buckets.map((b) => ({
    label: b.label,
    value: Math.round((b.minutes / 60) * 10) / 10,
    subLabel: formatDutyHours(b.minutes),
  }));
}

export interface WorkloadDatum {
  label: string;
  value: number;
  color: string;
}

const WORKLOAD_PALETTE = ['#f5b800', '#38bdf8', '#34d399', '#f87171', '#c084fc', '#94a3b8'];

/** สัดส่วนจำนวนงานบริการแยกตามหมวด (มาก → น้อย) */
export function buildWorkloadByCategory(
  records: Array<Pick<ServiceRecord, 'service_category'>>,
): WorkloadDatum[] {
  const counts = new Map<string, number>();
  for (const r of records) {
    const cat = (r.service_category || 'general').trim() || 'general';
    counts.set(cat, (counts.get(cat) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([cat, value], i) => ({
      label: SERVICE_CATEGORIES.find((c) => c.value === cat)?.label ?? cat,
      value,
      color: WORKLOAD_PALETTE[i % WORKLOAD_PALETTE.length],
    }));
}
