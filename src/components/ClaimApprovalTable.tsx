import { useEffect, useState } from 'react';
import {
  CheckCircle2, XCircle, Loader2, AlertTriangle, HandCoins, Wallet, RefreshCw, Filter, Truck, Wrench,
} from 'lucide-react';
import { Badge } from './Badge';
import {
  fetchPendingClaims, fetchApprovedClaims,
  approveClaim, rejectClaim, markClaimPaid, translateClaimError, ClaimScope,
} from '../lib/api/claimShare';
import { ClaimRecord, Officer } from '../lib/types';

interface Props {
  approverId: string;
  officers: Officer[];
  onChanged?: () => Promise<void> | void;
}

type SubTab = 'pending' | 'approved';

const SCOPE_LABELS: Record<ClaimScope, { label: string; icon: typeof HandCoins }> = {
  default: { label: 'เคสทั่วไป', icon: Wrench },
  vehicle_rescue: { label: 'กู้ภัยรถยก', icon: Truck },
};

export function ClaimApprovalTable({ approverId, officers, onChanged }: Props) {
  const [subTab, setSubTab] = useState<SubTab>('pending');
  const [pending, setPending] = useState<ClaimRecord[]>([]);
  const [approved, setApproved] = useState<ClaimRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [actioning, setActioning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [scopeFilter, setScopeFilter] = useState<ClaimScope | 'all'>('all');
  const [rejectModal, setRejectModal] = useState<{ claimId: string; reason: string } | null>(null);

  const officerMap = new Map(officers.map((o) => [o.id, o]));

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [p, a] = await Promise.all([fetchPendingClaims(approverId), fetchApprovedClaims(approverId)]);
      setPending(p);
      setApproved(a);
    } catch (e) {
      setError(translateClaimError(e as { code?: string; message?: string }));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleApprove(claimId: string) {
    setActioning(claimId);
    setError(null);
    setSuccessMsg(null);
    try {
      await approveClaim(claimId, approverId);
      setSuccessMsg('อนุมัติเรียบร้อย · ยอดเข้าสะสมรอจ่าย');
      await load();
      await onChanged?.();
    } catch (e) {
      setError(translateClaimError(e as { code?: string; message?: string }));
    } finally {
      setActioning(null);
    }
  }

  async function handleReject(claimId: string, reason: string) {
    if (!reason.trim()) return;
    setActioning(claimId);
    setError(null);
    try {
      await rejectClaim(claimId, approverId, reason.trim());
      setSuccessMsg('ปฏิเสธเรียบร้อย');
      setRejectModal(null);
      await load();
      await onChanged?.();
    } catch (e) {
      setError(translateClaimError(e as { code?: string; message?: string }));
    } finally {
      setActioning(null);
    }
  }

  async function handleMarkPaid(claimId: string) {
    if (!confirm('ยืนยันการจ่ายเงินตามรายการนี้? ยอดจะถูกตัดออกจากยอดสะสมรอจ่าย')) return;
    setActioning(claimId);
    setError(null);
    try {
      await markClaimPaid(claimId, approverId);
      setSuccessMsg('บันทึกการจ่ายเรียบร้อย · ยอดสะสมหักแล้ว');
      await load();
      await onChanged?.();
    } catch (e) {
      setError(translateClaimError(e as { code?: string; message?: string }));
    } finally {
      setActioning(null);
    }
  }

  const filteredPending = scopeFilter === 'all' ? pending : pending.filter((c) => c.scope === scopeFilter);
  const filteredApproved = scopeFilter === 'all' ? approved : approved.filter((c) => c.scope === scopeFilter);

  const totalPendingAmount = filteredPending.reduce((s, c) => s + c.amount, 0);
  const totalApprovedAmount = filteredApproved.reduce((s, c) => s + c.amount, 0);
  const totalAccumulated = officers.reduce((s, o) => s + (o.accumulated_share ?? 0), 0);

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <div className="card p-3 border-amber-500/30 bg-amber-500/5">
          <div className="flex items-center gap-2 text-xs text-amber-300">
            <HandCoins size={14} /> รออนุมัติ {scopeFilter !== 'all' && `(${SCOPE_LABELS[scopeFilter].label})`}
          </div>
          <div className="text-xl font-black text-amber-300 font-mono mt-1">
            {filteredPending.length} <span className="text-xs font-normal text-gray-400">รายการ</span>
          </div>
          <div className="text-[10px] text-amber-300/70 mt-0.5">
            ยอดรวม {totalPendingAmount.toLocaleString('th-TH', { maximumFractionDigits: 2 })} BC
          </div>
        </div>

        <div className="card p-3 border-emerald-500/30 bg-emerald-500/5">
          <div className="flex items-center gap-2 text-xs text-emerald-300">
            <CheckCircle2 size={14} /> อนุมัติแล้ว · รอจ่าย {scopeFilter !== 'all' && `(${SCOPE_LABELS[scopeFilter].label})`}
          </div>
          <div className="text-xl font-black text-emerald-300 font-mono mt-1">
            {filteredApproved.length} <span className="text-xs font-normal text-gray-400">รายการ</span>
          </div>
          <div className="text-[10px] text-emerald-300/70 mt-0.5">
            ยอดรวม {totalApprovedAmount.toLocaleString('th-TH', { maximumFractionDigits: 2 })} BC
          </div>
        </div>

        <div className="card p-3 border-blue-500/30 bg-blue-500/5">
          <div className="flex items-center gap-2 text-xs text-blue-300">
            <Wallet size={14} /> ยอดสะสมรอจ่าย (ทุกคน)
          </div>
          <div className="text-xl font-black text-blue-300 font-mono mt-1">
            {totalAccumulated.toLocaleString('th-TH', { maximumFractionDigits: 2 })}
          </div>
          <div className="text-[10px] text-blue-300/70 mt-0.5">
            จาก {officers.filter((o) => (o.accumulated_share ?? 0) > 0).length} คน
          </div>
        </div>
      </div>

      {/* Sub-tab + filter */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-1.5">
          {[
            { key: 'pending' as const, label: 'รออนุมัติ', count: pending.length },
            { key: 'approved' as const, label: 'อนุมัติแล้ว · รอจ่าย', count: approved.length },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setSubTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                subTab === t.key
                  ? 'bg-amber-500 text-navy-900 shadow-md shadow-amber-500/20'
                  : 'bg-navy-700/60 text-gray-400 hover:text-white border border-blue-900/40'
              }`}
            >
              {t.label}
              <span className={`px-1.5 rounded-full text-[10px] ${subTab === t.key ? 'bg-navy-900/30' : 'bg-navy-600/60'}`}>
                {t.count}
              </span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            <Filter size={12} /> Scope:
          </div>
          <select
            value={scopeFilter}
            onChange={(e) => setScopeFilter(e.target.value as ClaimScope | 'all')}
            className="bg-navy-800 border border-blue-900/50 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500"
          >
            <option value="all">ทั้งหมด</option>
            {(Object.keys(SCOPE_LABELS) as ClaimScope[]).map((s) => (
              <option key={s} value={s}>{SCOPE_LABELS[s].label}</option>
            ))}
          </select>
          <button
            onClick={load}
            disabled={loading}
            className="p-1.5 rounded-lg bg-navy-700/60 border border-blue-900/40 text-gray-400 hover:text-white"
            title="รีเฟรช"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-xs">
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
      {successMsg && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs">
          <CheckCircle2 size={14} className="flex-shrink-0 mt-0.5" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Table */}
      {loading && pending.length === 0 && approved.length === 0 ? (
        <div className="text-center text-gray-500 py-12 flex flex-col items-center gap-2">
          <Loader2 className="animate-spin text-amber-400" size={24} />
          <span className="text-sm">กำลังโหลดรายการ claim...</span>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-navy-900/60 border-b border-blue-900/40 text-gray-400">
              <tr>
                <th className="text-left py-2.5 px-3">เจ้าหน้าที่</th>
                <th className="text-left py-2.5 px-3">งวด</th>
                <th className="text-left py-2.5 px-3">Scope</th>
                <th className="text-right py-2.5 px-3">ยอด</th>
                <th className="text-left py-2.5 px-3">หมายเหตุ</th>
                <th className="text-right py-2.5 px-3">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {(subTab === 'pending' ? filteredPending : filteredApproved).map((c) => {
                const officer = officerMap.get(c.officer_id);
                const ScopeIcon = SCOPE_LABELS[c.scope].icon;
                const isActioning = actioning === c.id;
                return (
                  <tr key={c.id} className="border-b border-blue-900/20 hover:bg-navy-800/40">
                    <td className="py-2 px-3">
                      <div className="text-white font-medium">{officer?.name ?? '—'}</div>
                      <div className="text-[10px] text-gray-500">@{officer?.username ?? '—'}</div>
                    </td>
                    <td className="py-2 px-3 text-gray-300 font-mono">{c.claim_period}</td>
                    <td className="py-2 px-3">
                      <span className="inline-flex items-center gap-1 text-gray-300">
                        <ScopeIcon size={12} className="text-amber-400" />
                        {SCOPE_LABELS[c.scope].label}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right text-amber-300 font-mono font-semibold">
                      {c.amount.toLocaleString('th-TH', { maximumFractionDigits: 2 })}
                    </td>
                    <td className="py-2 px-3 text-gray-400 text-[10px] max-w-xs truncate">
                      {c.note || '—'}
                    </td>
                    <td className="py-2 px-3">
                      {subTab === 'pending' ? (
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => handleApprove(c.id)}
                            disabled={isActioning}
                            className="flex items-center gap-1 px-2 py-1 rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 disabled:opacity-40 text-[10px]"
                          >
                            {isActioning ? <Loader2 size={10} className="animate-spin" /> : <CheckCircle2 size={10} />}
                            อนุมัติ
                          </button>
                          <button
                            onClick={() => setRejectModal({ claimId: c.id, reason: '' })}
                            disabled={isActioning}
                            className="flex items-center gap-1 px-2 py-1 rounded bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/30 disabled:opacity-40 text-[10px]"
                          >
                            <XCircle size={10} /> ปฏิเสธ
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-end">
                          <button
                            onClick={() => handleMarkPaid(c.id)}
                            disabled={isActioning}
                            className="flex items-center gap-1 px-2 py-1 rounded bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 border border-blue-500/30 disabled:opacity-40 text-[10px]"
                          >
                            {isActioning ? <Loader2 size={10} className="animate-spin" /> : <Wallet size={10} />}
                            จ่ายแล้ว
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {(subTab === 'pending' ? filteredPending : filteredApproved).length === 0 && (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-gray-500 text-sm">
                    {subTab === 'pending' ? 'ไม่มีรายการรออนุมัติ' : 'ไม่มีรายการรอจ่าย'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Reject modal */}
      {rejectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setRejectModal(null)} />
          <div className="modal-shell max-w-sm w-full p-6 relative">
            <h3 className="text-lg font-semibold text-white mb-3">ปฏิเสธคำขอรับส่วนแบ่ง</h3>
            <p className="text-xs text-gray-400 mb-3">กรุณาระบุเหตุผลในการปฏิเสธ</p>
            <textarea
              autoFocus
              value={rejectModal.reason}
              onChange={(e) => setRejectModal({ ...rejectModal, reason: e.target.value })}
              placeholder="เช่น ยอดไม่ถูกต้อง / รอตรวจสอบข้อมูล"
              className="w-full bg-navy-900 border border-blue-900/50 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500 mb-3"
              rows={3}
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setRejectModal(null)}
                className="px-3 py-1.5 text-xs text-gray-300 hover:text-white border border-blue-900/50 rounded-lg"
              >
                ยกเลิก
              </button>
              <button
                onClick={() => handleReject(rejectModal.claimId, rejectModal.reason)}
                disabled={!rejectModal.reason.trim() || actioning === rejectModal.claimId}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-500 hover:bg-red-600 text-white disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {actioning === rejectModal.claimId ? 'กำลังปฏิเสธ...' : 'ยืนยันปฏิเสธ'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
