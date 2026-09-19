import { Officer, DutyLog, ServiceRecord } from '../types';

export interface MonthlyIncome {
  month: string;
  duty_count: number;
  duty_income: number;
  service_income: number;
  total: number;
  override: number | null;
}

export const DEPARTMENT_SHARE = 0.90;

export function getMonthKey(iso: string): string {
  return iso.slice(0, 7);
}

export function computeMonthlyIncome(
  officer: Officer,
  dutyLogs: DutyLog[],
  records: ServiceRecord[],
  overrides?: Record<string, number>,
): { months: MonthlyIncome[]; average: number; hasOverride: boolean } {
  const dutyByMonth = new Map<string, number>();
  for (const d of dutyLogs) {
    if (d.deleted_at) continue;
    const m = getMonthKey(d.clock_in);
    dutyByMonth.set(m, (dutyByMonth.get(m) ?? 0) + 1);
  }

  const serviceByMonth = new Map<string, number>();
  for (const r of records) {
    if (r.status !== 'paid') continue;
    const m = getMonthKey(r.service_date);
    const amt = Number(r.amount) || 0;
    serviceByMonth.set(m, (serviceByMonth.get(m) ?? 0) + amt * DEPARTMENT_SHARE);
  }

  const allMonths = new Set([...dutyByMonth.keys(), ...serviceByMonth.keys()]);
  const months: MonthlyIncome[] = [];
  for (const m of [...allMonths].sort().reverse()) {
    const duty_count = dutyByMonth.get(m) ?? 0;
    const duty_income = (officer.duty_rate ?? 0) * duty_count;
    const service_income = serviceByMonth.get(m) ?? 0;
    const total = duty_income + service_income;
    const override = overrides?.[m] ?? null;
    months.push({ month: m, duty_count, duty_income, service_income, total, override });
  }

  const sumIncome = months.reduce((s, m) => s + (m.override ?? m.total), 0);
  const average = months.length > 0 ? sumIncome / months.length : 0;
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
