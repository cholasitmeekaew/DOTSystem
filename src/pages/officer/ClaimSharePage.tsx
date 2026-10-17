/**
 * หน้า "รับส่วนแบ่งเคส"
 *
 * ใช้ระบบเดิมของการรับส่วนแบ่ง (RPC preview_claim_share / claim_service_share)
 * เพิ่มข้อจำกัดสำคัญ: รับได้เฉพาะงวดที่ปิดเดือนแล้ว
 *
 * เหตุผลที่ต้องปิดงวด
 * ──────────────────────
 * งวดที่ยังไม่สิ้นเดือนยังมีบิลที่จะเข้ามา ถ้าให้รับได้ เจ้าหน้าที่จะต้องกด
 * ซ้ำปลายเดือน และบางเคสอาจถูกนับซ้ำหรือตกหล่น
 * เงื่อนไขนี้บังคับซ้ำที่ชั้นฐานข้อมูลอีกชั้นใน migration 0038
 * เพราะระบบนี้ควบคุมสิทธิ์ฝั่ง UI เป็นหลัก ตรวจฝั่ง client อย่างเดียวไม่พอ
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  HandCoins, Truck, Wrench, Loader2, Calendar, CheckCircle2,
  AlertTriangle, History, Lock, Inbox,
} from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { FadeIn } from '../../components/animations/MotionWrappers';
import { Modal, ConfirmDialog } from '../../components/Modal';
import { useAuth } from '../../lib/AuthContext';
import { supabase } from '../../lib/supabase';
import {
  previewClaimShare, submitClaim, fetchOfficerClaims,
  translateClaimError, claimablePeriods, currentClaimPeriod, isPeriodClosed,
  type ClaimScope,
} from '../../lib/api/claimShare';
import type { ClaimPreview, ClaimRecord, ClaimStatus } from '../../lib/types';

const SCOPE_META: Record<ClaimScope, { label: string; icon: typeof HandCoins; hint: string }> = {
  default: { label: 'เคสทั่วไป', icon: Wrench, hint: 'งานซ่อมบำรุง งานธุรการทั่วไป' },
  vehicle_rescue: { label: 'กู้ภัย / ยกรถ', icon: Truck, hint: 'ลากรถ กู้รถ ช่วยเหลือฉุกเฉิน' },
};

const STATUS: Record<ClaimStatus, { label: string; cls: string }> = {
  pending: { label: 'รอหัวหน้ากรมอนุมัติ', cls: 'bg-amber-500/10 text-amber-300 border-amber-500/30' },
  approved: { label: 'อนุมัติแล้ว รอจ่าย', cls: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' },
  rejected: { label: 'ไม่อนุมัติ', cls: 'bg-red-500/10 text-red-300 border-red-500/30' },
  paid: { label: 'จ่ายแล้ว', cls: 'bg-blue-500/10 text-blue-300 border-blue-500/30' },
};

function money(n: number): string {
  return Number(n ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function ClaimSharePage() {
  const { officer } = useAuth();
  const [periods] = useState(() => claimablePeriods(12));

  // เริ่มที่งวดล่าสุดที่ปิดแล้ว (ไม่ใช่เดือนปัจจุบัน)
  const [period, setPeriod] = useState<string>(
    () => periods.find((p) => p.closed)?.period ?? currentClaimPeriod(),
  );
  const [scope, setScope] = useState<ClaimScope>('default');

  const [preview, setPreview] = useState<ClaimPreview | null>(null);
  const [claims, setClaims] = useState<ClaimRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [detail, setDetail] = useState<ClaimPreview | null>(null);

  const closed = isPeriodClosed(period);
  const currentPeriod = currentClaimPeriod();

  const loadClaims = useCallback(async () => {
    if (!officer) return;
    setClaims(await fetchOfficerClaims(officer.id));
  }, [officer]);

  const loadPreview = useCallback(async () => {
    if (!officer) return;
    setError(null);

    // งวดที่ยังไม่ปิด → ไม่ยิง RPC ให้เปลือง
    if (!closed) {
      setPreview(null);
      return;
    }
    setLoading(true);
    try {
      setPreview(await previewClaimShare(officer.id, period, scope));
    } catch (e) {
      setError(translateClaimError(e as { code?: string; message?: string }));
      setPreview(null);
    } finally {
      setLoading(false);
    }
  }, [officer, period, scope, closed]);

  useEffect(() => { loadPreview(); }, [loadPreview]);
  useEffect(() => { loadClaims(); }, [loadClaims]);

  // รวมยอดของงวดที่เลือก (ใช้แสดงสรุปด้านบน)
  const periodTotals = useMemo(() => {
    const map = new Map<string, { count: number; amount: number }>();
    for (const c of claims) {
      const cur = map.get(c.claim_period) ?? { count: 0, amount: 0 };
      cur.count += 1;
      cur.amount += Number(c.amount ?? 0);
      map.set(c.claim_period, cur);
    }
    return map;
  }, [claims]);

  const openMonths = useMemo(
    () => [...periods].reverse().filter((p) => p.closed),
    [periods],
  );

  const totalAllTime = useMemo(
    () => claims.reduce((s, c) => s + Number(c.amount ?? 0), 0),
    [claims],
  );

  async function doSubmit() {
    if (!officer || !preview) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitClaim(officer.id, period, scope, officer.id);
      setConfirming(false);
      setPreview(null);
      await loadClaims();
    } catch (e) {
      setError(translateClaimError(e as { code?: string; message?: string }));
      setConfirming(false);
    } finally {
      setSubmitting(false);
    }
  }

  if (!officer) return null;

  return (
    <div>
      <PageHeader
        icon={<HandCoins size={26} />}
        title="รับส่วนแบ่งเคส"
        subtitle="ตรวจสอบเคสที่ชำระเงินแล้ว แล้วรับส่วนแบ่งของงวดที่ปิดเดือนแล้ว"
      />

      {/* ── กฎการรับ ── */}
      <FadeIn className="mb-4">
        <div className="card p-4 border-amber-500/25 flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center flex-shrink-0">
            <Lock size={16} className="text-amber-400" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white">เดือนที่ลืมกดรับ สะสมไว้ให้อัตโนมัติ</p>
            <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">
              ระบบรวมทุกเดือนที่ยังไม่ได้รับ เข้ามาในงวดที่กด
              ดังนั้นไม่ต้องกดทีละเดือน — ปล่อยไว้กี่เดือน กดครั้งเดียวก็ได้เงินครบทุกเดือน
              แต่ต้องรอให้เดือนนั้นปิดก่อน (เดือนปัจจุบัน {currentPeriod} ยังไม่ปิด)
            </p>
          </div>
        </div>
      </FadeIn>

      {/* ── สรุป ── */}
      <FadeIn delay={0.05}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <Stat label="ส่วนแบ่งสะสมทั้งหมด" value={money(totalAllTime)} tone="text-amber-300" />
          <Stat label="จำนวนใบรับ" value={`${claims.length} ใบ`} />
          <Stat label="รออนุมัติ" value={`${claims.filter((c) => c.status === 'pending').length} ใบ`} tone="text-amber-300" />
          <Stat label="จ่ายแล้ว" value={`${claims.filter((c) => c.status === 'paid').length} ใบ`} tone="text-emerald-300" />
        </div>
      </FadeIn>

      {/* ── ตัวเลือกงวด + หมวด ── */}
      <FadeIn delay={0.1}>
        <div className="card p-4 sm:p-5 mb-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-300 mb-2">
                <Calendar size={13} /> งวดที่รับส่วนแบ่ง
              </label>
              <select
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                className="w-full bg-navy-800 border border-blue-900/50 rounded-lg px-3 py-2.5 text-sm text-white outline-none focus:border-amber-500/50"
              >
                {periods.map((p) => (
                  <option
                    key={p.period}
                    value={p.period}
                    disabled={!p.closed}
                    className={p.closed ? '' : 'text-gray-500'}
                  >
                    {p.label}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-gray-500 mt-1.5 leading-relaxed">
                เลือกได้ {openMonths.length} งวด · เดือนปัจจุบันถูกปิดการกดไว้
                <br />
                เลือกงวดไหนก็ได้ ระบบจะรวมทุกเดือนที่ยังไม่ได้รับมาให้ด้วย
              </p>
            </div>

            <div>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-300 mb-2">
                <HandCoins size={13} /> หมวดเคส
              </label>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(SCOPE_META) as ClaimScope[]).map((s) => {
                  const M = SCOPE_META[s];
                  const Icon = M.icon;
                  const active = scope === s;
                  return (
                    <button
                      key={s}
                      onClick={() => setScope(s)}
                      className={`p-2.5 rounded-lg border text-left transition-colors ${
                        active
                          ? 'border-amber-500/60 bg-amber-500/10'
                          : 'border-blue-900/50 hover:border-amber-500/30'
                      }`}
                    >
                      <span className={`flex items-center gap-1.5 text-xs font-semibold ${active ? 'text-amber-300' : 'text-gray-300'}`}>
                        <Icon size={13} /> {M.label}
                      </span>
                      <span className="block text-[10px] text-gray-500 mt-0.5 leading-snug">{M.hint}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </FadeIn>

      {/* ── ผลลัพธ์ ── */}
      <FadeIn delay={0.15}>
        <div className="card p-4 sm:p-5 mb-4">
          {!closed ? (
            <Empty
              icon={<Lock size={22} />}
              title="งวดนี้ยังไม่ปิดเดือน"
              text={`เดือน ${period} ยังไม่สิ้นเดือน กรุณาเลือกงวดก่อนหน้าเพื่อรับส่วนแบ่ง`}
            />
          ) : loading ? (
            <div className="py-10 flex justify-center">
              <Loader2 size={22} className="text-amber-400 animate-spin" />
            </div>
          ) : error ? (
            <Empty icon={<AlertTriangle size={22} />} title="เกิดข้อผิดพลาด" text={error} tone="text-red-400" />
          ) : !preview || preview.record_count === 0 ? (
            <Empty
              icon={<Inbox size={22} />}
              title="ไม่มีเคสที่รับได้"
              text={`ไม่พบเคสที่ชำระเงินแล้วในงวด ${period} หมวด${SCOPE_META[scope].label} หรือเคสทั้งหมดถูกรับไปแล้ว`}
            />
          ) : (
            <>
              {/* เดือนที่ถูกรวมมา — ชัดว่ากดครั้งเดียวได้กี่เดือน */}
              {(preview.months?.length ?? 0) > 0 && (
                <div className="mb-4 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
                  <div className="text-[11px] text-amber-300 font-semibold mb-2">
                    รวม {preview.months!.length} เดือนที่ยังไม่ได้รับ
                    {(preview.months!.length > 1) && (
                      <span className="text-gray-400 font-normal">
                        {' '}(รวมเดือนที่ลืมกดไว้ด้วย ไม่ต้องกดย้อนหลัง)
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {preview.months!.map((m) => (
                      <span
                        key={m.month}
                        className="px-2 py-0.5 rounded bg-navy-800 border border-amber-500/25 text-[10px] text-gray-300"
                      >
                        {m.month} · {m.record_count} เคส · {money(m.total)} BC
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                <Stat label="เคสที่ชำระแล้ว" value={`${preview.record_count} เคส`} />
                <Stat label="ยอดรวมบิล" value={money(preview.gross_amount)} />
                <Stat label="สัดส่วนเจ้าหน้าที่" value={`${preview.officer_share_percent}%`} />
                <Stat label="ส่วนแบ่งที่จะได้รับ" value={money(preview.per_officer_total)} tone="text-amber-300" />
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setDetail(preview)}
                  className="btn-secondary text-xs py-2 px-3"
                >
                  ดูรายการเคส ({preview.record_count})
                </button>
                <button
                  onClick={() => setConfirming(true)}
                  className="btn-primary text-xs py-2 px-4 font-semibold flex items-center gap-1.5"
                >
                  <CheckCircle2 size={14} /> ยืนยันรับส่วนแบ่งงวดนี้
                </button>
              </div>
            </>
          )}
        </div>
      </FadeIn>

      {/* ── ประวัติ ── */}
      <FadeIn delay={0.2}>
        <div className="card p-4 sm:p-5">
          <div className="flex items-center gap-2 mb-3">
            <History size={16} className="text-amber-400" />
            <h2 className="text-sm font-bold text-white">ประวัติการรับส่วนแบ่ง ({claims.length})</h2>
          </div>

          {claims.length === 0 ? (
            <p className="text-xs text-gray-500 py-6 text-center">ยังไม่มีประวัติการรับส่วนแบ่ง</p>
          ) : (
            <div className="space-y-1.5 max-h-[420px] overflow-y-auto pr-1">
              {claims.map((c) => {
                const st = STATUS[c.status] ?? STATUS.pending;
                const t = periodTotals.get(c.claim_period);
                return (
                  <div
                    key={c.id}
                    className="flex items-center gap-3 p-2.5 rounded-lg bg-navy-900/40 border border-blue-900/30"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-white">
                          {money(c.amount)} BC
                        </span>
                        <span className={`px-2 py-0.5 rounded border text-[10px] font-semibold ${st.cls}`}>
                          {st.label}
                        </span>
                        <span className="text-[10px] text-gray-500">งวด {c.claim_period}</span>
                      </div>
                      <div className="text-[11px] text-gray-500 mt-0.5">
                        {SCOPE_META[c.scope]?.label ?? c.scope}
                        {c.service_record_id && ' · รายการเดียว'}
                        {c.reject_reason && ` · เหตุผล: ${c.reject_reason}`}
                        {t && ` · งวดนี้รวม ${t.count} ใบ / ${money(t.amount)} BC`}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </FadeIn>

      {/* ── Modal ยืนยัน ── */}
      {confirming && (
      <ConfirmDialog
        title="ยืนยันรับส่วนแบ่ง"
        message={
          `รับส่วนแบ่งงวด ${period} หมวด${SCOPE_META[scope].label} ` +
          `จำนวน ${preview?.record_count ?? 0} เคส เป็นเงิน ${money(preview?.per_officer_total ?? 0)} BC\n\n` +
          (preview && (preview.months?.length ?? 0) > 1
            ? `รวมเดือนที่ลืมกดไว้: ${preview.months!.map((m) => m.month).join(', ')}\n`
            : '') +
          'เมื่อกดยืนยันแล้วจะเข้าคิวรอหัวหน้ากรมอนุมัติ และไม่สามารถกดซ้ำได้อีก'
        }
        confirmLabel="ยืนยันรับ"
        onConfirm={doSubmit}
        onCancel={() => setConfirming(false)}
      />
      )}

      {/* ── Modal รายการเคส ── */}
      {detail && (
        <Modal
          title={`รายการเคสที่ชำระแล้ว — งวด ${detail.period}`}
          onClose={() => setDetail(null)}
          size="lg"
        >
          <div className="space-y-1.5 max-h-[60vh] overflow-y-auto pr-1">
            {detail.records?.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-navy-900/40 border border-blue-900/30"
              >
                <div className="min-w-0">
                  <div className="text-sm text-white font-medium truncate">{r.service_name}</div>
                  <div className="text-[11px] text-gray-500">
                    ยอดบิล {money(r.amount)} BC · ผู้ร่วมงาน {r.assigned_count} คน
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-sm font-bold text-amber-300">{money(r.per_officer_share)} BC</div>
                  <div className="text-[10px] text-gray-500">ส่วนของคุณ</div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-3 border-t border-blue-900/40 flex items-center justify-between">
            <span className="text-sm text-gray-400">รวม {detail.record_count} เคส</span>
            <span className="text-lg font-black text-amber-300">{money(detail.per_officer_total)} BC</span>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Stat({ label, value, tone = 'text-white' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="card p-3.5">
      <div className="text-[10px] text-gray-500 leading-snug">{label}</div>
      <div className={`text-lg font-black mt-1 leading-none ${tone}`}>{value}</div>
    </div>
  );
}

function Empty({
  icon, title, text, tone = 'text-gray-500',
}: { icon: React.ReactNode; title: string; text: string; tone?: string }) {
  return (
    <div className="py-10 text-center">
      <div className={`inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-navy-800/60 border border-blue-900/40 ${tone} mb-3`}>
        {icon}
      </div>
      <p className="text-sm font-semibold text-gray-300">{title}</p>
      <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto leading-relaxed">{text}</p>
    </div>
  );
}
