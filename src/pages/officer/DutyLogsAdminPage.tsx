/* =============================================================
 * DutyLogsAdminPage.tsx — ประวัติการเข้าเวรทั้งหมด (Admin)
 * -------------------------------------------------------------
 * ดู/ค้นหา/กรอง/ลบประวัติเวรของเจ้าหน้าที่ทุกคน
 *
 * หมายเหตุเรื่องข้อมูลที่ไม่มีคอลัมน์จริง:
 *   - duty_logs ไม่มีคอลัมน์ "กะ"      → คำนวณจากเวลาเข้าเทียบกับช่วงเวลากะจริง
 *   - duty_logs ไม่มีคอลัมน์ "สถานะ"   → คำนวณจาก clock_out / forced_by / deleted_at
 *   - duty_logs ไม่มีคอลัมน์ "ผู้บันทึก" → ใช้ forced_by_name (ผู้บังคับออกเวร)
 *     ถ้ามีการลบจะแสดงผู้ลบแทน
 * ============================================================= */

import { getOfficerFields } from '../../lib/officerColumns';
import { useEffect, useMemo, useState } from 'react';
import {
  Clock, Search, Trash2, ShieldAlert, Loader2, Users, Filter, Eye, EyeOff,
  ChevronDown, ChevronUp, Download,
} from 'lucide-react';
import { useAuth } from '../../lib/AuthContext';
import { supabase } from '../../lib/supabase';
import { PageHeader } from '../../components/PageHeader';
import { ConfirmDialog, Modal } from '../../components/Modal';
import {
  RANK_LABELS, SHIFT_LABELS, type ShiftCode,
  type Officer, type OfficerRankRecord,
} from '../../lib/types';
import { shiftWindowsFor } from '../../lib/dutySchedule';

interface Row {
  id: string;
  officer_id: string | null;
  officer_name: string;
  clock_in: string;
  clock_out: string | null;
  duration_minutes: number | null;
  forced_by_name: string | null;
  checkout_method: string | null;
  deleted_at: string | null;
  deleted_by_name: string | null;
  delete_reason: string | null;
}

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const toMin = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };

/** กะที่เข้าเวร โดยเทียบเวลาเข้ากับช่วงเวลาจริงของวันนั้น */
function shiftOf(clockIn: string): ShiftCode | null {
  const d = new Date(clockIn);
  if (Number.isNaN(d.getTime())) return null;
  const win = shiftWindowsFor(d.getDay());
  return toMin(hhmm(d)) < toMin(win.s2.start) ? 's1' : 's2';
}

type Status = { key: string; label: string; cls: string };

function statusOf(r: Row): Status {
  if (r.deleted_at) return { key: 'deleted', label: 'ถูกลบแล้ว', cls: 'bg-gray-500/15 text-gray-300 border-gray-500/40' };
  if (r.forced_by_name) return { key: 'forced', label: 'บังคับออกเวร', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/40' };
  if (!r.clock_out) return { key: 'open', label: 'กำลังเข้าเวร', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' };
  return { key: 'ok', label: 'สำเร็จ', cls: 'bg-blue-500/15 text-blue-300 border-blue-500/40' };
}

const fmtDT = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('th-TH', {
    day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit',
  }) : '—';

const fmtDur = (m: number | null) => {
  if (m == null) return '—';
  const h = Math.floor(m / 60), r = m % 60;
  return h > 0 ? `${h} ชม. ${r} นาที` : `${r} นาที`;
};

export function DutyLogsAdminPage() {
  const { officer } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [ranks, setRanks] = useState<OfficerRankRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'ok' | 'open' | 'forced' | 'deleted'>('all');
  const [showDeleted, setShowDeleted] = useState(false);
  const [limit, setLimit] = useState(50);

  const [target, setTarget] = useState<Row | null>(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<Row | null>(null);

  async function load() {
  const fields = await getOfficerFields();
    setLoading(true);
    const [logRes, offRes, rankRes] = await Promise.all([
      supabase.from('duty_logs')
        .select('id, officer_id, officer_name, clock_in, clock_out, duration_minutes, forced_by_name, checkout_method, deleted_at, deleted_by_name, delete_reason')
        .order('clock_in', { ascending: false }).limit(1000),
      supabase.from('officers').select(fields).neq('status', 'deleted').order('name'),
      supabase.from('officer_ranks').select('*').order('sort_order'),
    ]);

    const errs = [logRes, offRes, rankRes].find((r) => r.error);
    if (errs?.error) setError(errs.error.message); else setError(null);

    setRows((logRes.data ?? []) as Row[]);
    setOfficers((offRes.data ?? []) as Officer[]);
    setRanks((rankRes.data ?? []) as OfficerRankRecord[]);
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  const byOfficer = useMemo(
    () => new Map(officers.map((o) => [o.id, o])),
    [officers],
  );
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
      if (!showDeleted && r.deleted_at) return false;
      if (statusFilter !== 'all' && statusOf(r).key !== statusFilter) return false;

      const t = new Date(r.clock_in).getTime();
      if (fromT != null && t < fromT) return false;
      if (toT != null && t > toT) return false;

      if (needle) {
        const o = r.officer_id ? byOfficer.get(r.officer_id) : undefined;
        const hay = [
          r.officer_name, o?.name, o?.username,
          rankLabel.get(o?.rank ?? '') ?? '', RANK_LABELS[(o?.rank ?? 'officer') as keyof typeof RANK_LABELS] ?? '',
        ].join(' ').toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [rows, q, from, to, statusFilter, showDeleted, byOfficer, rankLabel]);

  const shown = filtered.slice(0, limit);

  const totals = useMemo(() => {
    const live = filtered.filter((r) => !r.deleted_at);
    return {
      count: live.length,
      hours: live.reduce((s, r) => s + (r.duration_minutes ?? 0), 0),
      open: live.filter((r) => !r.clock_out).length,
      forced: live.filter((r) => r.forced_by_name).length,
    };
  }, [filtered]);

  async function doDelete() {
    if (!target || !officer) return;
    setSaving(true);
    try {
      const { error: err } = await supabase.from('duty_logs').update({
        deleted_at: new Date().toISOString(),
        deleted_by: officer.id,
        deleted_by_name: officer.name,
        delete_reason: reason.trim() || 'ไม่ระบุเหตุผล',
      }).eq('id', target.id);

      if (err) throw err;

      await supabase.from('audit_logs').insert({
        action: 'DELETE_DUTY_LOG',
        target_type: 'duty_log',
        target_id: target.id,
        performed_by: officer.id,
        performed_by_name: officer.name,
        details: {
          officer_name: target.officer_name,
          clock_in: target.clock_in,
          duration_minutes: target.duration_minutes,
          reason: reason.trim() || 'ไม่ระบุเหตุผล',
        },
      });

      setTarget(null);
      setReason('');
      await load();
    } catch (e) {
      setError(`ลบไม่สำเร็จ: ${(e as Error).message}`);
      setTarget(null);
    } finally {
      setSaving(false);
    }
  }

  function exportCsv() {
    const head = ['วันที่เข้าเวร', 'เข้าเวร', 'ออกเวร', 'ระยะเวลา(นาที)', 'ชื่อ', 'รหัส', 'ยศ', 'กะ', 'สถานะ', 'ผู้บันทึก'];
    const lines = [head.join(',')];
    for (const r of shown) {
      const o = r.officer_id ? byOfficer.get(r.officer_id) : undefined;
      const sh = shiftOf(r.clock_in);
      lines.push([
        new Date(r.clock_in).toLocaleDateString('th-TH'),
        new Date(r.clock_in).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }),
        r.clock_out ? new Date(r.clock_out).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '',
        r.duration_minutes ?? '',
        r.officer_name, o?.username ?? '', rankLabel.get(o?.rank ?? '') ?? '',
        sh ? SHIFT_LABELS[sh] : '', statusOf(r).label,
        r.forced_by_name ?? r.deleted_by_name ?? '',
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));
    }
    // BOM ให้ Excel เปิดภาษาไทยได้ถูกต้อง
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `duty-logs-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const resetFilters = () => {
    setQ(''); setFrom(''); setTo('');
    setStatusFilter('all'); setShowDeleted(false); setLimit(50);
  };

  return (
    <div>
      <PageHeader
        icon={<Clock size={26} />}
        title="ประวัติการเข้าเวรทั้งหมด"
        subtitle={`บันทึกการเข้า–ออกเวรของเจ้าหน้าที่ทุกคน · ${totals.count.toLocaleString('th-TH')} รายการ`}
        actions={
          <button onClick={exportCsv} disabled={shown.length === 0} className="btn-secondary flex items-center gap-2 text-xs disabled:opacity-40">
            <Download size={14} /> ส่งออก CSV
          </button>
        }
      />

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
              placeholder="ค้นหาชื่อ รหัสเจ้าหน้าที่ หรือยศ..."
              className="input w-full pl-9 text-xs"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <Filter size={13} className="text-gray-500" />
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="input text-xs" title="ตั้งแต่วันที่" />
            <span className="text-gray-600 text-xs">–</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="input text-xs" title="ถึงวันที่" />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            className="input text-xs"
            title="กรองตามสถานะ"
          >
            <option value="all">ทุกสถานะ</option>
            <option value="ok">สำเร็จ</option>
            <option value="open">กำลังเข้าเวร</option>
            <option value="forced">บังคับออกเวร</option>
            <option value="deleted">ถูกลบแล้ว</option>
          </select>
          <button onClick={resetFilters} className="btn-secondary text-xs">ล้างตัวกรอง</button>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <button
            onClick={() => setShowDeleted((v) => !v)}
            className={`flex items-center gap-1 px-2 py-1 rounded-lg border transition-colors ${
              showDeleted
                ? 'bg-gray-500/15 text-gray-200 border-gray-500/40'
                : 'text-gray-500 border-blue-900/40 hover:text-gray-300'
            }`}
          >
            {showDeleted ? <EyeOff size={11} /> : <Eye size={11} />}
            แสดงรายการที่ถูกลบ
          </button>
          <span className="text-gray-500">
            {filtered.length.toLocaleString('th-TH')} รายการ
            {filtered.length > shown.length && ` · แสดง ${shown.length}`}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-gray-500">รวม {totals.count} เวร</span>
            <span className="text-blue-300">{fmtDur(totals.hours)}</span>
            {totals.open > 0 && <span className="text-emerald-300">· เข้าเวรค้าง {totals.open}</span>}
            {totals.forced > 0 && <span className="text-amber-300">· บังคับออก {totals.forced}</span>}
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
            <Users size={32} className="text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400">ไม่พบรายการที่ตรงกับเงื่อนไข</p>
          </div>
        ) : (
          <table className="w-full text-xs min-w-[860px]">
            <thead>
              <tr className="border-b border-blue-900/40">
                {['วันที่และเวลาเข้า', 'เจ้าหน้าที่', 'กะ', 'ออกเวร / ระยะเวลา', 'สถานะ', 'ผู้บันทึก', ''].map((h) => (
                  <th key={h} className="text-left px-3 py-2.5 text-gray-400 font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const o = r.officer_id ? byOfficer.get(r.officer_id) : undefined;
                const sh = shiftOf(r.clock_in);
                const st = statusOf(r);
                const recorder = r.forced_by_name ?? r.deleted_by_name;
                return (
                  <tr key={r.id} className={`border-b border-blue-900/25 hover:bg-navy-800/40 ${r.deleted_at ? 'opacity-55' : ''}`}>
                    <td className="px-3 py-2 text-gray-300 whitespace-nowrap">
                      <div>{new Date(r.clock_in).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' })}</div>
                      <div className="text-gray-500 font-mono text-[11px]">
                        {new Date(r.clock_in).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="text-gray-200">{o?.name ?? r.officer_name}</div>
                      <div className="text-[10px] text-gray-500">
                        {o?.username ? <span className="font-mono">{o.username}</span> : <span className="font-mono">ไม่ทราบรหัส</span>}
                        {' · '}{rankLabel.get(o?.rank ?? '') ?? RANK_LABELS[(o?.rank ?? 'officer') as keyof typeof RANK_LABELS] ?? '—'}
                      </div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {sh
                        ? <span className="px-1.5 py-0.5 rounded border border-blue-500/30 bg-blue-500/10 text-blue-300 text-[10px]">{SHIFT_LABELS[sh]}</span>
                        : <span className="text-gray-600">—</span>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <div className="text-gray-300 font-mono text-[11px]">
                        {r.clock_out ? new Date(r.clock_out).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : 'ยังไม่ออกเวร'}
                      </div>
                      <div className="text-[10px] text-gray-500">{fmtDur(r.duration_minutes)}</div>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold whitespace-nowrap ${st.cls}`}>
                        {st.label}
                      </span>
                      {r.delete_reason && (
                        <div className="text-[10px] text-gray-500 mt-0.5 max-w-[160px] truncate" title={r.delete_reason}>
                          {r.delete_reason}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-gray-400 whitespace-nowrap">
                      {recorder ?? '—'}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setView(r)}
                          className="p-1.5 rounded text-gray-500 hover:text-blue-400 hover:bg-blue-500/10"
                          title="ดูรายละเอียด"
                        >
                          <Search size={13} />
                        </button>
                        {!r.deleted_at && (
                          <button
                            onClick={() => { setTarget(r); setReason(''); }}
                            className="p-1.5 rounded text-gray-500 hover:text-red-400 hover:bg-red-500/10"
                            title="ลบประวัติ"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
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
            <button onClick={() => setLimit((v) => v + 100)} className="btn-secondary text-xs flex items-center gap-1.5 mx-auto">
              <ChevronDown size={13} /> แสดงเพิ่มอีก (เหลือ {(filtered.length - shown.length).toLocaleString('th-TH')})
            </button>
          </div>
        )}
      </div>

      {/* ---------- ยืนยันลบ ---------- */}
      {target && (
        <Modal title="ยืนยันการลบประวัติการเข้าเวร" onClose={() => setTarget(null)} size="sm">
          <div className="space-y-3">
            <div className="text-xs text-gray-300 leading-relaxed">
              ลบประวัติการเข้าเวรของ <strong className="text-white">{target.officer_name}</strong> วันที่{' '}
              <strong className="text-white">{fmtDT(target.clock_in)}</strong> ({fmtDur(target.duration_minutes)}) ใช่หรือไม่
            </div>

            <div className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 leading-relaxed">
              ระบบจะ "ซ่อน" รายการนี้ (ตั้ง deleted_at) ไม่ได้ลบแถวทิ้งจริง
              เพื่อให้ย้อนตรวจสอบได้ และเพื่อไม่ให้คะแนน PPS ที่เคยให้จากเวรนี้ขัดแย้งกับประวัติ
            </div>

            <div>
              <label className="block text-[11px] text-gray-400 mb-1.5">เหตุผลการลบ</label>
              <input
                autoFocus
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="ระบุเหตุผล (ไม่บังคับ)"
                className="input w-full text-xs"
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={doDelete}
                disabled={saving}
                className="btn-danger flex-1 text-xs disabled:opacity-40 flex items-center justify-center gap-1.5"
              >
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                ยืนยันลบ
              </button>
              <button onClick={() => setTarget(null)} className="btn-secondary text-xs">ยกเลิก</button>
            </div>
          </div>
        </Modal>
      )}

      {/* ---------- รายละเอียด ---------- */}
      {view && (
        <Modal title="รายละเอียดการเข้าเวร" onClose={() => setView(null)} size="sm">
          <div className="space-y-1.5 text-xs">
            {[
              ['เจ้าหน้าที่', view.officer_name],
              ['เข้าเวร', fmtDT(view.clock_in)],
              ['ออกเวร', fmtDT(view.clock_out)],
              ['ระยะเวลา', fmtDur(view.duration_minutes)],
              ['กะ', (() => { const sh = shiftOf(view.clock_in); return sh ? SHIFT_LABELS[sh] : '—'; })()],
              ['สถานะ', statusOf(view).label],
              ['วิธีออกเวร', view.checkout_method ?? '—'],
              ['ผู้บังคับออกเวร', view.forced_by_name ?? '—'],
              ['ผู้ลบ', view.deleted_by_name ?? '—'],
              ['เหตุผลการลบ', view.delete_reason ?? '—'],
            ].map(([k, v]) => (
              <div key={k} className="flex gap-3 py-1 border-b border-blue-900/25 last:border-0">
                <span className="text-gray-500 w-32 flex-shrink-0">{k}</span>
                <span className="text-gray-200 flex-1 break-words">{v}</span>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
