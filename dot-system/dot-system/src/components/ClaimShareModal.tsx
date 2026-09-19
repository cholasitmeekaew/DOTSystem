import { useEffect, useState } from 'react';
import { HandCoins, Truck, Wrench, CheckCircle2, AlertTriangle, Loader2, Calendar } from 'lucide-react';
import { Modal } from './Modal';
import { Badge } from './Badge';
import {
  previewClaimShare, submitClaim, translateClaimError, ClaimScope,
} from '../lib/api/claimShare';
import { ClaimPreview } from '../lib/types';

interface Props {
  officerId: string;
  actorId: string;
  onClose: () => void;
  onSuccess?: () => void;
}

const SCOPE_LABELS: Record<ClaimScope, { label: string; icon: typeof HandCoins }> = {
  default: { label: 'เคสทั่วไป', icon: Wrench },
  vehicle_rescue: { label: 'กู้ภัยรถยก', icon: Truck },
};

function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7);
}

export function ClaimShareModal({ officerId, actorId, onClose, onSuccess }: Props) {
  const [period, setPeriod] = useState<string>(currentPeriod());
  const [scope, setScope] = useState<ClaimScope>('default');
  const [preview, setPreview] = useState<ClaimPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ amount: number; count: number } | null>(null);
  const [note, setNote] = useState<string>('');

  async function loadPreview() {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const p = await previewClaimShare(officerId, period, scope);
      setPreview(p);
    } catch (e) {
      const err = e as { code?: string; message?: string };
      setError(translateClaimError(err));
      setPreview(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [officerId, period, scope]);

  async function handleSubmit() {
    if (!preview || preview.record_count === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await submitClaim(officerId, period, scope, actorId, note || undefined);
      if (result.success) {
        setSuccess({ amount: result.total_amount, count: result.record_count });
        setPreview({ ...preview, record_count: 0, gross_amount: 0, per_officer_total: 0, records: [] });
        onSuccess?.();
      } else {
        setError('ส่งคำขอไม่สำเร็จ กรุณาลองใหม่');
      }
    } catch (e) {
      const err = e as { code?: string; message?: string };
      setError(translateClaimError(err));
    } finally {
      setSubmitting(false);
    }
  }

  const ScopeIcon = SCOPE_LABELS[scope].icon;
  const canClaim = preview && preview.record_count > 0 && !success;

  return (
    <Modal title="กดรับส่วนแบ่งเคส" onClose={onClose} size="lg">
      <div className="space-y-4">
        {/* Period + Scope selectors */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">
              <Calendar size={12} className="inline mr-1" /> งวดเดือน
            </label>
            <input
              type="month"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="w-full bg-navy-900 border border-blue-900/50 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">ประเภทเคส</label>
            <div className="flex gap-1.5">
              {(Object.keys(SCOPE_LABELS) as ClaimScope[]).map((s) => {
                const Icon = SCOPE_LABELS[s].icon;
                const active = s === scope;
                return (
                  <button
                    key={s}
                    onClick={() => setScope(s)}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all border ${
                      active
                        ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                        : 'bg-navy-900 text-gray-400 border-blue-900/40 hover:text-white hover:bg-navy-700'
                    }`}
                  >
                    <Icon size={14} /> {SCOPE_LABELS[s].label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Loading state */}
        {loading && (
          <div className="flex items-center justify-center py-8 text-gray-400">
            <Loader2 size={20} className="animate-spin mr-2" /> กำลังคำนวณ...
          </div>
        )}

        {/* Error state */}
        {error && !loading && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-xs">
            <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Success state */}
        {success && (
          <div className="flex items-start gap-3 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
            <CheckCircle2 size={20} className="text-emerald-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-emerald-300">ส่งคำขอรับส่วนแบ่งสำเร็จ</p>
              <p className="text-xs text-emerald-300/80 mt-1">
                ยอด {success.amount.toLocaleString('th-TH', { maximumFractionDigits: 2 })} BC
                {' · '}จำนวน {success.count} รายการ
                {' · '}สถานะ: <Badge variant="warning">รอ Commissioner อนุมัติ</Badge>
              </p>
            </div>
          </div>
        )}

        {/* Preview summary */}
        {preview && !loading && (
          <div className="card p-4 bg-navy-800/60">
            <div className="flex items-center gap-2 mb-3">
              <ScopeIcon size={16} className="text-amber-400" />
              <h3 className="text-sm font-semibold text-white">
                สรุปยอดส่วนแบ่ง — {SCOPE_LABELS[scope].label}
              </h3>
              <span className="text-[10px] text-gray-500 ml-auto">
                งวด {period} · สัดส่วน {preview.officer_share_percent}%
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2 mb-3">
              <div className="px-3 py-2 rounded-lg bg-navy-900/60 border border-blue-900/40">
                <div className="text-[10px] text-gray-500">จำนวนรายการ</div>
                <div className="text-lg font-bold text-white">{preview.record_count}</div>
              </div>
              <div className="px-3 py-2 rounded-lg bg-navy-900/60 border border-blue-900/40">
                <div className="text-[10px] text-gray-500">ยอด Paid รวม</div>
                <div className="text-lg font-bold text-gray-300">
                  {preview.gross_amount.toLocaleString('th-TH', { maximumFractionDigits: 0 })}
                </div>
              </div>
              <div className="px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30">
                <div className="text-[10px] text-amber-400">ยอดที่คุณจะได้</div>
                <div className="text-lg font-bold text-amber-300">
                  {preview.per_officer_total.toLocaleString('th-TH', { maximumFractionDigits: 2 })}
                </div>
              </div>
            </div>

            {preview.records.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer text-gray-400 hover:text-amber-400 transition-colors">
                  ดูรายละเอียด {preview.records.length} รายการ
                </summary>
                <div className="mt-2 max-h-40 overflow-y-auto space-y-1 pr-1">
                  {preview.records.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center justify-between gap-2 px-2 py-1.5 rounded bg-navy-900/40"
                    >
                      <span className="text-gray-300 truncate flex-1">{r.service_name}</span>
                      <span className="text-[10px] text-gray-500 whitespace-nowrap">
                        ÷ {r.assigned_count} คน
                      </span>
                      <span className="text-amber-300 font-mono whitespace-nowrap">
                        +{r.per_officer_share.toLocaleString('th-TH', { maximumFractionDigits: 2 })}
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}

        {/* Note input */}
        {canClaim && (
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">
              หมายเหตุ (ไม่บังคับ)
            </label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="เช่น ขอรับยอดประจำงวดเดือน ม.ค."
              className="w-full bg-navy-900 border border-blue-900/50 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500"
            />
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 justify-end pt-2 border-t border-blue-900/40">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-300 hover:text-white border border-blue-900/50 rounded-lg transition-colors"
          >
            {success ? 'ปิด' : 'ยกเลิก'}
          </button>
          {canClaim && (
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="flex items-center gap-2 px-5 py-2 text-sm font-semibold rounded-lg bg-amber-500 hover:bg-amber-400 text-navy-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors btn-ripple"
            >
              {submitting ? (
                <>
                  <Loader2 size={14} className="animate-spin" /> กำลังส่ง...
                </>
              ) : (
                <>
                  <HandCoins size={14} /> ยืนยันกดรับ
                </>
              )}
            </button>
          )}
        </div>

        <p className="text-[10px] text-gray-500 text-center">
          เมื่อกดยืนยัน ระบบจะสร้างคำขอรอ Commissioner อนุมัติ จากนั้นยอดจะเข้าสะสมใน "ยอดสะสมรอจ่าย"
        </p>
      </div>
    </Modal>
  );
}