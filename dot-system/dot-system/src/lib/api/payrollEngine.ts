import { supabase } from '../supabase';
import { Officer, ServiceRecord, DutyLog, Department } from '../types';

export interface ManualBudgetInjection {
  id: string;
  amount: number;
  department: string; // 'all' หรือชื่อ department
  reason: string;
  injected_by: string;
  injected_by_name: string;
  created_at: string;
}

export interface OfficerPayrollItem {
  officer_id: string;
  officer_name: string;
  officer_username: string;
  department: Department;
  rank: string;
  duty_hours: number;
  duty_rate: number;
  duty_count: number;
  duty_income: number;
  service_count: number;
  service_income: number;
  bonus: number;
  total_net_payout: number;
}

export interface PayrollSnapshot {
  id: string;
  period_month: string;           // 'YYYY-MM'
  payout_date: string;
  total_amount: number;
  officer_count: number;
  approved_by_id: string;
  approved_by_name: string;
  approved_by_rank: string;
  notes?: string;
  breakdown: OfficerPayrollItem[];
}

export interface FinancialOverview {
  autoPaidRevenue: number;          // 1. ยอดเงินบริการที่ได้รับการชำระจริง (Auto)
  manualInjectedBudget: number;     // 2. ยอดเติมงบมือ / เงินสนับสนุนพิเศษ (Manual)
  totalGrossBudget: number;         // 1 + 2
  totalPaidOutPayroll: number;      // ยอดเงินเดือนที่อนุมัติจ่ายไปแล้วทั้งหมด
  netAvailableBudget: number;       // งบกองกลางคงเหลือสุทธิ (Gross - PaidOut)
  departmentBreakdown: Record<Department, {
    autoRevenue: number;
    manualBudget: number;
    totalEarned: number;
  }>;
}

const STORAGE_KEY_INJECTIONS = 'dot_manual_budget_injections';
const STORAGE_KEY_SNAPSHOTS = 'dot_payroll_snapshots';

/* =========================================================================
 * 1. Manual Budget Injections Storage & API
 * ========================================================================= */
export function getLocalManualInjections(): ManualBudgetInjection[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_INJECTIONS);
    return raw ? (JSON.parse(raw) as ManualBudgetInjection[]) : [];
  } catch {
    return [];
  }
}

export function saveLocalManualInjections(list: ManualBudgetInjection[]) {
  try {
    localStorage.setItem(STORAGE_KEY_INJECTIONS, JSON.stringify(list));
  } catch (e) {
    console.warn('[saveLocalManualInjections] error:', e);
  }
}

export async function addManualBudgetInjection(
  amount: number,
  department: string,
  reason: string,
  actor: { id: string; name: string; rank: string },
): Promise<ManualBudgetInjection> {
  const item: ManualBudgetInjection = {
    id: `inj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    amount,
    department,
    reason: reason || 'เงินสนับสนุนพิเศษ / เติมงบประมาณ',
    injected_by: actor.id,
    injected_by_name: actor.name,
    created_at: new Date().toISOString(),
  };

  const list = getLocalManualInjections();
  list.unshift(item);
  saveLocalManualInjections(list);

  // Log to audit logs in Supabase
  try {
    await supabase.from('audit_logs').insert({
      actor_id: actor.id,
      actor_name: actor.name,
      actor_rank: actor.rank,
      action: 'BUDGET_INJECTION',
      target_type: 'department_balance',
      details: {
        amount,
        department,
        reason,
        injection_id: item.id,
      },
    });
  } catch (e) {
    console.warn('[addManualBudgetInjection] audit log error:', e);
  }

  return item;
}

/* =========================================================================
 * 2. Payroll Snapshots History Storage & API (ล็อกถาวรรายงวด)
 * ========================================================================= */
export function getLocalPayrollSnapshots(): PayrollSnapshot[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SNAPSHOTS);
    return raw ? (JSON.parse(raw) as PayrollSnapshot[]) : [];
  } catch {
    return [];
  }
}

export function saveLocalPayrollSnapshots(list: PayrollSnapshot[]) {
  try {
    localStorage.setItem(STORAGE_KEY_SNAPSHOTS, JSON.stringify(list));
  } catch (e) {
    console.warn('[saveLocalPayrollSnapshots] error:', e);
  }
}

export async function recordPayrollSnapshot(snapshot: PayrollSnapshot): Promise<void> {
  const list = getLocalPayrollSnapshots();
  // If snapshot for this exact month exists, replace it or prepend
  const filtered = list.filter((s) => s.id !== snapshot.id);
  filtered.unshift(snapshot);
  saveLocalPayrollSnapshots(filtered);

  // Also log to audit logs
  try {
    await supabase.from('audit_logs').insert({
      actor_id: snapshot.approved_by_id,
      actor_name: snapshot.approved_by_name,
      actor_rank: snapshot.approved_by_rank,
      action: 'PAYROLL_PAYOUT_SNAPSHOT',
      target_type: 'payroll',
      details: {
        snapshot_id: snapshot.id,
        period_month: snapshot.period_month,
        total_amount: snapshot.total_amount,
        officer_count: snapshot.officer_count,
      },
    });
  } catch (e) {
    console.warn('[recordPayrollSnapshot] audit log error:', e);
  }
}

/* =========================================================================
 * 3. Hybrid Financial Overview Computation
 * ========================================================================= */
export function computeFinancialOverview(
  paidRecords: ServiceRecord[],
  officers: Officer[],
  manualInjections: ManualBudgetInjection[],
  snapshots: PayrollSnapshot[],
): FinancialOverview {
  // Map officer -> department
  const officerDeptMap = new Map<string, Department>();
  for (const o of officers) {
    officerDeptMap.set(o.id, o.department);
  }

  // 1. Auto Paid Service Revenue
  let autoPaidRevenue = 0;
  const deptAutoRev: Record<Department, number> = {
    civil_maintenance: 0,
    vehicle_rescue: 0,
    electrical: 0,
    traffic_management: 0,
    emergency_assistance: 0,
  };

  for (const r of paidRecords) {
    const amt = Number(r.amount) || 0;
    autoPaidRevenue += amt;

    // Determine department
    let dept: Department = 'civil_maintenance';
    if (r.officer_id && officerDeptMap.has(r.officer_id)) {
      dept = officerDeptMap.get(r.officer_id)!;
    } else if (r.service_name?.toLowerCase().includes('ยก') || r.service_name?.toLowerCase().includes('rescue')) {
      dept = 'vehicle_rescue';
    } else if (r.service_name?.toLowerCase().includes('ไฟ')) {
      dept = 'electrical';
    } else if (r.service_name?.toLowerCase().includes('จราจร')) {
      dept = 'traffic_management';
    } else if (r.service_name?.toLowerCase().includes('ฉุกเฉิน')) {
      dept = 'emergency_assistance';
    }
    deptAutoRev[dept] = (deptAutoRev[dept] ?? 0) + amt;
  }

  // 2. Manual Injections
  let manualInjectedBudget = 0;
  const deptManual: Record<Department, number> = {
    civil_maintenance: 0,
    vehicle_rescue: 0,
    electrical: 0,
    traffic_management: 0,
    emergency_assistance: 0,
  };

  for (const inj of manualInjections) {
    const amt = Number(inj.amount) || 0;
    manualInjectedBudget += amt;
    if (inj.department === 'all') {
      // Split evenly among 5 departments
      const share = amt / 5;
      for (const d of Object.keys(deptManual) as Department[]) {
        deptManual[d] += share;
      }
    } else if (deptManual[inj.department as Department] != null) {
      deptManual[inj.department as Department] += amt;
    }
  }

  // 3. Previously Paid Out Payrolls
  const totalPaidOutPayroll = snapshots.reduce((s, snap) => s + (Number(snap.total_amount) || 0), 0);

  // 4. Gross and Net
  const totalGrossBudget = autoPaidRevenue + manualInjectedBudget;
  const netAvailableBudget = Math.max(0, totalGrossBudget - totalPaidOutPayroll);

  const departmentBreakdown = {
    civil_maintenance: {
      autoRevenue: deptAutoRev.civil_maintenance,
      manualBudget: deptManual.civil_maintenance,
      totalEarned: deptAutoRev.civil_maintenance + deptManual.civil_maintenance,
    },
    vehicle_rescue: {
      autoRevenue: deptAutoRev.vehicle_rescue,
      manualBudget: deptManual.vehicle_rescue,
      totalEarned: deptAutoRev.vehicle_rescue + deptManual.vehicle_rescue,
    },
    electrical: {
      autoRevenue: deptAutoRev.electrical,
      manualBudget: deptManual.electrical,
      totalEarned: deptAutoRev.electrical + deptManual.electrical,
    },
    traffic_management: {
      autoRevenue: deptAutoRev.traffic_management,
      manualBudget: deptManual.traffic_management,
      totalEarned: deptAutoRev.traffic_management + deptManual.traffic_management,
    },
    emergency_assistance: {
      autoRevenue: deptAutoRev.emergency_assistance,
      manualBudget: deptManual.emergency_assistance,
      totalEarned: deptAutoRev.emergency_assistance + deptManual.emergency_assistance,
    },
  };

  return {
    autoPaidRevenue,
    manualInjectedBudget,
    totalGrossBudget,
    totalPaidOutPayroll,
    netAvailableBudget,
    departmentBreakdown,
  };
}

/* =========================================================================
 * 4. Active Period Payroll Calculator (รายได้ตามจริงรายบุคคล)
 * ========================================================================= */
export function calculateActivePeriodPayroll(
  selectedMonth: string,
  officers: Officer[],
  dutyLogs: DutyLog[],
  paidRecords: ServiceRecord[],
  sroList: { service_record_id: string; officer_id: string }[],
  staffSharePercent: number, // e.g. 10
  customBonus: Record<string, number>,
): {
  payrollList: OfficerPayrollItem[];
  totalPayrollRequired: number;
} {
  // SRO counts per record
  const sroCountMap = new Map<string, number>();
  for (const row of sroList) {
    sroCountMap.set(row.service_record_id, (sroCountMap.get(row.service_record_id) ?? 0) + 1);
  }

  // SRO assignment set
  const sroAssignmentSet = new Set<string>();
  for (const row of sroList) {
    sroAssignmentSet.add(`${row.service_record_id}_${row.officer_id}`);
  }

  const shareFactor = staffSharePercent / 100;

  const payrollList: OfficerPayrollItem[] = officers.map((off) => {
    // 1) Duty income in this month: duty_rate (BC/ชม.) × ชั่วโมงทำงานจริง
    // เฉพาะเวรที่มี clock_out แล้ว และ clock_in อยู่ในเดือนที่เลือก
    const officerDutyLogs = dutyLogs.filter((d) => {
      if (d.officer_id !== off.id) return false;
      if (d.deleted_at) return false;
      if (!d.clock_out || d.duration_minutes == null) return false;
      const m = (d.clock_in ?? '').slice(0, 7);
      return m === selectedMonth;
    });

    const duty_count = officerDutyLogs.length;
    const totalMinutes = officerDutyLogs.reduce((sum, d) => sum + (d.duration_minutes ?? 0), 0);
    const duty_hours = Math.round((totalMinutes / 60) * 100) / 100;
    const duty_rate = Number(off.duty_rate) || 0;
    const duty_income = Math.round(duty_hours * duty_rate * 100) / 100;

    // 2) Service share income (Staff Pool %) in this month
    const officerPaidRecords = paidRecords.filter((r) => {
      const m = (r.service_date ?? r.created_at ?? '').slice(0, 7);
      if (m !== selectedMonth) return false;

      const isAssigned = sroAssignmentSet.has(`${r.id}_${off.id}`);
      if (isAssigned) return true;
      const hasOtherSro = (sroCountMap.get(r.id) ?? 0) > 0;
      return !hasOtherSro && r.officer_id === off.id;
    });

    let service_income = 0;
    for (const r of officerPaidRecords) {
      const count = Math.max(1, sroCountMap.get(r.id) ?? r.assigned_officer_count ?? 1);
      const amt = Number(r.amount) || 0;
      const recordOfficerTotal = r.officer_share != null && r.officer_share > 0
        ? r.officer_share
        : amt * shareFactor;
      service_income += recordOfficerTotal / count;
    }
    service_income = Math.round(service_income * 100) / 100;

    // 3) Bonus
    const bonus = Number(customBonus[off.id]) || 0;

    // 4) Total net payout
    const total_net_payout = Math.round((duty_income + service_income + bonus) * 100) / 100;

    return {
      officer_id: off.id,
      officer_name: off.name,
      officer_username: off.username,
      department: off.department,
      rank: off.rank,
      duty_hours,
      duty_rate,
      duty_count,
      duty_income,
      service_count: officerPaidRecords.length,
      service_income,
      bonus,
      total_net_payout,
    };
  });

  const totalPayrollRequired = payrollList.reduce((s, p) => s + p.total_net_payout, 0);

  return {
    payrollList,
    totalPayrollRequired: Math.round(totalPayrollRequired * 100) / 100,
  };
}
