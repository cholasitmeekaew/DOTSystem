/* =============================================================
 * WorkReportsAdminPage.tsx — ประวัติรายงานปฏิบัติงานทั้งหมด (Admin)
 * -------------------------------------------------------------
 * ดีไซน์/ตัวกรองเหมือนหน้าประวัติการเข้าเวรทั้งหมด (DutyLogsAdminPage)
 * ============================================================= */

import { useEffect, useMemo, useState } from 'react';
import {
  FileText, Search, Trash2, ShieldAlert, Loader2, Filter, Download, Eye,
  CheckCircle2, XCircle, Clock, ChevronDown,
} from 'lucide-react';
import { useAuth } from '../../lib/AuthContext';
import { supabase } from '../../lib/supabase';
import { PageHeader } from '../../components/PageHeader';
import { Modal } from '../../components/Modal';
import { ReportDetailModal } from '../../components/ReportDetailModal';
import {
  RANK_LABELS, WORK_REPORT_STATUS_LABELS,
  type Officer, type OfficerRankRecord, type WorkReport, type WorkReportCase,
} from '../../lib/types';
import { deleteWorkReport, dutyCategoryLabel } from '../../lib/api/workReportsAdmin';

type StatusKey = 'pending' | 'approved' | 'rejected';

const STATUS_STYLE: Record<StatusKey, { label: string; cls: string; Icon: typeof Clock }> = {
  pending:   { label: 'รอตรวจ',     cls: 'bg-amber-500/15 text-amber-300 border-amber-500/40', Icon: Clock },
  approved:  { label: 'อนุมัติแล้ว',  cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40', Icon: CheckCircle2 },
  rejected:  { label: 'ไม่อนุมัติ',   cls: 'bg-red-500/15 text-red-300 border-red-500/40', Icon: XCircle },
};

const fmtDT = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('th-TH', {
    day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit',
  }) : '—';

const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' }) : '—';

const statusKeyOf = (r: WorkReport): StatusKey =>
  ((r.status ?? 'pending') as StatusKey) in STATUS_STYLE ? (r.status as StatusKey) : 'pending';

export function WorkReportsAdminPage() {
  const { officer } = useAuth();
  const [rows, setRows] = useState<WorkReport[]>([]);
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [ranks, setRanks] = useState<OfficerRankRecord[]>([]);
  const [caseCounts, setCaseCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | StatusKey>('all');
  const [limit, setLimit] = useState(50);

  const [target, setTarget] = useState<WorkReport | null>(null);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<WorkReport | null>(null);
  /** เคสของรายงานที่กำลังดู — โหลดตอนเปิด modal (RLS ให้อ่านตาม report_id เดียว) */
  const [viewCases, setViewCases] = useState<WorkReportCase[]>([]);
  const [deletedHint, setDeletedHint] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    const [repRes, offRes, rankRes, caseRes] = await Promise.all([
      supabase.from('work_reports')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1000),
      supabase.from('officers').select('*').neq('status', 'deleted').order('name'),
      supabase.from('officer_ranks').select('*').order('sort_order'),
      supabase.from('work_report_cases').select('work_report_id'),
    ]);

    const err = [repRes, offRes, rankRes, caseRes].find((r) => r.error);
    setError(err?.error ? err.error.message : null);

    setRows((repRes.data ?? []) as WorkReport[]);
    setOfficers((offRes.data ?? []) as Officer[]);
    setRanks((rankRes.data ?? []) as OfficerRankRecord[]);

    const counts: Record<string, number> = {};
    for (const c of (caseRes.data ?? []) as Array<{ work_report_id: string }>) {
      counts[c.work_report_id] = (counts[c.work_report_id] ?? 0) + 1;
    }
    setCaseCounts(counts);
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  const byOfficer = useMemo(() => new Map(officers.map((o) => [o.id, o])), [officers]);
  const rankLabel = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of ranks) {
      if (r.rank_key) m.set(r.rank_key, r.label);
      m.set(r.label, r.label);
    }
    return m;
  }, [ranks]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const fromT = from ? new Date(`${from}T00:00:00`).getTime() : null;
    const toT = to ? new Date(`${to}T23:59:59`).getTime() : null;

    return rows.filter((r) => {
      if (statusFilter !== 'all' && statusKeyOf(r) !== statusFilter) return false;

      const t = new Date(r.created_at).getTime();
      if (fromT != null && t < fromT) return false;
      if (toT != null && t > toT) return false;

      if (needle) {
        const o = r.officer_id ? byOfficer.get(r.officer_id) : undefined;
        const hay = [
          r.officer_name, o?.name, o?.username,
          rankLabel.get(o?.rank ?? '') ?? '',
          RANK_LABELS[(o?.rank ?? 'officer') as keyof typeof RANK_LABELS] ?? '',
          r.summary, r.report_text, dutyCategoryLabel(r.duty_category),
        ].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [rows, q, from, to, statusFilter, byOfficer, rankLabel]);

  const shown = filtered.slice(0, limit);

  const totals = useMemo(() => ({
    all: filtered.length,
    pending: filtered.filter((r) => statusKeyOf(r) === 'pending').length,
    approved: filtered.filter((r) => statusKeyOf(r) === 'approved').length,
    rejected: filtered.filter((r) => statusKeyOf(r) === 'rejected').length,
  }), [filtered]);

  async function doDelete() {
    if (!target || !officer) return;
    setSaving(true);
    try {
      const res = await deleteWorkReport(target, { id: officer.id, name: officer.name });
      setTarget(null);
      setView(null);
      await load();
      setError(null);
      setDeletedHint(res.pointsReverted);
    } catch (e) {
      setError(`ลบรายงานไม่สำเร็จ: ${(e as Error).message}`);
      setTarget(null);
    } finally {
      setSaving(false);
    }
  }

  function exportCsv() {
    const head = ['วันที่ส่ง', 'เวลา', 'ชื่อ', 'รหัสเจ้าหน้าที่', 'ยศ', 'ประเภทงาน', 'สรุป', 'สถานะ', 'ผู้ตรวจ', 'หมายเหตุ', 'คะแนน'];
    const lines = [head.join(',')];
    for (const r of shown) {
      const o = r.officer_id ? byOfficer.get(r.officer_id) : undefined;
      const d = new Date(r.created_at);
      lines.push([
        d.toLocaleDateString('th-TH'), d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }),
        o?.name ?? r.officer_name, o?.username ?? '',
        rankLabel.get(o?.rank ?? '') ?? '',
        dutyCategoryLabel(r.duty_category),
        (r.summary || r.report_text || '').slice(0, 300),
        STATUS_STYLE[statusKeyOf(r)].label,
        r.reviewed_by_name ?? '', r.review_note ?? '', r.reviewed_points ?? 0,
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));
    }
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `work-reports-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const resetFilters = () => {
    setQ(''); setFrom(''); setTo(''); setStatusFilter('all'); setLimit(50);
    setDeletedHint(null); setError(null);
  };

  return (
    <div>
      <PageHeader
        icon={<FileText size={26} />}
        title="ประวัติรายงานการปฏิบัติงานทั้งหมด"
        subtitle={`บันทึกการส่งรายงานปฏิบัติงานของเจ้าหน้าที่ทุกคน · ${totals.all.toLocaleString('th-TH')} รายการ`}
        actions={
          <button onClick={exportCsv} disabled={shown.length === 0}
            className="btn-secondary flex items-center gap-2 text-xs disabled:opacity-40">
            <Download size={14} /> ส่งออก CSV
          </button>
        }
      />

      {deletedHint !== null && (
        <div className="flex items-center gap-2 text-[12px] text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3.5 py-2.5 mb-4">
          <CheckCircle2 size={15} className="flex-shrink-0" />
          ลบรายงานเรียบร้อย
          {deletedHint > 0 && ` · คืนคะแนนให้เจ้าหน้าที่ ${deletedHint} คะแนน`}
          <button onClick={() => setDeletedHint(null)} className="ml-auto text-gray-400 hover:text-white">✕</button>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 text-[12px] text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3.5 py-2.5 mb-4">
          <ShieldAlert size={15} className="mt-0.5 flex-shrink-0" />
          <span className="break-all">{error}</span>
        </div>
      )}

      {/* ---------- ตัวกรอง ---------- */}
      <div className="card p-3.5 mb-4 space-y-2.5">
        <div className="flex flex-wrap gap-2.5">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="ค้นหาชื่อ รหัสเจ้าหน้าที่ ยศ หรือหัวข้อรายงาน..."
              className="input w-full pl-9 text-xs"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <Filter size={13} className="text-gray-500" />
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              className="input text-xs" title="ตั้งแต่วันที่" />
            <span className="text-gray-600 text-xs">–</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
              className="input text-xs" title="ถึงวันที่" />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            className="input text-xs"
            title="กรองตามสถานะ"
          >
            <option value="all">ทุกสถานะ</option>
            <option value="pending">รอตรวจ</option>
            <option value="approved">อนุมัติแล้ว</option>
            <option value="rejected">ไม่อนุมัติ</option>
          </select>
          <button onClick={resetFilters} className="btn-secondary text-xs">ล้างตัวกรอง</button>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="text-gray-500">
            {filtered.length.toLocaleString('th-TH')} รายการ
            {filtered.length > shown.length && ` · แสดง ${shown.length}`}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <span className="px-1.5 py-0.5 rounded border border-amber-500/40 bg-amber-500/15 text-amber-300">
              รอตรวจ {totals.pending}
            </span>
            <span className="px-1.5 py-0.5 rounded border border-emerald-500/40 bg-emerald-500/15 text-emerald-300">
              อนุมัติแล้ว {totals.approved}
            </span>
            <span className="px-1.5 py-0.5 rounded border border-red-500/40 bg-red-500/15 text-red-300">
              ไม่อนุมัติ {totals.rejected}
            </span>
          </div>
        </div>
      </div>

      {/* ---------- ตาราง ---------- */}
      <div className="table-panel overflow-x-auto">
        {loading ? (
          <div className="card p-8 text-center text-gray-400 flex items-center justify-center gap-2">
            <Loader2 size={16} className="animate-spin" /> กำลังโหลด...
          </div>
        ) : shown.length === 0 ? (
          <div className="card p-8 text-center">
            <FileText size={32} className="text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400">ไม่พบรายการที่ตรงกับเงื่อนไข</p>
          </div>
        ) : (
          <table className="w-full text-xs min-w-[980px]">
            <thead>
              <tr className="border-b border-blue-900/40">
                {['วันที่และเวลาส่ง', 'เจ้าหน้าที่', 'รายละเอียดรายงาน', 'สถานะ', 'ผู้ตรวจ', 'จัดการ']
                  .map((h) => (
                    <th key={h} className="text-left px-3 py-2.5 text-gray-400 font-semibold whitespace-nowrap">{h}</th>
                  ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const o = r.officer_id ? byOfficer.get(r.officer_id) : undefined;
                const st = STATUS_STYLE[statusKeyOf(r)];
                const StIcon = st.Icon;
                return (
                  <tr key={r.id} className="border-b border-blue-900/25 hover:bg-navy-800/40">
                    <td className="px-3 py-2 text-gray-300 whitespace-nowrap">
                      <div>{fmtDate(r.created_at)}</div>
                      <div className="text-gray-500 font-mono text-[11px]">
                        {new Date(r.created_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        {o?.photo_url ? (
                          <img src={o.photo_url} alt="" loading="lazy"
                            className="w-7 h-7 rounded-full object-cover border border-blue-900/50 flex-shrink-0" />
                        ) : (
                          <span className="w-7 h-7 rounded-full bg-navy-800 border border-blue-900/50 flex items-center justify-center flex-shrink-0">
                            <FileText size={12} className="text-gray-600" />
                          </span>
                        )}
                        <div className="min-w-0">
                          <div className="text-gray-200 truncate">{o?.name ?? r.officer_name}</div>
                          <div className="text-[10px] text-gray-500">
                            {o?.username
                              ? <span className="font-mono">{o.username}</span>
                              : <span className="font-mono">ไม่ทราบรหัส</span>}
                            {' · '}{rankLabel.get(o?.rank ?? '')
                              ?? RANK_LABELS[(o?.rank ?? 'officer') as keyof typeof RANK_LABELS] ?? '—'}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2 max-w-[280px]">
                      <span className="inline-block px-1.5 py-0.5 rounded border border-purple-500/30 bg-purple-500/10 text-purple-300 text-[10px]">
                        {dutyCategoryLabel(r.duty_category)}
                      </span>
                      <span className="ml-1.5 text-[10px] text-gray-600">{caseCounts[r.id] ?? 0} เคส</span>
                      <div className="text-[11px] text-gray-400 mt-1 line-clamp-2">
                        {r.summary || r.report_text || '—'}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-semibold whitespace-nowrap ${st.cls}`}>
                        <StIcon size={10} /> {st.label}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[11px] text-gray-400 whitespace-nowrap max-w-[160px]">
                      {r.reviewed_by_name ? (
                        <>
                          <div className="truncate">{r.reviewed_by_name}</div>
                          <div className="text-[10px] text-gray-600">{fmtDate(r.reviewed_at)}</div>
                          {typeof r.reviewed_points === 'number' && r.reviewed_points > 0 && (
                            <div className="text-[10px] text-emerald-400">+{r.reviewed_points} คะแนน</div>
                          )}
                        </>
                      ) : '—'}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={async () => {
                            setView(r);
                            const { data } = await supabase
                              .from('work_report_cases').select('*')
                              .eq('work_report_id', r.id)
                              .order('created_at', { ascending: true });
                            setViewCases((data ?? []) as WorkReportCase[]);
                          }}
                          className="p-1.5 rounded text-gray-500 hover:text-blue-400 hover:bg-blue-500/10"
                          title="ดูรายงานฉบับเต็ม"
                        >
                          <Eye size={13} />
                        </button>
                        <button
                          onClick={() => setTarget(r)}
                          className="p-1.5 rounded text-gray-500 hover:text-red-400 hover:bg-red-500/10"
                          title="ลบรายงาน"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {filtered.length > shown.length && (
          <div className="p-3 text-center">
            <button onClick={() => setLimit((v) => v + 100)}
              className="btn-secondary text-xs flex items-center gap-1.5 mx-auto">
              <ChevronDown size={13} /> แสดงเพิ่มอีก (เหลือ {(filtered.length - shown.length).toLocaleString('th-TH')})
            </button>
          </div>
        )}
      </div>

      {/* ---------- ยืนยันลบ ---------- */}
      {target && (
        <Modal title="ยืนยันการลบรายงานปฏิบัติงาน" onClose={() => setTarget(null)} size="sm">
          <div className="space-y-3">
            <p className="text-sm text-gray-200 leading-relaxed">
              คุณต้องการลบรายงานปฏิบัติงานของ{' '}
              <strong className="text-white">
                {target.officer_id ? (byOfficer.get(target.officer_id)?.name ?? target.officer_name) : target.officer_name}
              </strong>{' '}
              ใช่หรือไม่
            </p>

            <div className="text-[11px] text-gray-400 bg-navy-900/50 border border-blue-900/40 rounded-lg px-3 py-2.5 space-y-1">
              <div className="flex justify-between gap-3">
                <span className="text-gray-500">ประเภทงาน</span>
                <span>{dutyCategoryLabel(target.duty_category)}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-gray-500">ส่งเมื่อ</span>
                <span>{fmtDT(target.created_at)}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-gray-500">สถานะ</span>
                <span>{STATUS_STYLE[statusKeyOf(target)].label}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-gray-500">จำนวนเคส</span>
                <span>{caseCounts[target.id] ?? 0} เคส</span>
              </div>
            </div>

            {(target.reviewed_points ?? 0) > 0 && (
              <div className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2.5 leading-relaxed">
                รายงานนี้เคยได้รับการอนุมัติและให้คะแนน{' '}
                <strong className="text-amber-200">+{target.reviewed_points}</strong> ไปแล้ว
                ระบบจะ<strong className="text-amber-200">คืนคะแนนกลับ</strong>ให้เจ้าหน้าที่คนนั้นในขั้นตอนเดียวกัน
              </div>
            )}

            <p className="text-[11px] text-red-300/90 leading-relaxed">
              รายงานและเคสทั้งหมดในรายงานนี้จะถูกลบถาวร ย้อนกลับไม่ได้
            </p>

            <div className="flex gap-2 pt-1">
              <button
                onClick={doDelete}
                disabled={saving}
                className="btn-danger flex-1 flex items-center justify-center gap-1.5 text-xs disabled:opacity-40"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                ยืนยันลบ
              </button>
              <button onClick={() => setTarget(null)} disabled={saving} className="btn-secondary text-xs">
                ยกเลิก
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ---------- รายละเอียดฉบับเต็ม (component เดียวกับหน้าอนุมัติรายงาน) ---------- */}
      {view && (
        <ReportDetailModal
          report={view}
          cases={viewCases}
          deleting={saving}
          onDelete={() => setTarget(view)}
          onClose={() => { setView(null); setViewCases([]); }}
        />
      )}

    </div>
  );
}
