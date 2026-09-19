import { useEffect, useState, useMemo } from 'react';
import {
  Wallet, DollarSign, History, RefreshCw, ChevronRight,
  CheckCircle2, AlertCircle, Calendar, Plus, Send,
  Search, Users, ArrowUpRight, ArrowDownRight, Sparkles, Filter,
  FileText, ShieldCheck, Check, Clock, TrendingUp, HandCoins,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/AuthContext';
import {
  Officer, ServiceRecord, DutyLog, Department, DEPARTMENT_LABELS, RANK_LABELS, OfficerPayrollOverride, ClaimRecord,
} from '../../lib/types';
import {
  ManualBudgetInjection, PayrollSnapshot, OfficerPayrollItem, FinancialOverview,
  getLocalManualInjections, addManualBudgetInjection,
  getLocalPayrollSnapshots, recordPayrollSnapshot,
  getLocalPayrollOverrides, upsertPayrollOverride, clearPayrollOverrides,
  computeFinancialOverview, calculateActivePeriodPayroll,
} from '../../lib/api/payrollEngine';
import { fetchRevenueConfigs, updateRevenueConfig } from '../../lib/api/revenueSharing';
import { Modal } from '../../components/Modal';
import { PageHeader } from '../../components/PageHeader';
import { FadeIn } from '../../components/animations';
import { ClaimApprovalTable } from '../../components/ClaimApprovalTable';
import { fetchApprovedClaims, markClaimPaid } from '../../lib/api/claimShare';
import { Switch } from '../../components/ui/switch';
import { BatchDutyRateModal } from '../../components/BatchDutyRateModal';

type Tab = 'payroll' | 'history' | 'departments' | 'claims';

export function DepartmentBalancePage() {
  const { officer: currentOfficer, isCommissioner } = useAuth();
  const [tab, setTab] = useState<Tab>('payroll');

  // Core Data
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [paidRecords, setPaidRecords] = useState<ServiceRecord[]>([]);
  const [dutyLogs, setDutyLogs] = useState<DutyLog[]>([]);
  const [approvedClaims, setApprovedClaims] = useState<ClaimRecord[]>([]);
  const [manualInjections, setManualInjections] = useState<ManualBudgetInjection[]>([]);
  const [snapshots, setSnapshots] = useState<PayrollSnapshot[]>([]);
  const [staffSharePercent, setStaffSharePercent] = useState<number>(10);
  const [loading, setLoading] = useState(true);

  // Modals & Forms
  const [showInjectModal, setShowInjectModal] = useState(false);
  const [showDutyRateModal, setShowDutyRateModal] = useState(false);
  const [showShareConfigModal, setShowShareConfigModal] = useState(false);

  // Active Payroll State
  const [selectedMonth, setSelectedMonth] = useState<string>(new Date().toISOString().slice(0, 7));
  const [customBonus, setCustomBonus] = useState<Record<string, number>>({});
  const [paying, setPaying] = useState(false);
  const [payoutSuccess, setPayoutSuccess] = useState<string | null>(null);

  // Manual Override State
  const [manualOverrides, setManualOverrides] = useState<Map<string, OfficerPayrollOverride>>(new Map());
  const [isGlobalManualMode, setIsGlobalManualMode] = useState(false);

  // History Filter State
  const [historySelectedMonth, setHistorySelectedMonth] = useState<string>('all');
  const [historySearch, setHistorySearch] = useState<string>('');

  async function fetchAll() {
    setLoading(true);
    try {
      const [{ data: o }, { data: r }, { data: dl }, configs, overrides, claims] = await Promise.all([
        supabase.from('officers').select('*').neq('status', 'deleted').order('name'),
        supabase.from('service_records').select('*').eq('status', 'paid').order('service_date', { ascending: false }),
        supabase.from('duty_logs').select('*').is('deleted_at', null).order('clock_in', { ascending: false }),
        fetchRevenueConfigs(),
        getLocalPayrollOverrides(),
        fetchApprovedClaims(currentOfficer?.id ?? ''),
      ]);

      setOfficers((o ?? []) as Officer[]);
      setPaidRecords((r ?? []) as ServiceRecord[]);
      setDutyLogs((dl ?? []) as DutyLog[]);
      setApprovedClaims(claims);

      const cfgDefault = configs.find((c) => c.scope === 'default');
      if (cfgDefault) {
        setStaffSharePercent(cfgDefault.officer_share_percent);
      }

      setManualInjections(getLocalManualInjections());
      setSnapshots(getLocalPayrollSnapshots());

      const overrideMap = new Map<string, OfficerPayrollOverride>();
      for (const o of overrides) {
        overrideMap.set(`${o.officer_id}_${o.period_month}`, o);
      }
      setManualOverrides(overrideMap);
    } catch (e) {
      console.error('[DepartmentBalancePage] fetch error:', e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchAll();
  }, []);

  // Financial Overview (Hybrid Auto + Manual)
  const financeOverview: FinancialOverview = useMemo(() => {
    return computeFinancialOverview(paidRecords, officers, manualInjections, snapshots);
  }, [paidRecords, officers, manualInjections, snapshots]);

  // Active Period Payroll Breakdown
  const { payrollList, totalPayrollRequired } = useMemo(() => {
    return calculateActivePeriodPayroll(
      selectedMonth,
      officers,
      dutyLogs,
      approvedClaims,
      customBonus,
      manualOverrides,
    );
  }, [selectedMonth, officers, dutyLogs, approvedClaims, customBonus, manualOverrides]);

  // Available Month options for payroll
  const availableMonths = useMemo(() => {
    const set = new Set<string>();
    set.add(new Date().toISOString().slice(0, 7));
    for (const d of dutyLogs) if (d.clock_in) set.add(d.clock_in.slice(0, 7));
    for (const r of paidRecords) if (r.service_date) set.add(r.service_date.slice(0, 7));
    return [...set].sort().reverse();
  }, [dutyLogs, paidRecords]);

  // Average duty rate
  const avgDutyRate = officers.length > 0
    ? Math.round(officers.reduce((s, o) => s + (Number(o.duty_rate) || 0), 0) / officers.length)
    : 0;

  // Validation: Budget vs Payroll Required
  const isBudgetSufficient = financeOverview.netAvailableBudget >= totalPayrollRequired;

  // Handle Approve Payroll Payout (Creates permanent Snapshot)
  async function handleApprovePayroll() {
    if (!currentOfficer) return;
    if (totalPayrollRequired <= 0) {
      alert('ไม่มียอดเงินที่ต้องจ่ายในงวดนี้ (เจ้าหน้าที่ไม่มีชั่วโมงเวร/เคสบริการในงวดนี้)');
      return;
    }
    if (!isBudgetSufficient) {
      alert(`งบประมาณคงเหลือไม่เพียงพอ!\n\nงบคงเหลือ: ${financeOverview.netAvailableBudget.toLocaleString('th-TH')} BC\nยอดที่ต้องจ่าย: ${totalPayrollRequired.toLocaleString('th-TH')} BC\nขาดอีก: ${(totalPayrollRequired - financeOverview.netAvailableBudget).toLocaleString('th-TH')} BC\n\nกรุณากด '➕ เติมงบประมาณ' ก่อนอนุมัติจ่าย`);
      return;
    }

    if (!confirm(`ยืนยันการอนุมัติจ่ายเงินเดือนงวดประจำเดือน ${selectedMonth}?\n\n- จำนวนเจ้าหน้าที่: ${payrollList.length} คน\n- ยอดจ่ายรวม: ${totalPayrollRequired.toLocaleString('th-TH')} BC\n- งบคงเหลือหลังจ่าย: ${(financeOverview.netAvailableBudget - totalPayrollRequired).toLocaleString('th-TH')} BC\n\nระบบจะบันทึกล็อกประวัติ Snapshot ถาวรทันที`)) {
      return;
    }

    setPaying(true);
    try {
      const snapshot: PayrollSnapshot = {
        id: `snap_${selectedMonth}_${Date.now()}`,
        period_month: selectedMonth,
        payout_date: new Date().toISOString(),
        total_amount: totalPayrollRequired,
        officer_count: payrollList.length,
        approved_by_id: currentOfficer.id,
        approved_by_name: currentOfficer.name,
        approved_by_rank: currentOfficer.rank,
        breakdown: payrollList.map((p) => {
          const key = `${p.officer_id}_${selectedMonth}`;
          const override = manualOverrides.get(key);
          if (override && override.is_manual_mode) {
            return {
              ...p,
              duty_income: override.manual_duty_income ?? p.duty_income,
              service_income: override.manual_service_income ?? p.service_income,
              bonus: override.manual_bonus ?? p.bonus,
              total_net_payout: override.manual_total_net_payout ?? p.total_net_payout,
            };
          }
          return p;
        }),
      };

      await recordPayrollSnapshot(snapshot);
      // Claims that have been approved are paid together with this payroll run.
      // Pending claims are intentionally left untouched and remain available next month.
      await Promise.all(
        approvedClaims
          .filter((claim) => claim.status === 'approved')
          .map((claim) => markClaimPaid(claim.id, currentOfficer.id)),
      );
      setSnapshots(getLocalPayrollSnapshots());
      setPayoutSuccess(`อนุมัติจ่ายเงินเดือนงวด ${selectedMonth} สำเร็จเรียบร้อย! รวม ${totalPayrollRequired.toLocaleString('th-TH')} BC`);
      await fetchAll();
    } catch (e) {
      alert(`เกิดข้อผิดพลาด: ${(e as Error).message}`);
    } finally {
      setPaying(false);
    }
  }

  // Filtered Snapshots for History Dashboard
  const filteredSnapshots = useMemo(() => {
    return snapshots.filter((snap) => {
      if (historySelectedMonth !== 'all' && snap.period_month !== historySelectedMonth) {
        return false;
      }
      return true;
    });
  }, [snapshots, historySelectedMonth]);

  // Selected snapshot to view deep breakdown in history tab
  const activeHistorySnapshot = filteredSnapshots[0] ?? snapshots[0] ?? null;

  // Filtered Officers in History Snapshot Breakdown
  const filteredSnapshotItems = useMemo(() => {
    if (!activeHistorySnapshot) return [];
    if (!historySearch.trim()) return activeHistorySnapshot.breakdown;
    const q = historySearch.toLowerCase().trim();
    return activeHistorySnapshot.breakdown.filter((item) =>
      item.officer_name.toLowerCase().includes(q) ||
      item.officer_username.toLowerCase().includes(q) ||
      DEPARTMENT_LABELS[item.department]?.toLowerCase().includes(q)
    );
  }, [activeHistorySnapshot, historySearch]);

  return (
    <FadeIn>
      <PageHeader
        icon={<Wallet size={26} />}
        title="การเงินและจ่ายเงินเดือน"
        subtitle="ระบบบริหารงบประมาณ Hybrid · ส่วนแบ่งเคสบริการ · ค่าขึ้นเวรรายชั่วโมง · ประวัติเงินเดือน Snapshot"
        actions={
          <div className="flex items-center gap-2">
            {isCommissioner && (
              <button
                onClick={() => setShowInjectModal(true)}
                className="btn-primary flex items-center gap-1.5 shadow-lg shadow-amber-500/20 text-xs py-2 px-3.5"
              >
                <Plus size={14} /> ➕ เติมงบประมาณ
              </button>
            )}
            <button onClick={fetchAll} className="btn-secondary flex items-center gap-1.5 text-xs py-2 px-3">
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> รีเฟรช
            </button>
          </div>
        }
      />

      {/* =========================================================================
       * 1. Financial Overview Cards (Hybrid Model: Auto + Manual - PaidOut = Net)
       * ========================================================================= */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        {/* Card 1: Auto Paid Service Revenue */}
        <div className="card p-3.5 bg-gradient-to-br from-navy-800 to-navy-900 border border-blue-900/60">
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span className="flex items-center gap-1">
              <TrendingUp size={14} className="text-emerald-400" /> ยอดชำระบริการจริง
            </span>
            <span className="text-[10px] text-emerald-400 font-mono bg-emerald-500/10 px-1.5 py-0.5 rounded">
              Auto Base
            </span>
          </div>
          <div className="text-xl sm:text-2xl font-black text-emerald-400 font-mono mt-1">
            {financeOverview.autoPaidRevenue.toLocaleString('th-TH')} <span className="text-xs font-normal text-gray-400">BC</span>
          </div>
          <div className="text-[11px] text-gray-400 mt-1">
            จากเคสบริการที่ชำระเงินแล้ว {paidRecords.length} รายการ
          </div>
        </div>

        {/* Card 2: Manual Injected Budget */}
        <div className="card p-3.5 bg-gradient-to-br from-navy-800 to-navy-900 border border-blue-900/60">
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span className="flex items-center gap-1">
              <Plus size={14} className="text-blue-400" /> งบเติมพิเศษ / RP
            </span>
            <span className="text-[10px] text-blue-400 font-mono bg-blue-500/10 px-1.5 py-0.5 rounded">
              Manual
            </span>
          </div>
          <div className="text-xl sm:text-2xl font-black text-blue-300 font-mono mt-1">
            {financeOverview.manualInjectedBudget.toLocaleString('th-TH')} <span className="text-xs font-normal text-gray-400">BC</span>
          </div>
          <div className="text-[11px] text-gray-400 mt-1">
            เงินสนับสนุนพิเศษ {manualInjections.length} ครั้ง
          </div>
        </div>

        {/* Card 3: Total Paid Out Payroll */}
        <div className="card p-3.5 bg-gradient-to-br from-navy-800 to-navy-900 border border-blue-900/60">
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span className="flex items-center gap-1">
              <ArrowDownRight size={14} className="text-pink-400" /> จ่ายเงินเดือนสะสม
            </span>
            <span className="text-[10px] text-pink-400 font-mono bg-pink-500/10 px-1.5 py-0.5 rounded">
              {snapshots.length} งวด
            </span>
          </div>
          <div className="text-xl sm:text-2xl font-black text-pink-400 font-mono mt-1">
            {financeOverview.totalPaidOutPayroll.toLocaleString('th-TH')} <span className="text-xs font-normal text-gray-400">BC</span>
          </div>
          <div className="text-[11px] text-gray-400 mt-1">
            ยอดที่อนุมัติจ่ายจริงให้พนักงานแล้ว
          </div>
        </div>

        {/* Card 4: Net Available Fund */}
        <div className="card p-3.5 bg-gradient-to-br from-amber-950/30 to-navy-900 border border-amber-500/40 ring-1 ring-amber-500/20">
          <div className="flex items-center justify-between text-xs text-amber-300">
            <span className="flex items-center gap-1 font-semibold">
              <Wallet size={14} className="text-amber-400" /> งบกองกลางคงเหลือสุทธิ
            </span>
            <span className="text-[10px] text-amber-400 font-bold font-mono bg-amber-500/20 px-1.5 py-0.5 rounded border border-amber-500/30">
              พร้อมใช้
            </span>
          </div>
          <div className="text-xl sm:text-2xl font-black text-amber-400 font-mono mt-1">
            {financeOverview.netAvailableBudget.toLocaleString('th-TH')} <span className="text-xs font-normal text-amber-300/80">BC</span>
          </div>
          <div className="text-[11px] text-amber-300/70 mt-1">
            ฐานงบรวม ({financeOverview.totalGrossBudget.toLocaleString('th-TH')}) - จ่ายแล้ว
          </div>
        </div>
      </div>

      {/* =========================================================================
       * 2. Clean Tab Navigation
       * ========================================================================= */}
      <div className="flex gap-2 mb-4 border-b border-blue-900/40 overflow-x-auto scrollbar-thin">
        {[
          { key: 'payroll' as const, label: '💸 จ่ายเงินเดือนประจำงวด', icon: <DollarSign size={14} />, badge: `${totalPayrollRequired.toLocaleString('th-TH')} BC` },
          { key: 'history' as const, label: '📜 แดชบอร์ดประวัติการจ่ายเงินเดือน', icon: <History size={14} />, badge: `${snapshots.length} งวด` },
          { key: 'departments' as const, label: '🏦 งบประมาณ 5 แผนก & รายรับ', icon: <Wallet size={14} /> },
          { key: 'claims' as const, label: '🪙 อนุมัติส่วนแบ่งเคส (Claim)', icon: <HandCoins size={14} /> },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium flex items-center gap-2 border-b-2 whitespace-nowrap transition-all ${
              tab === t.key
                ? 'text-amber-400 border-amber-400 bg-amber-500/5 font-semibold'
                : 'text-gray-400 border-transparent hover:text-gray-200 hover:bg-navy-800/40'
            }`}
          >
            {t.icon} {t.label}
            {t.badge && (
              <span className="ml-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* =========================================================================
       * 3. Tab Contents
       * ========================================================================= */}
      {loading ? (
        <div className="text-center text-gray-500 py-16 flex flex-col items-center gap-3">
          <RefreshCw className="animate-spin text-amber-400" size={26} />
          <span>กำลังโหลดข้อมูลระบบการเงิน...</span>
        </div>
      ) : tab === 'payroll' ? (
        /* =========================================================================
         * TAB 1: จ่ายเงินเดือนประจำงวด (Active Payroll)
         * ========================================================================= */
        <div className="space-y-4">
          {/* Payroll Control Toolbar */}
          <div className="card p-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-3">
                {/* Month Picker */}
                <div>
                  <label className="block text-[11px] text-gray-400 mb-1 flex items-center gap-1">
                    <Calendar size={13} className="text-amber-400" /> งวดประจำเดือน:
                  </label>
                  <select
                    value={selectedMonth}
                    onChange={(e) => setSelectedMonth(e.target.value)}
                    className="input-field py-1.5 px-3 text-sm font-semibold text-white bg-navy-800"
                  >
                    {availableMonths.map((m) => (
                      <option key={m} value={m}>
                        งวดประจำเดือน {m}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Manual Override Toggle */}
                {isCommissioner && (
                  <div className="flex items-center gap-2 bg-navy-900 border border-blue-900/60 rounded-lg px-3 py-1.5">
                    <span className="text-[10px] text-gray-400">โหมดคำนวณ:</span>
                    <span className={`text-[10px] font-bold ${isGlobalManualMode ? 'text-red-400' : 'text-emerald-400'}`}>
                      {isGlobalManualMode ? '🔴 Manual' : '🟢 Auto'}
                    </span>
                    <Switch
                      checked={isGlobalManualMode}
                      onCheckedChange={async (checked) => {
                        setIsGlobalManualMode(checked);
                        if (!checked) {
                          setManualOverrides(new Map());
                          await clearPayrollOverrides();
                        }
                      }}
                    />
                  </div>
                )}

                {/* Quick Setting Chips */}
                <div className="flex flex-wrap items-center gap-2 pt-2 sm:pt-4">
                  <div className="bg-navy-900 border border-blue-900/60 rounded-lg px-3 py-1.5 text-xs flex items-center gap-1.5">
                    <span className="text-gray-400">เรทค่าขึ้นเวร:</span>
                    <span className="text-blue-300 font-mono font-bold">{avgDutyRate} BC/ชม.</span>
                    {isCommissioner && (
                      <button onClick={() => setShowDutyRateModal(true)} className="text-amber-400 hover:text-amber-300 font-semibold text-[10px] ml-1">
                        [ตั้งเรททุกคน]
                      </button>
                    )}
                  </div>

                  <div className="bg-navy-900 border border-blue-900/60 rounded-lg px-3 py-1.5 text-xs flex items-center gap-1.5">
                    <span className="text-gray-400">สัดส่วนเคสบริการ (Staff Pool):</span>
                    <span className="text-emerald-300 font-mono font-bold">{staffSharePercent}%</span>
                    {isCommissioner && (
                      <button onClick={() => setShowShareConfigModal(true)} className="text-amber-400 hover:text-amber-300 font-semibold text-[10px] ml-1">
                        [เปลี่ยน %]
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Total Payout & Approve Button */}
              <div className="flex items-center justify-between lg:justify-end gap-4 border-t lg:border-t-0 pt-3 lg:pt-0 border-blue-900/30">
                <div className="text-right">
                  <div className="text-xs text-gray-400">ยอดจ่ายรวมงวดนี้</div>
                  <div className="text-2xl font-black text-amber-400 font-mono">
                    {totalPayrollRequired.toLocaleString('th-TH')} BC
                  </div>
                </div>
                {isCommissioner && (
                  <button
                    onClick={handleApprovePayroll}
                    disabled={paying || totalPayrollRequired <= 0 || !isBudgetSufficient}
                    className="btn-primary flex items-center gap-2 px-5 py-2.5 text-sm shadow-lg shadow-amber-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Send size={15} />
                    {paying ? 'กำลังอนุมัติจ่าย...' : 'อนุมัติจ่ายเงินเดือนงวดนี้'}
                  </button>
                )}
              </div>
            </div>

            {/* Budget Validation Alert Banner */}
            <div className={`mt-3 p-3 rounded-lg border flex items-center justify-between text-xs ${
              isBudgetSufficient
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                : 'bg-red-500/10 border-red-500/30 text-red-300'
            }`}>
              <div className="flex items-center gap-2">
                {isBudgetSufficient ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                <span>
                  {isBudgetSufficient
                    ? `งบกองกลางคงเหลือ ${financeOverview.netAvailableBudget.toLocaleString('th-TH')} BC (เพียงพอสำหรับการจ่ายยอดงวดนี้ ${totalPayrollRequired.toLocaleString('th-TH')} BC — คงเหลือหลังจ่าย ${(financeOverview.netAvailableBudget - totalPayrollRequired).toLocaleString('th-TH')} BC)`
                    : `งบกองกลางคงเหลือ ${financeOverview.netAvailableBudget.toLocaleString('th-TH')} BC (ไม่เพียงพอต่อยอดจ่าย ${totalPayrollRequired.toLocaleString('th-TH')} BC — ขาดอีก ${(totalPayrollRequired - financeOverview.netAvailableBudget).toLocaleString('th-TH')} BC กรุณากดเติมงบประมาณ)`}
                </span>
              </div>
              {!isBudgetSufficient && isCommissioner && (
                <button
                  onClick={() => setShowInjectModal(true)}
                  className="px-2.5 py-1 rounded bg-red-500/20 hover:bg-red-500/30 text-red-200 border border-red-500/40 text-xs font-semibold whitespace-nowrap ml-2"
                >
                  ➕ เติมงบเพิ่มทันที
                </button>
              )}
            </div>

            {payoutSuccess && (
              <div className="mt-3 p-3 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
                <CheckCircle2 size={16} /> {payoutSuccess}
              </div>
            )}
          </div>

          {/* Officers Payroll Table */}
          <div className="card overflow-hidden">
            <div className="p-4 border-b border-blue-900/40 flex items-center justify-between">
              <div>
                <h3 className="text-white font-semibold text-sm flex items-center gap-2">
                  <Users size={16} className="text-amber-400" /> บัญชีเงินเดือนเจ้าหน้าที่ประจำงวด ({selectedMonth})
                </h3>
                <span className="text-xs text-gray-400">
                  คำนวณตามจริง: ค่าขึ้นเวร (ชั่วโมงจริง × เรท/ชม.) + ส่วนแบ่งเคสบริการ ({staffSharePercent}%) + โบนัส
                </span>
              </div>
              <span className="text-xs text-gray-400 font-medium">เจ้าหน้าที่ {payrollList.length} คน</span>
            </div>

            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full text-xs">
                <thead className="bg-navy-800/60 text-gray-400">
                  <tr>
                    <th className="text-left px-4 py-3">เจ้าหน้าที่</th>
                    <th className="text-left px-4 py-3">แผนก / ตำแหน่ง</th>
                    <th className="text-right px-4 py-3">ค่าขึ้นเวร (ชั่วโมง × เรท/ชม.)</th>
                    <th className="text-right px-4 py-3">ส่วนแบ่งเคส ({staffSharePercent}%)</th>
                    <th className="text-right px-4 py-3">โบนัส/เงินพิเศษ</th>
                    <th className="text-right px-4 py-3 font-bold text-white">ยอดสุทธิ (BC)</th>
                  </tr>
                </thead>
                <tbody>
                  {payrollList.map((p) => {
                    const overrideKey = `${p.officer_id}_${selectedMonth}`;
                    const override = manualOverrides.get(overrideKey);
                    const isManual = override?.is_manual_mode ?? isGlobalManualMode;

                    function updateOverride(field: keyof OfficerPayrollOverride, value: number | boolean | null) {
                      setManualOverrides((prev) => {
                        const next = new Map(prev);
                        const existing = next.get(overrideKey) || {
                          officer_id: p.officer_id,
                          period_month: selectedMonth,
                          manual_duty_income: null,
                          manual_service_income: null,
                          manual_bonus: null,
                          manual_total_net_payout: null,
                          is_manual_mode: true,
                          updated_at: new Date().toISOString(),
                          updated_by_id: currentOfficer?.id ?? 'system',
                          updated_by_name: currentOfficer?.name ?? 'system',
                        };
                        next.set(overrideKey, { ...existing, [field]: value, updated_at: new Date().toISOString() });
                        return next;
                      });
                    }

                    function persistOverride(next: OfficerPayrollOverride) {
                      upsertPayrollOverride(next);
                    }

                    return (
                      <tr key={p.officer_id} className={`border-t border-blue-900/30 hover:bg-navy-800/30 transition-colors ${isManual ? 'bg-amber-500/5' : ''}`}>
                        <td className="px-4 py-3">
                          <div className="text-white font-semibold">{p.officer_name}</div>
                          <div className="text-[10px] text-gray-500 font-mono">@{p.officer_username}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-gray-300">{DEPARTMENT_LABELS[p.department] ?? p.department}</div>
                          <div className="text-[10px] text-amber-400/80">{RANK_LABELS[p.rank] ?? p.rank}</div>
                        </td>
                        <td className="px-4 py-3 text-right font-mono">
                          {isManual ? (
                            <input
                              type="number"
                              className="input-field text-right w-28 py-1 px-2 text-xs font-mono bg-navy-800 border-amber-500/40"
                              value={override?.manual_duty_income ?? p.duty_income}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value) || 0;
                                const next = {
                                  ...(manualOverrides.get(overrideKey) || {
                                    officer_id: p.officer_id,
                                    period_month: selectedMonth,
                                    manual_duty_income: null,
                                    manual_service_income: null,
                                    manual_bonus: null,
                                    manual_total_net_payout: null,
                                    is_manual_mode: true,
                                    updated_at: new Date().toISOString(),
                                    updated_by_id: currentOfficer?.id ?? 'system',
                                    updated_by_name: currentOfficer?.name ?? 'system',
                                  }),
                                  manual_duty_income: val,
                                  updated_at: new Date().toISOString(),
                                };
                                updateOverride('manual_duty_income', val);
                                persistOverride(next);
                              }}
                            />
                          ) : (
                            <>
                              <div className="text-blue-300 font-semibold">{p.duty_income.toLocaleString('th-TH')} BC</div>
                              <div className="text-[10px] text-gray-500">{p.duty_hours} ชม. ({p.duty_count} เวร) × {p.duty_rate.toLocaleString('th-TH')}/ชม.</div>
                            </>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-mono">
                          {isManual ? (
                            <input
                              type="number"
                              className="input-field text-right w-28 py-1 px-2 text-xs font-mono bg-navy-800 border-amber-500/40"
                              value={override?.manual_service_income ?? p.service_income}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value) || 0;
                                const next = {
                                  ...(manualOverrides.get(overrideKey) || {
                                    officer_id: p.officer_id,
                                    period_month: selectedMonth,
                                    manual_duty_income: null,
                                    manual_service_income: null,
                                    manual_bonus: null,
                                    manual_total_net_payout: null,
                                    is_manual_mode: true,
                                    updated_at: new Date().toISOString(),
                                    updated_by_id: currentOfficer?.id ?? 'system',
                                    updated_by_name: currentOfficer?.name ?? 'system',
                                  }),
                                  manual_service_income: val,
                                  updated_at: new Date().toISOString(),
                                };
                                updateOverride('manual_service_income', val);
                                persistOverride(next);
                              }}
                            />
                          ) : (
                            <>
                              <div className="text-emerald-300 font-semibold">{p.service_income.toLocaleString('th-TH')} BC</div>
                              <div className="text-[10px] text-gray-500">{p.service_count} เคสบริการ</div>
                            </>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {isManual ? (
                            <input
                              type="number"
                              className="input-field text-right w-24 py-1 px-2 text-xs font-mono bg-navy-800 border-amber-500/40"
                              value={override?.manual_bonus ?? (customBonus[p.officer_id] ?? '')}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value) || 0;
                                const next = {
                                  ...(manualOverrides.get(overrideKey) || {
                                    officer_id: p.officer_id,
                                    period_month: selectedMonth,
                                    manual_duty_income: null,
                                    manual_service_income: null,
                                    manual_bonus: null,
                                    manual_total_net_payout: null,
                                    is_manual_mode: true,
                                    updated_at: new Date().toISOString(),
                                    updated_by_id: currentOfficer?.id ?? 'system',
                                    updated_by_name: currentOfficer?.name ?? 'system',
                                  }),
                                  manual_bonus: val,
                                  updated_at: new Date().toISOString(),
                                };
                                updateOverride('manual_bonus', val);
                                persistOverride(next);
                              }}
                            />
                          ) : (
                            <input
                              type="number"
                              placeholder="0"
                              className="input-field text-right w-24 py-1 px-2 text-xs font-mono"
                              value={customBonus[p.officer_id] ?? ''}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value) || 0;
                                setCustomBonus({ ...customBonus, [p.officer_id]: val });
                              }}
                            />
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-sm text-amber-400">
                          {isManual
                            ? (
                              (override?.manual_total_net_payout
                                ?? (override?.manual_duty_income ?? p.duty_income)
                                   + (override?.manual_service_income ?? p.service_income)
                                   + (override?.manual_bonus ?? (Number(customBonus[p.officer_id]) || 0))
                              )
                            ).toLocaleString('th-TH')
                            : p.total_net_payout.toLocaleString('th-TH')
                          } BC
                        </td>
                      </tr>
                    );
                  })}
                  {payrollList.length === 0 && (
                    <tr>
                      <td colSpan={6} className="text-center text-gray-500 py-10">
                        ยังไม่มีข้อมูลเจ้าหน้าที่ในระบบ
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : tab === 'history' ? (
        /* =========================================================================
         * TAB 2: แดชบอร์ดประวัติการจ่ายเงินเดือน (Payroll History Dashboard)
         * ========================================================================= */
        <div className="space-y-4">
          {/* Dashboard Filter Bar */}
          <div className="card p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <label className="text-xs text-gray-400 flex items-center gap-1.5">
                <Filter size={14} className="text-amber-400" /> เลือกงวดประวัติ:
              </label>
              <select
                value={historySelectedMonth}
                onChange={(e) => setHistorySelectedMonth(e.target.value)}
                className="input-field py-1.5 px-3 text-xs font-semibold text-white bg-navy-800"
              >
                <option value="all">แสดงทั้งหมด ({snapshots.length} งวด)</option>
                {snapshots.map((s) => (
                  <option key={s.id} value={s.period_month}>
                    งวด {s.period_month} — จ่าย {s.total_amount.toLocaleString('th-TH')} BC
                  </option>
                ))}
              </select>
            </div>

            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="text"
                placeholder="ค้นหาชื่อพนักงาน / แผนก..."
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                className="input-field pl-8 py-1.5 text-xs w-full sm:w-64"
              >
              </input>
            </div>
          </div>

          {/* Active Snapshot Overview Card */}
          {activeHistorySnapshot ? (
            <div className="card p-4 border border-amber-500/30 bg-gradient-to-r from-navy-800 via-navy-900 to-navy-800">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-black text-amber-400 font-mono">งวดประจำเดือน {activeHistorySnapshot.period_month}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                      <ShieldCheck size={12} /> อนุมัติแล้ว
                    </span>
                  </div>
                  <div className="text-xs text-gray-400 mt-1">
                    อนุมัติโดย: <span className="text-white font-medium">{activeHistorySnapshot.approved_by_name}</span> ({RANK_LABELS[activeHistorySnapshot.approved_by_rank] ?? activeHistorySnapshot.approved_by_rank}) · เมื่อ {new Date(activeHistorySnapshot.payout_date).toLocaleString('th-TH')}
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-xs text-gray-400">ยอดเงินรวมทั้งงวด ({activeHistorySnapshot.officer_count} คน)</div>
                  <div className="text-2xl font-black text-amber-400 font-mono">
                    {activeHistorySnapshot.total_amount.toLocaleString('th-TH')} BC
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="card p-8 text-center text-gray-500 text-sm">
              ยังไม่มีประวัติการอนุมัติจ่ายเงินเดือนในระบบ (กดแท็บ "💸 จ่ายเงินเดือนประจำงวด" เพื่อเริ่มอนุมัติจ่ายงวดแรก)
            </div>
          )}

          {/* Detailed Breakdown per Period Table */}
          {activeHistorySnapshot && (
            <div className="card overflow-hidden">
              <div className="p-4 border-b border-blue-900/40 flex items-center justify-between">
                <h3 className="text-white font-semibold text-sm flex items-center gap-2">
                  <FileText size={16} className="text-amber-400" /> ตารางแจกแจงรายบุคคลเชิงลึก (Detailed Breakdown)
                </h3>
                <span className="text-xs text-gray-400">แสดงผล {filteredSnapshotItems.length} คน</span>
              </div>

              <div className="overflow-x-auto scrollbar-thin">
                <table className="w-full text-xs">
                  <thead className="bg-navy-800/60 text-gray-400">
                    <tr>
                      <th className="text-left px-4 py-3">ชื่อพนักงาน</th>
                      <th className="text-left px-4 py-3">แผนก / ตำแหน่ง</th>
                      <th className="text-right px-4 py-3">รายได้ค่าขึ้นเวร (สูตรคำนวณ)</th>
                      <th className="text-right px-4 py-3">ส่วนแบ่งเคสบริการ</th>
                      <th className="text-right px-4 py-3">โบนัส/พิเศษ</th>
                      <th className="text-right px-4 py-3 font-bold text-white">ยอดสุทธิที่ได้รับจริง (BC)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSnapshotItems.map((item) => (
                      <tr key={item.officer_id} className="border-t border-blue-900/30 hover:bg-navy-800/30 transition-colors">
                        <td className="px-4 py-3">
                          <div className="text-white font-semibold">{item.officer_name}</div>
                          <div className="text-[10px] text-gray-500 font-mono">@{item.officer_username}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-gray-300">{DEPARTMENT_LABELS[item.department] ?? item.department}</div>
                          <div className="text-[10px] text-amber-400/80">{RANK_LABELS[item.rank] ?? item.rank}</div>
                        </td>
                        <td className="px-4 py-3 text-right font-mono">
                          <div className="text-blue-300 font-semibold">{item.duty_income.toLocaleString('th-TH')} BC</div>
                          <div className="text-[10px] text-gray-500">
                            {item.duty_hours} ชม. × {item.duty_rate.toLocaleString('th-TH')} BC/ชม.
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right font-mono">
                          <div className="text-emerald-300 font-semibold">{item.service_income.toLocaleString('th-TH')} BC</div>
                          <div className="text-[10px] text-gray-500">{item.service_count} เคส</div>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-gray-300">
                          {item.bonus > 0 ? `+${item.bonus.toLocaleString('th-TH')} BC` : '—'}
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-sm text-amber-400">
                          {item.total_net_payout.toLocaleString('th-TH')} BC
                        </td>
                      </tr>
                    ))}
                    {filteredSnapshotItems.length === 0 && (
                      <tr>
                        <td colSpan={6} className="text-center text-gray-500 py-8">
                          ไม่พบข้อมูลพนักงานที่ตรงกับคำค้นหา
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Manual Budget Injections History Table */}
          <div className="card overflow-hidden">
            <div className="p-4 border-b border-blue-900/40 flex items-center justify-between">
              <h3 className="text-white font-semibold text-sm flex items-center gap-2">
                <Plus size={16} className="text-blue-400" /> ประวัติการเติมงบประมาณพิเศษ / สนับสนุนนอกระบบ (Manual Injections)
              </h3>
              <span className="text-xs text-gray-400">รวม {manualInjections.length} รายการ</span>
            </div>

            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full text-xs">
                <thead className="bg-navy-800/60 text-gray-400">
                  <tr>
                    <th className="text-left px-4 py-2.5">วันเวลา</th>
                    <th className="text-left px-4 py-2.5">แผนกเป้าหมาย</th>
                    <th className="text-left px-4 py-2.5">เหตุผล / ที่มา</th>
                    <th className="text-left px-4 py-2.5">ผู้เติมงบ</th>
                    <th className="text-right px-4 py-2.5 font-bold text-white">จำนวนเงิน (BC)</th>
                  </tr>
                </thead>
                <tbody>
                  {manualInjections.map((inj) => (
                    <tr key={inj.id} className="border-t border-blue-900/30 hover:bg-navy-800/30">
                      <td className="px-4 py-2.5 text-gray-400 font-mono">{new Date(inj.created_at).toLocaleString('th-TH')}</td>
                      <td className="px-4 py-2.5 text-amber-300">
                        {inj.department === 'all' ? 'กองกลางทุกแผนก (เฉลี่ยเท่ากัน)' : (DEPARTMENT_LABELS[inj.department as Department] ?? inj.department)}
                      </td>
                      <td className="px-4 py-2.5 text-white">{inj.reason}</td>
                      <td className="px-4 py-2.5 text-gray-300">{inj.injected_by_name}</td>
                      <td className="px-4 py-2.5 text-right font-mono font-bold text-emerald-400 text-sm">
                        +{inj.amount.toLocaleString('th-TH')} BC
                      </td>
                    </tr>
                  ))}
                  {manualInjections.length === 0 && (
                    <tr>
                      <td colSpan={5} className="text-center text-gray-500 py-6">
                        ยังไม่มีประวัติการเติมงบประมาณพิเศษ
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : tab === 'claims' && currentOfficer ? (
        /* =========================================================================
         * TAB 4: อนุมัติส่วนแบ่งเคส (Claim Approval)
         * ========================================================================= */
        <ClaimApprovalTable approverId={currentOfficer.id} officers={officers} onChanged={fetchAll} />
      ) : (
        /* =========================================================================
         * TAB 3: งบประมาณ 5 แผนก & รายรับ (Departments & Auto Revenue)
         * ========================================================================= */
        <div className="space-y-4">
          <div className="card overflow-hidden">
            <div className="p-4 border-b border-blue-900/40">
              <h3 className="text-white font-semibold text-sm flex items-center gap-2">
                <Wallet size={16} className="text-amber-400" /> ตารางรายรับและงบประมาณสะสมจำแนกตาม 5 แผนก
              </h3>
              <p className="text-xs text-gray-400 mt-0.5">
                ยอด Auto Revenue มาจากเคสบริการที่ชำระเงินจริงของแต่ละแผนก + ยอด Manual Injected ที่เติมเข้ามา
              </p>
            </div>

            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full text-xs">
                <thead className="bg-navy-800/60 text-gray-400">
                  <tr>
                    <th className="text-left px-4 py-3">แผนกงาน</th>
                    <th className="text-right px-4 py-3">รายรับบริการจริง (Auto)</th>
                    <th className="text-right px-4 py-3">งบเติมพิเศษ (Manual)</th>
                    <th className="text-right px-4 py-3 font-bold text-amber-400">งบรวมของแผนก (BC)</th>
                  </tr>
                </thead>
                <tbody>
                  {(Object.keys(financeOverview.departmentBreakdown) as Department[]).map((dept) => {
                    const d = financeOverview.departmentBreakdown[dept];
                    return (
                      <tr key={dept} className="border-t border-blue-900/30 hover:bg-navy-800/30">
                        <td className="px-4 py-3.5 text-white font-semibold text-sm">
                          {DEPARTMENT_LABELS[dept]}
                        </td>
                        <td className="px-4 py-3.5 text-right text-emerald-400 font-mono font-semibold">
                          {d.autoRevenue.toLocaleString('th-TH')} BC
                        </td>
                        <td className="px-4 py-3.5 text-right text-blue-300 font-mono">
                          {d.manualBudget > 0 ? `+${d.manualBudget.toLocaleString('th-TH')} BC` : '—'}
                        </td>
                        <td className="px-4 py-3.5 text-right text-amber-400 font-mono font-bold text-base">
                          {d.totalEarned.toLocaleString('th-TH')} BC
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
       * Modal 1: เติมงบประมาณ / เพิ่มงบพิเศษ (Manual Injection Modal)
       * ========================================================================= */}
      {showInjectModal && (
        <InjectBudgetModal
          currentOfficer={currentOfficer}
          onClose={() => setShowInjectModal(false)}
          onSaved={async () => {
            setShowInjectModal(false);
            await fetchAll();
          }}
        />
      )}

      {/* =========================================================================
       * Modal 2: ตั้งเรทค่าขึ้นเวรทุกคนเท่ากัน (Batch Duty Rate Modal)
       * ========================================================================= */}
      {showDutyRateModal && (
        <BatchDutyRateModal
          onClose={() => setShowDutyRateModal(false)}
          onSaved={async () => {
            setShowDutyRateModal(false);
            await fetchAll();
          }}
        />
      )}

      {/* =========================================================================
       * Modal 3: ตั้งค่า % สัดส่วนแบ่งรายได้เคสบริการ (Staff Share % Modal)
       * ========================================================================= */}
      {showShareConfigModal && (
        <ShareConfigModal
          currentPercent={staffSharePercent}
          currentOfficer={currentOfficer}
          onClose={() => setShowShareConfigModal(false)}
          onSaved={async (newPct) => {
            setStaffSharePercent(newPct);
            setShowShareConfigModal(false);
            await fetchAll();
          }}
        />
      )}
    </FadeIn>
  );
}

/* =========================================================================
 * Subcomponent: InjectBudgetModal (เติมงบพิเศษ / เงินสนับสนุน)
 * ========================================================================= */
function InjectBudgetModal({
  currentOfficer,
  onClose,
  onSaved,
}: {
  currentOfficer: Officer | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [department, setDepartment] = useState<string>('all');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const presets = [5000, 10000, 20000, 50000, 100000];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const num = parseFloat(amount);
    if (isNaN(num) || num <= 0) {
      alert('กรุณาระบุจำนวนเงินที่ถูกต้อง (มากกว่า 0)');
      return;
    }
    if (!currentOfficer) return;

    setSubmitting(true);
    try {
      await addManualBudgetInjection(num, department, reason, {
        id: currentOfficer.id,
        name: currentOfficer.name,
        rank: currentOfficer.rank,
      });
      alert(`เติมงบประมาณจำนวน ${num.toLocaleString('th-TH')} BC เรียบร้อยแล้ว`);
      onSaved();
    } catch (err) {
      alert(`เกิดข้อผิดพลาด: ${(err as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="➕ เติมงบประมาณ / เพิ่มงบพิเศษ (Manual Injection)" onClose={onClose} size="md">
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-xs text-gray-400">
          สำหรับคีย์เงินสนับสนุนพิเศษ, เงินกิจกรรม RP, หรืองบนอกระบบเข้ามาในกองกลางหน่วยงาน
        </p>

        <div>
          <label className="block text-xs text-gray-400 mb-1.5">เลือกจำนวนเงินด่วน:</label>
          <div className="flex flex-wrap gap-1.5">
            {presets.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setAmount(p.toString())}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold font-mono border transition-all ${
                  amount === p.toString()
                    ? 'bg-amber-500 text-black border-amber-400 font-bold'
                    : 'bg-navy-800 text-gray-300 border-blue-900/60 hover:border-amber-500/40'
                }`}
              >
                +{p.toLocaleString('th-TH')} BC
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">จำนวนเงิน (BC) *</label>
          <input
            required
            type="number"
            min={1}
            step="100"
            className="input-field font-mono text-lg font-bold text-amber-400"
            placeholder="เช่น 10000"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">จัดสรรเข้าแผนก</label>
          <select
            className="input-field text-sm"
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
          >
            <option value="all">กองกลางทุกแผนก (เฉลี่ยเท่ากัน 5 แผนก)</option>
            <option value="civil_maintenance">{DEPARTMENT_LABELS.civil_maintenance}</option>
            <option value="vehicle_rescue">{DEPARTMENT_LABELS.vehicle_rescue}</option>
            <option value="electrical">{DEPARTMENT_LABELS.electrical}</option>
            <option value="traffic_management">{DEPARTMENT_LABELS.traffic_management}</option>
            <option value="emergency_assistance">{DEPARTMENT_LABELS.emergency_assistance}</option>
          </select>
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">เหตุผล / ที่มาของงบ</label>
          <input
            type="text"
            className="input-field text-sm"
            placeholder="เช่น เงินสนับสนุนจากรัฐบาล, เงินรางวัลพิเศษ RP"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>

        <div className="flex gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">ยกเลิก</button>
          <button
            type="submit"
            disabled={submitting}
            className="btn-primary flex-1 flex items-center justify-center gap-1.5 shadow-lg shadow-amber-500/20 disabled:opacity-50"
          >
            <Plus size={15} /> {submitting ? 'กำลังบันทึก...' : 'บันทึกเติมงบ'}
          </button>
        </div>
      </form>
    </Modal>
  );
}



/* =========================================================================
 * Subcomponent: ShareConfigModal (ตั้งค่า % สัดส่วนแบ่งบริการ Staff Pool)
 * ========================================================================= */
function ShareConfigModal({
  currentPercent,
  currentOfficer,
  onClose,
  onSaved,
}: {
  currentPercent: number;
  currentOfficer: Officer | null;
  onClose: () => void;
  onSaved: (pct: number) => void;
}) {
  const [percent, setPercent] = useState<number>(currentPercent);
  const [saving, setSaving] = useState(false);

  const presets = [10, 15, 20, 30, 50];

  async function handleSave() {
    if (percent < 0 || percent > 100) {
      alert('เปอร์เซ็นต์ต้องอยู่ระหว่าง 0 - 100%');
      return;
    }
    setSaving(true);
    try {
      await updateRevenueConfig('default', percent, 100 - percent, `ปรับสัดส่วนพนักงาน ${percent}% / กองกลาง ${100 - percent}%`, currentOfficer?.id ?? '');
      await updateRevenueConfig('vehicle_rescue', percent, 100 - percent, `ปรับสัดส่วนพนักงาน ${percent}% / กองกลาง ${100 - percent}%`, currentOfficer?.id ?? '');
      alert(`บันทึกสัดส่วนพนักงาน ${percent}% และกองกลาง ${100 - percent}% เรียบร้อยแล้ว`);
      onSaved(percent);
    } catch (e) {
      alert(`เกิดข้อผิดพลาด: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="⚙️ ตั้งค่าสัดส่วนแบ่งรายได้เคสบริการ (Staff Pool)" onClose={onClose} size="md">
      <div className="space-y-4">
        <p className="text-xs text-gray-400">
          กำหนดเปอร์เซ็นต์จากยอดบริการที่ชำระแล้ว ที่จะนำมาตัดเข้ากองเงินจ่ายส่วนแบ่งให้เจ้าหน้าที่ผู้ดูแลเคส
        </p>

        <div>
          <label className="block text-xs text-gray-400 mb-1.5">เลือกเปอร์เซ็นต์ด่วน:</label>
          <div className="grid grid-cols-5 gap-1.5">
            {presets.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPercent(p)}
                className={`py-2 rounded-lg text-xs font-bold font-mono border transition-all ${
                  percent === p
                    ? 'bg-emerald-500 text-black border-emerald-400 font-bold'
                    : 'bg-navy-800 text-gray-300 border-blue-900/60 hover:border-emerald-500/40'
                }`}
              >
                {p}%
              </button>
            ))}
          </div>
        </div>

        <div className="card p-3 bg-navy-900 border border-blue-900/60 space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-emerald-400 font-medium">สัดส่วนเจ้าหน้าที่ (Staff Pool):</span>
            <span className="text-emerald-400 font-mono font-bold">{percent}%</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-amber-400 font-medium">สัดส่วนกองกลางกรม (Central Fund):</span>
            <span className="text-amber-400 font-mono font-bold">{100 - percent}%</span>
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">ยกเลิก</button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="btn-primary flex-1 flex items-center justify-center gap-1.5 shadow-lg shadow-amber-500/20 disabled:opacity-50"
          >
            <Check size={14} /> {saving ? 'กำลังบันทึก...' : 'บันทึก'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
