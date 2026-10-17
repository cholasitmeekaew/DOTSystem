/**
 * ตารางกดรับส่วนแบ่งเคสรายเดือน ให้หัวหน้ากรม
 *
 * เจ้าหน้าที่รับส่วนแบ่งเองได้จากเมนู "รับส่วนแบ่งเคส"
 * แต่ถ้าคนนั้นไม่กด (ลืม ปิดเครื่อง เปิดเวรใหม่) หัวหน้ากรมต้องกดให้ได้
 * โดยระบบจะรวมทุกเดือนที่ค้างให้ในครั้งเดียว
 */

import { useCallback, useEffect, useState } from 'react';
import { HandCoins, Loader2, AlertTriangle, ChevronDown, ChevronUp, CheckCircle2 } from 'lucide-react';
import { ConfirmDialog } from './Modal';
import {
  fetchPendingClaimSummary, submitClaim, translateClaimError,
  claimAllPending, clearPendingClaims, fetchPendingClaims,
} from '../lib/api/claimShare';
import type { PendingClaimSummary } from '../lib/types';

function money(n: number): string {
  return Number(n ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const SCOPE_LABEL: Record<string, string> = {
  default: 'เคสทั่วไป',
  vehicle_rescue: 'กู้ภัย / ยกรถ',
};

export function PendingClaimManager({
  actorId,
  onChanged,
}: {
  actorId: string;
  /** เรียกหลังกดรับสำเร็จ เพื่อให้แท็บอื่นรีเฟรช */
  onChanged?: () => void;
}) {
  const [rows, setRows] = useState<PendingClaimSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [confirming, setConfirming] = useState<PendingClaimSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [progress, setProgress] = useState('');
  const [pendingCount, setPendingCount] = useState(0);
  const [confirmAll, setConfirmAll] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await fetchPendingClaimSummary());
      // นับคำขอที่รออนุมัติ เพื่อให้ปุ่มล้างรู้ว่าจะมีอะไรให้ล้าง
      const pending = await fetchPendingClaims(actorId);
      setPendingCount(pending.length);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [actorId]);

  useEffect(() => { void load(); }, [load]);

  // จัดกลุ่มตามเจ้าหน้าที่
  const byOfficer = rows.reduce<Record<string, {
    name: string;
    total: number;
    count: number;
    months: PendingClaimSummary[];
  }>>((acc, r) => {
    const cur = acc[r.officer_id] ?? { name: r.officer_name, total: 0, count: 0, months: [] };
    cur.total += Number(r.officer_total ?? 0);
    cur.count += Number(r.record_count ?? 0);
    cur.months.push(r);
    acc[r.officer_id] = cur;
    return acc;
  }, {});

  const entries = Object.entries(byOfficer).sort((a, b) => b[1].total - a[1].total);

  /** กดรับส่วนแบ่งให้ทุกคนที่มีค้าง ในครั้งเดียว */
  async function doClaimAll() {
    setBusy(true);
    setError(null);
    setProgress('กำลังเริ่ม...');
    try {
      const res = await claimAllPending(actorId, (done, total, name) => {
        setProgress(`กดรับให้ ${name}… (${done + 1}/${total})`);
      });
      setConfirmAll(false);
      setProgress('');
      if (res.officers === 0) {
        setNotice({ kind: 'ok', text: 'ไม่มีส่วนแบ่งค้างสำหรับใคร' });
      } else {
        setNotice({
          kind: res.errors.length ? 'err' : 'ok',
          text: `กดรับให้ ${res.officers} คน · ${res.claims} รายการ · `
            + `รวม ${res.total.toLocaleString('th-TH', { minimumFractionDigits: 2 })} BC`
            + (res.errors.length ? ` · ล้มเหลว ${res.errors.length} คน` : ''),
        });
      }
      await load();
      onChanged?.();
    } catch (e) {
      setError(translateClaimError(e as { code?: string; message?: string }));
      setConfirmAll(false);
      setProgress('');
    } finally {
      setBusy(false);
    }
  }

  /** ล้างคำขอรออนุมัติทั้งหมด (เจ้าหน้าที่จะกดรับใหม่ได้) */
  async function doClear() {
    setBusy(true);
    setError(null);
    try {
      const res = await clearPendingClaims(actorId);
      setConfirmClear(false);
      setNotice({
        kind: 'ok',
        text: res.deleted > 0
          ? `ล้างคำขอรออนุมัติ ${res.deleted} รายการแล้ว — `
            + 'เจ้าหน้าที่ต้องกดรับส่วนแบ่งใหม่อีกครั้ง'
          : 'ไม่มีคำขอรออนุมัติให้ล้าง',
      });
      await load();
      onChanged?.();
    } catch (e) {
      setError((e as Error).message);
      setConfirmClear(false);
    } finally {
      setBusy(false);
    }
  }

  async function doClaim(target: PendingClaimSummary) {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      await submitClaim(
        target.officer_id,
        target.month,          // กดเดือนที่ค้างมากที่สุด = รวมทุกเดือนก่อนหน้า
        target.scope as 'default' | 'vehicle_rescue',
        actorId,
        'หัวหน้ากรมกดรับแทน (รวมเดือนค้าง)',
      );
      setConfirming(null);
      setNotice({ kind: 'ok', text: `กดรับส่วนแบ่งให้ ${target.officer_name} เรียบร้อย` });
      await load();
      onChanged?.();
    } catch (e) {
      setError(translateClaimError(e as { code?: string; message?: string }));
      setConfirming(null);
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="py-10 flex justify-center">
        <Loader2 size={22} className="text-amber-400 animate-spin" />
      </div>
    );
  }

  if (error && entries.length === 0) {
    return (
      <div className="py-8 text-center">
        <AlertTriangle size={22} className="text-red-400 mx-auto mb-2" />
        <p className="text-sm text-red-300">{error}</p>
        <p className="text-[11px] text-gray-500 mt-1">
          ถ้าเห็น "ฟังก์ชันไม่มี" ให้รัน migration 0040_claim_accumulate.sql
        </p>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="py-10 text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/25 mb-3">
          <CheckCircle2 size={22} className="text-emerald-400" />
        </div>
        <p className="text-sm font-semibold text-emerald-300">ไม่มีส่วนแบ่งค้าง</p>
        <p className="text-xs text-gray-400 mt-1 max-w-sm mx-auto leading-relaxed">
          ทุกเคสที่ชำระเงินแล้วได้รับส่วนแบ่งครบแล้วทุกเดือน
        </p>
        {pendingCount > 0 && (
          <p className="text-[11px] text-amber-400 mt-3">
            (ยังมีคำขอรออนุมัติ {pendingCount} รายการ ดูได้ในตารางอนุมัติด้านล่าง)
          </p>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="p-4 border-b border-blue-900/40 flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/25 flex items-center justify-center flex-shrink-0">
          <HandCoins size={16} className="text-amber-400" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-white">กดรับส่วนแบ่งแทนเจ้าหน้าที่</h3>
          <p className="text-[11px] text-gray-400 mt-0.5 leading-relaxed">
            สำหรับเดือนที่เจ้าหน้าที่ลืมกดรับเอง ·
            กดปุ่มของคนนั้นได้เลย ระบบจะรวมทุกเดือนที่ค้างให้ในครั้งเดียว
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-1.5 mt-1">
          <button
            onClick={() => setConfirmAll(true)}
            disabled={busy || entries.length === 0}
            className="btn-primary text-[11px] py-1.5 px-3 flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
            title="กดรับให้ทุกคนที่ยังมีส่วนแบ่งค้าง ในครั้งเดียว"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <HandCoins size={12} />}
            กดรับทั้งหมด ({entries.length} คน)
          </button>
          <button
            onClick={() => setConfirmClear(true)}
            disabled={busy || pendingCount === 0}
            className="btn-secondary text-[11px] py-1.5 px-3 flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
            title="ล้างคำขอรออนุมัติทั้งหมด (เจ้าหน้าที่ต้องกดรับใหม่)"
          >
            <AlertTriangle size={12} className="text-amber-400" />
            ล้างรออนุมัติ ({pendingCount})
          </button>
        </div>
      </div>

      {progress && (
        <div className="mx-4 mt-3 px-3 py-2 rounded-lg text-xs bg-navy-800 border border-amber-500/25 text-amber-200 flex items-center gap-2">
          <Loader2 size={12} className="animate-spin" /> {progress}
        </div>
      )}

      {notice && (
        <div className={`mx-4 mt-3 px-3 py-2 rounded-lg text-xs ${
          notice.kind === 'ok'
            ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/25'
            : 'bg-red-500/10 text-red-300 border border-red-500/25'
        }`}
        >
          {notice.text}
        </div>
      )}
      {error && entries.length > 0 && (
        <div className="mx-4 mt-3 px-3 py-2 rounded-lg text-xs bg-red-500/10 text-red-300 border border-red-500/25">
          {error}
        </div>
      )}

      <div className="p-4 space-y-2">
        {entries.map(([officerId, g]) => {
          const months = [...g.months].sort((a, b) => b.month.localeCompare(a.month));
          const latest = months[0];
          const isOpen = !!expanded[officerId];

          return (
            <div key={officerId} className="rounded-lg border border-blue-900/40 bg-navy-800/40 overflow-hidden">
              <div className="flex items-center gap-3 p-3">
                <button
                  onClick={() => setExpanded((s) => ({ ...s, [officerId]: !isOpen }))}
                  className="flex items-center gap-2 min-w-0 flex-1 text-left"
                >
                  {isOpen
                    ? <ChevronUp size={14} className="text-gray-500 flex-shrink-0" />
                    : <ChevronDown size={14} className="text-gray-500 flex-shrink-0" />}
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-white truncate">{g.name}</span>
                    <span className="block text-[11px] text-gray-500">
                      {months.length} เดือนค้าง · {g.count} เคส
                    </span>
                  </span>
                </button>

                <div className="text-right flex-shrink-0">
                  <div className="text-sm font-black text-amber-300">{money(g.total)} BC</div>
                </div>

                <button
                  onClick={() => setConfirming(latest)}
                  disabled={busy || !latest}
                  className="btn-primary text-[11px] py-1.5 px-3 flex-shrink-0 disabled:opacity-40"
                  title={`กดรับให้ ${g.name} รวมทุกเดือนค้าง`}
                >
                  {busy && confirming?.officer_id === officerId
                    ? <Loader2 size={12} className="animate-spin" />
                    : 'กดรับ'}
                </button>
              </div>

              {isOpen && (
                <div className="px-3 pb-3 space-y-1">
                  {months.map((m) => (
                    <div
                      key={m.month + m.scope}
                      className="flex items-center justify-between gap-3 py-1.5 px-2.5 rounded bg-navy-900/50"
                    >
                      <span className="text-[11px] text-gray-300">
                        {m.month} · {SCOPE_LABEL[m.scope] ?? m.scope} · {m.record_count} เคส
                      </span>
                      <span className="text-[11px] font-semibold text-amber-300">
                        {money(m.officer_total)} BC
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {confirmAll && (
        <ConfirmDialog
          title="ยืนยันกดรับส่วนแบ่งทั้งหมด"
          message={
            `จะกดรับส่วนแบ่งให้ทุกคนที่ยังมีส่วนแบ่งค้าง ${entries.length} คน `
            + `(รวมทุกเดือนที่ค้างของแต่ละคน)\n\n`
            + 'ทุกรายการจะเข้าคิวรอการอนุมัติของคุณ'
          }
          confirmLabel="กดรับทั้งหมด"
          onConfirm={doClaimAll}
          onCancel={() => { setConfirmAll(false); setProgress(''); }}
        />
      )}

      {confirmClear && (
        <ConfirmDialog
          title="ล้างคำขอรออนุมัติทั้งหมด"
          danger
          message={
            `จะลบคำขอรออนุมัติ ${pendingCount} รายการออกทั้งหมด\n\n`
            + 'เจ้าหน้าที่จะต้องกดรับส่วนแบ่งใหม่อีกครั้ง\n'
            + 'รายการที่อนุมัติ/จ่ายแล้ว/ไม่อนุมัติ จะไม่ถูกแตะ'
          }
          confirmLabel="ล้างทั้งหมด"
          onConfirm={doClear}
          onCancel={() => setConfirmClear(false)}
        />
      )}

      {confirming && (
        <ConfirmDialog
          title="ยืนยันกดรับส่วนแบ่งแทน"
          message={
            `กดรับส่วนแบ่งให้ ${confirming.officer_name} งวด ${confirming.month} ` +
            `หมวด${SCOPE_LABEL[confirming.scope] ?? confirming.scope}\n\n` +
            'ระบบจะรวมทุกเดือนที่ค้างก่อนหน้าให้ด้วย แล้วเข้าคิวรอการอนุมัติ'
          }
          confirmLabel="กดรับ"
          onConfirm={() => doClaim(confirming)}
          onCancel={() => setConfirming(null)}
        />
      )}
    </>
  );
}
