import { useEffect, useMemo, useState } from 'react';
import {
  Plus, Calendar, Edit2, Trash2, X, Save, CheckCircle2, XCircle,
  Clock, User, FileText, CalendarDays, CalendarRange, AlertCircle, Gauge,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/AuthContext';
import {
  OfficerLeave, LeaveType, LeaveStatus, LeaveQuota,
  LEAVE_TYPE_LABELS, LEAVE_STATUS_LABELS,
} from '../../lib/types';
import {
  daysBetween, monthKey, resolveQuotas, validateLeaveRequest,
  buildMonthlyQuotaSummary, formatQuotaLine, currentMonthKey,
} from '../../lib/leaveQuota';
import { Badge } from '../../components/Badge';
import { Modal, ConfirmDialog } from '../../components/Modal';
import { PageHeader } from '../../components/PageHeader';

const STATUS_VARIANTS: Record<LeaveStatus, 'warning' | 'success' | 'danger' | 'neutral'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
};

const TYPE_COLORS: Record<LeaveType, string> = {
  sick: 'text-red-400 bg-red-500/10 border-red-500/30',
  personal: 'text-blue-400 bg-blue-500/10 border-blue-500/30',
  vacation: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
  maternity: 'text-pink-400 bg-pink-500/10 border-pink-500/30',
  ordained: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
  other: 'text-gray-400 bg-gray-500/10 border-gray-500/30',
};

/** ชนิดของคีย์โควตาที่มีโควตาจำกัด (ไม่รวมประเภทที่ไม่จำกัด) */
const QUOTA_BAR_COLORS = [
  'bg-red-500',
  'bg-blue-500',
  'bg-emerald-500',
  'bg-pink-500',
  'bg-amber-500',
  'bg-gray-500',
];

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: 'numeric' });
}

function thaiMonthLabel(month: string) {
  const m = month.slice(5, 7);
  const names = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const idx = Number(m) - 1;
  return `${names[idx] ?? m} ${month.slice(0, 4)}`;
}

export function LeaveManagementPage() {
  const { officer, isCommissioner } = useAuth();
  const [leaves, setLeaves] = useState<OfficerLeave[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingLeave, setEditingLeave] = useState<OfficerLeave | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<OfficerLeave | null>(null);
  const [reviewingLeave, setReviewingLeave] = useState<OfficerLeave | null>(null);
  const [reviewAction, setReviewAction] = useState<'approved' | 'rejected'>('approved');
  const [reviewNote, setReviewNote] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | LeaveStatus>('all');
  const [filterType, setFilterType] = useState<'all' | LeaveType>('all');
  const [searchQ, setSearchQ] = useState('');
  const [quotaRows, setQuotaRows] = useState<LeaveQuota[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  const [form, setForm] = useState({
    leave_type: 'sick' as LeaveType,
    start_date: new Date().toISOString().slice(0, 10),
    end_date: new Date().toISOString().slice(0, 10),
    reason: '',
  });

  /** โควตาที่ใช้งานจริง (จากตาราง leave_quotas + ค่าตั้งต้น) */
  const quotas = useMemo(() => resolveQuotas(quotaRows), [quotaRows]);

  /** ใบลาของ "ฉัน" — ใช้คำนวณโควตาส่วนตัวแบบ real-time */
  const myLeaves = useMemo(
    () => leaves.filter((l) => officer && l.officer_id === officer.id),
    [leaves, officer],
  );

  /** ผลตรวจสอบฟอร์ม — คำนวณทุกครั้งที่ฟิลด์เปลี่ยน (real-time) */
  const validation = useMemo(
    () => validateLeaveRequest({
      startDate: form.start_date,
      endDate: form.end_date,
      leaveType: form.leave_type,
      leaves: myLeaves,
      quotas,
      excludeLeaveId: editingLeave?.id ?? null,
    }),
    [form.start_date, form.end_date, form.leave_type, myLeaves, quotas, editingLeave],
  );

  /** สรุปโควตาของผู้ยื่นลา สำหรับหน้าอนุมัติของ commissioner */
  const reviewQuotaSummary = useMemo(() => {
    if (!reviewingLeave) return null;
    const month = monthKey(reviewingLeave.start_date);
    const officerLeaves = leaves.filter((l) => l.officer_id === reviewingLeave.officer_id);
    return buildMonthlyQuotaSummary(officerLeaves, quotas, month);
  }, [reviewingLeave, leaves, quotas]);

  useEffect(() => {
    fetchLeaves();
    fetchQuotas();
    const ch = supabase.channel('officer_leaves_rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'officer_leaves' }, () => fetchLeaves())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  async function fetchLeaves() {
    setLoading(true);
    const { data } = await supabase.from('officer_leaves').select('*').order('created_at', { ascending: false });
    setLeaves(data ?? []);
    setLoading(false);
  }

  async function fetchQuotas() {
    const { data } = await supabase.from('leave_quotas').select('*');
    setQuotaRows((data ?? []) as unknown as LeaveQuota[]);
  }

  function openAdd() {
    setEditingLeave(null);
    setFormError(null);
    setForm({ leave_type: 'sick', start_date: new Date().toISOString().slice(0, 10), end_date: new Date().toISOString().slice(0, 10), reason: '' });
    setShowForm(true);
  }

  function openEdit(l: OfficerLeave) {
    setEditingLeave(l);
    setFormError(null);
    setForm({ leave_type: l.leave_type, start_date: l.start_date, end_date: l.end_date, reason: l.reason || '' });
    setShowForm(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!officer) return;

    // บล็อกการส่งคำขอเมื่อวันลาเกินโควตาคงเหลือของเดือนนั้น
    if (!validation.ok) {
      setFormError(validation.message);
      return;
    }
    setFormError(null);

    const payload = {
      officer_id: officer.id,
      officer_name: officer.name,
      leave_type: form.leave_type,
      start_date: form.start_date,
      end_date: form.end_date,
      days: validation.days,
      reason: form.reason || null,
      status: 'pending' as LeaveStatus,
      updated_at: new Date().toISOString(),
    };

    const { error } = editingLeave
      ? await supabase.from('officer_leaves').update({ ...payload, status: editingLeave.status }).eq('id', editingLeave.id)
      : await supabase.from('officer_leaves').insert(payload);

    if (error) {
      setFormError(`บันทึกใบลาไม่สำเร็จ: ${error.message}`);
      return;
    }
    setShowForm(false);
    await fetchLeaves();
  }

  async function deleteLeave(id: string) {
    // ลบเฉพาะ override ที่สร้างจากใบลานี้ (ref_id) ไม่แตะข้อยกเว้นของคนอื่น
    await supabase.from('schedule_overrides').delete().eq('ref_id', id);
    await supabase.from('officer_leaves').delete().eq('id', id);
    setConfirmDelete(null);
    await fetchLeaves();
  }

  async function cancelLeave(id: string) {
    await supabase.from('schedule_overrides').delete().eq('ref_id', id);
    await supabase.from('officer_leaves').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', id);
    await fetchLeaves();
  }

  /**
   * สร้าง schedule_overrides ให้ทุกวันในช่วงการลา
   * → ตารางเวรจะขึ้นสถานะ "ลา" อัตโนมัติ เพื่อยกเว้นการลงโทษขาดเวร
   */
  async function syncLeaveToSchedule(leave: OfficerLeave) {
    const rows: Record<string, unknown>[] = [];
    const start = new Date(leave.start_date);
    const end = new Date(leave.end_date);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return;

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateIso = new Date(d).toISOString().slice(0, 10);
      // กะที่ 1 / กะที่ 2 ตามรหัสกะใหม่ของตารางเวร (migration 0029)
      for (const shift of ['s1', 's2'] as const) {
        rows.push({
          override_date: dateIso,
          shift_code: shift,
          officer_id: leave.officer_id,
          override_type: 'leave',
          note: `ลา${LEAVE_TYPE_LABELS[leave.leave_type]} — ${leave.officer_name}`,
          source: 'leave_auto',
          ref_id: leave.id,
          created_by: leave.reviewed_by,
          created_by_name: leave.reviewed_by_name,
        });
      }
    }
    if (rows.length === 0) return;
    // upsert ทีละแถวโดยยึดคีย์ (วัน, กะ, คน) — ต้องระบุคนด้วย เพราะตารางรองรับ
    // หลายคนต่อช่องกะแล้ว (migration 0030) การค้นแค่วัน+กะจะทับของคนอื่น
    for (const row of rows) {
      const { data: existing } = await supabase
        .from('schedule_overrides')
        .select('id')
        .eq('override_date', row.override_date as string)
        .eq('shift_code', row.shift_code as string)
        .eq('officer_id', row.officer_id as string)
        .maybeSingle();
      if (existing && existing.id) {
        await supabase.from('schedule_overrides').update(row).eq('id', existing.id);
      } else {
        await supabase.from('schedule_overrides').insert(row);
      }
    }
  }

  async function submitReview() {
    if (!reviewingLeave || !officer) return;
    const { error } = await supabase.from('officer_leaves').update({
      status: reviewAction,
      reviewed_by: officer.id,
      reviewed_by_name: officer.name,
      reviewed_at: new Date().toISOString(),
      review_note: reviewNote || null,
      updated_at: new Date().toISOString(),
    }).eq('id', reviewingLeave.id);

    if (error) {
      alert(`บันทึกผลการพิจารณาไม่สำเร็จ: ${error.message}`);
      return;
    }

    // อนุมัติแล้ว → ทำเครื่องหมาย "ลา" ในตารางเวรให้อัตโนมัติ
    if (reviewAction === 'approved') {
      await syncLeaveToSchedule({ ...reviewingLeave, status: 'approved' });
    } else {
      await supabase.from('schedule_overrides').delete().eq('ref_id', reviewingLeave.id);
    }

    setReviewingLeave(null);
    setReviewNote('');
    await fetchLeaves();
  }

  function openReview(l: OfficerLeave, action: 'approved' | 'rejected') {
    setReviewingLeave(l);
    setReviewAction(action);
    setReviewNote(l.review_note || '');
  }

  const filtered = leaves.filter((l) => {
    if (filterStatus !== 'all' && l.status !== filterStatus) return false;
    if (filterType !== 'all' && l.leave_type !== filterType) return false;
    if (searchQ.trim()) {
      const q = searchQ.toLowerCase();
      if (!l.officer_name.toLowerCase().includes(q) && !(l.reason || '').toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const stats = {
    total: leaves.length,
    pending: leaves.filter((l) => l.status === 'pending').length,
    approved: leaves.filter((l) => l.status === 'approved').length,
    rejected: leaves.filter((l) => l.status === 'rejected').length,
    onLeaveToday: leaves.filter((l) => {
      if (l.status !== 'approved') return false;
      const today = new Date().toISOString().slice(0, 10);
      return l.start_date <= today && l.end_date >= today;
    }).length,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        icon={<CalendarDays size={26} />}
        title="จัดการการลา"
        subtitle="ระบบบันทึกและอนุมัติการลาของเจ้าหน้าที่"
        actions={
          <button onClick={openAdd} className="btn-primary px-5 py-2.5 flex items-center gap-2">
            <Plus size={18} /> แจ้งลา
          </button>
        }
      />

      {/* โควตาของฉันในเดือนนี้ */}
      <MyQuotaStrip quotas={quotas} leaves={myLeaves} />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="card p-4 text-center">
          <div className="text-2xl font-bold text-white">{stats.total}</div>
          <div className="text-xs text-gray-500 mt-1">ทั้งหมด</div>
        </div>
        <div className="card p-4 text-center border-amber-500/20">
          <div className="text-2xl font-bold text-amber-400">{stats.pending}</div>
          <div className="text-xs text-gray-500 mt-1">รอพิจารณา</div>
        </div>
        <div className="card p-4 text-center border-emerald-500/20">
          <div className="text-2xl font-bold text-emerald-400">{stats.approved}</div>
          <div className="text-xs text-gray-500 mt-1">อนุมัติแล้ว</div>
        </div>
        <div className="card p-4 text-center border-red-500/20">
          <div className="text-2xl font-bold text-red-400">{stats.rejected}</div>
          <div className="text-xs text-gray-500 mt-1">ไม่อนุมัติ</div>
        </div>
        <div className="card p-4 text-center border-blue-500/20">
          <div className="text-2xl font-bold text-blue-400">{stats.onLeaveToday}</div>
          <div className="text-xs text-gray-500 mt-1">ลาวันนี้</div>
        </div>
      </div>

      {/* Filters */}
      <div className="card p-4 flex flex-wrap gap-3 relative">
        <span className="ph-corner ph-corner-tl" aria-hidden />
        <span className="ph-corner ph-corner-br" aria-hidden />
        <div className="relative flex-1 min-w-[200px]">
          <input
            className="input-field pl-9"
            placeholder="ค้นหาชื่อเจ้าหน้าที่หรือเหตุผล..."
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
          />
          <User size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        </div>
        <select className="input-field w-auto" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as 'all' | LeaveStatus)}>
          <option value="all">ทุกสถานะ</option>
          <option value="pending">รอพิจารณา</option>
          <option value="approved">อนุมัติแล้ว</option>
          <option value="rejected">ไม่อนุมัติ</option>
          <option value="cancelled">ยกเลิก</option>
        </select>
        <select className="input-field w-auto" value={filterType} onChange={(e) => setFilterType(e.target.value as 'all' | LeaveType)}>
          <option value="all">ทุกประเภท</option>
          {Object.entries(LEAVE_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      {/* List */}
      <div className="table-panel">
        {loading ? (
          <div className="card p-8 text-center text-gray-400">กำลังโหลดข้อมูล...</div>
        ) : filtered.length === 0 ? (
          <div className="card p-8 text-center">
            <CalendarDays size={32} className="text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400">ยังไม่มีรายการลา</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((l) => {
              const canEdit = isCommissioner || (officer && l.officer_id === officer.id);
              const days = daysBetween(l.start_date, l.end_date);
              return (
                <div key={l.id} className="card p-4">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center border ${TYPE_COLORS[l.leave_type]}`}>
                        <Calendar size={18} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-white font-semibold">{l.officer_name}</span>
                          <Badge variant={STATUS_VARIANTS[l.status]}>{LEAVE_STATUS_LABELS[l.status]}</Badge>
                          <span className="text-xs text-gray-500 bg-navy-700 px-2 py-0.5 rounded">{LEAVE_TYPE_LABELS[l.leave_type]}</span>
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 flex-wrap">
                          <span className="flex items-center gap-1">
                            <CalendarRange size={12} />
                            {formatDate(l.start_date)} → {formatDate(l.end_date)}
                          </span>
                          <span className="flex items-center gap-1 text-amber-500/80">
                            <Clock size={12} />
                            {days} วัน
                          </span>
                        </div>
                        {l.reason && (
                          <div className="mt-2 text-sm text-gray-400 bg-navy-700/50 rounded-lg p-2 flex items-start gap-1.5">
                            <FileText size={13} className="text-gray-500 mt-0.5 flex-shrink-0" />
                            {l.reason}
                          </div>
                        )}
                        {l.reviewed_by_name && (
                          <div className="mt-1.5 text-xs text-gray-500">
                            พิจารณาโดย: {l.reviewed_by_name}
                            {l.review_note && ` — "${l.review_note}"`}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      {isCommissioner && l.status === 'pending' && (
                        <>
                          <button onClick={() => openReview(l, 'approved')} className="bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1">
                            <CheckCircle2 size={14} /> อนุมัติ
                          </button>
                          <button onClick={() => openReview(l, 'rejected')} className="bg-red-500/10 text-red-400 hover:bg-red-500/20 px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1">
                            <XCircle size={14} /> ไม่อนุมัติ
                          </button>
                        </>
                      )}
                      {canEdit && l.status === 'pending' && (
                        <button onClick={() => openEdit(l)} className="bg-navy-700 text-gray-400 hover:text-white p-1.5 rounded-lg" title="แก้ไข">
                          <Edit2 size={14} />
                        </button>
                      )}
                      {canEdit && (l.status === 'pending' || l.status === 'approved') && (
                        <button onClick={() => cancelLeave(l.id)} className="bg-gray-500/10 text-gray-400 hover:bg-gray-500/20 p-1.5 rounded-lg" title="ยกเลิก">
                          <X size={14} />
                        </button>
                      )}
                      {canEdit && (
                        <button onClick={() => setConfirmDelete(l)} className="bg-red-500/10 text-red-400 hover:bg-red-500/20 p-1.5 rounded-lg" title="ลบ">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add/Edit Form */}
      {showForm && (
        <Modal title={editingLeave ? 'แก้ไขใบลา' : 'แจ้งการลา'} onClose={() => setShowForm(false)} size="md">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">ประเภทการลา</label>
              <select
                className="input-field"
                value={form.leave_type}
                onChange={(e) => { setForm({ ...form, leave_type: e.target.value as LeaveType }); setFormError(null); }}
              >
                {Object.entries(LEAVE_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">วันที่เริ่มลา</label>
                <input
                  type="date"
                  className="input-field"
                  value={form.start_date}
                  onChange={(e) => { setForm({ ...form, start_date: e.target.value }); setFormError(null); }}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">วันที่สิ้นสุด</label>
                <input
                  type="date"
                  className="input-field"
                  min={form.start_date}
                  value={form.end_date}
                  onChange={(e) => { setForm({ ...form, end_date: e.target.value }); setFormError(null); }}
                />
              </div>
            </div>

            {/* ---------- สรุปจำนวนวัน + โควตาแบบ real-time ---------- */}
            <QuotaLivePanel validation={validation} />

            {formError && (
              <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 flex items-start gap-1.5">
                <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />
                {formError}
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">เหตุผลการลา</label>
              <textarea className="input-field resize-none" rows={3} placeholder="ระบุเหตุผล..." value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary flex-1">ยกเลิก</button>
              <button
                type="submit"
                disabled={!validation.ok}
                className="btn-primary flex-1 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                title={validation.ok ? undefined : validation.message ?? undefined}
              >
                <Save size={16} /> บันทึก
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Review Modal */}
      {reviewingLeave && (
        <Modal
          title={reviewAction === 'approved' ? 'อนุมัติการลา' : 'ไม่อนุมัติการลา'}
          onClose={() => { setReviewingLeave(null); setReviewNote(''); }}
          size="md"
        >
          <div className="space-y-4">
            <div className="card p-3 bg-navy-700/50">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-white font-semibold">{reviewingLeave.officer_name}</span>
                <span className="text-xs text-gray-500 bg-navy-700 px-2 py-0.5 rounded">{LEAVE_TYPE_LABELS[reviewingLeave.leave_type]}</span>
              </div>
              <div className="text-xs text-gray-500 flex items-center gap-1">
                <CalendarRange size={12} />
                {formatDate(reviewingLeave.start_date)} → {formatDate(reviewingLeave.end_date)} ({daysBetween(reviewingLeave.start_date, reviewingLeave.end_date)} วัน)
              </div>
              {reviewingLeave.reason && <div className="mt-2 text-sm text-gray-400">{reviewingLeave.reason}</div>}
            </div>

            {/* ---------- สรุปการใช้โควตาสะสมของผู้ยื่นลา ---------- */}
            {reviewQuotaSummary && (
              <div className="card p-3 space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-amber-400">
                  <Gauge size={13} />
                  การใช้โควตาสะสมเดือน {thaiMonthLabel(reviewQuotaSummary.month)}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {reviewQuotaSummary.byType.map((u, i) => (
                    <div key={u.leaveType} className="flex items-center justify-between gap-2 text-[11px] bg-navy-700/50 rounded px-2 py-1">
                      <span className="text-gray-400">{formatQuotaLine(u)}</span>
                      {!u.unlimited && (
                        <div className="w-12 h-1.5 rounded-full bg-navy-900 overflow-hidden flex-shrink-0">
                          <div
                            className={`h-full ${u.ratio >= 1 ? 'bg-red-500' : QUOTA_BAR_COLORS[i % QUOTA_BAR_COLORS.length]}`}
                            style={{ width: `${Math.round(u.ratio * 100)}%` }}
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                {(() => {
                  const u = reviewQuotaSummary.byType.find((x) => x.leaveType === reviewingLeave.leave_type);
                  if (!u) return null;
                  const wantDays = daysBetween(reviewingLeave.start_date, reviewingLeave.end_date);
                  const isOver = !u.unlimited && u.remaining !== null && u.remaining < wantDays;
                  return (
                    <p className={`text-[11px] leading-relaxed ${isOver ? 'text-red-400' : 'text-emerald-400'}`}>
                      {u.unlimited
                        ? `ประเภทนี้ไม่จำกัดโควตา · ใบลานี้ใช้ ${wantDays} วัน`
                        : isOver
                          ? `⚠ ใบลานี้ขอ ${wantDays} วัน แต่คงเหลือเพียง ${u.remaining} วัน — พิจารณากำลังพลประจำวัน`
                          : `ใบลานี้ขอ ${wantDays} วัน · โควตาคงเหลือหลังอนุมัติ ${(u.remaining ?? 0) - wantDays} วัน`}
                    </p>
                  );
                })()}
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">หมายเหตุการพิจารณา</label>
              <textarea className="input-field resize-none" rows={2} placeholder="หมายเหตุ..." value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} />
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => { setReviewingLeave(null); setReviewNote(''); }} className="btn-secondary flex-1">ยกเลิก</button>
              <button
                type="button"
                onClick={submitReview}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium ${
                  reviewAction === 'approved'
                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                    : 'bg-red-600 hover:bg-red-700 text-white'
                }`}
              >
                {reviewAction === 'approved' ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
                {reviewAction === 'approved' ? 'ยืนยันการอนุมัติ' : 'ยืนยันการไม่อนุมัติ'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Delete Confirmation */}
      {confirmDelete && (
        <ConfirmDialog
          title="ลบรายการลา"
          message={`ต้องการลบใบลาของ "${confirmDelete.officer_name}" ใช่หรือไม่?`}
          onConfirm={() => deleteLeave(confirmDelete.id)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

/* =============================================================
 * แถบโควตาส่วนตัวของเจ้าหน้าที่
 * ============================================================= */
function MyQuotaStrip({
  quotas,
  leaves,
}: {
  quotas: Record<LeaveType, number>;
  leaves: OfficerLeave[];
}) {
  const month = currentMonthKey();
  const summary = buildMonthlyQuotaSummary(leaves, quotas, month);

  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-3">
        <Gauge size={15} className="text-amber-400" />
        <h2 className="text-sm font-semibold text-white">โควตาการลาของฉัน</h2>
        <span className="text-[11px] text-gray-500">เดือน {thaiMonthLabel(month)}</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        {summary.byType.map((u, i) => (
          <div key={u.leaveType} className="bg-navy-700/50 border border-blue-900/40 rounded-lg px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-gray-300">{u.label}</span>
              <span className={`text-[11px] font-mono font-semibold ${u.unlimited ? 'text-gray-500' : u.remaining === 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                {u.unlimited ? 'ไม่จำกัด' : `เหลือ ${u.remaining} วัน`}
              </span>
            </div>
            {!u.unlimited && (
              <>
                <div className="mt-1.5 h-1.5 rounded-full bg-navy-900 overflow-hidden">
                  <div
                    className={`h-full ${u.ratio >= 1 ? 'bg-red-500' : QUOTA_BAR_COLORS[i % QUOTA_BAR_COLORS.length]}`}
                    style={{ width: `${Math.round(u.ratio * 100)}%` }}
                  />
                </div>
                <div className="text-[10px] text-gray-500 mt-1 font-mono">ใช้แล้ว {u.used}/{u.quota} วัน</div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* =============================================================
 * แผงแสดงโควตาแบบ real-time ในฟอร์มแจ้งลา
 * ============================================================= */
function QuotaLivePanel({ validation }: { validation: ReturnType<typeof validateLeaveRequest> }) {
  const u = validation.usage;

  return (
    <div className={`rounded-lg px-3 py-2.5 border ${validation.ok ? 'bg-amber-500/10 border-amber-500/25' : 'bg-red-500/10 border-red-500/35'}`}>
      <div className="flex items-center justify-between gap-3">
        <span className={`text-xs font-semibold flex items-center gap-1.5 ${validation.ok ? 'text-amber-400' : 'text-red-400'}`}>
          <Clock size={13} />
          จำนวนวันลา: {validation.days} วัน
        </span>
        {u && (
          <span className={`text-[11px] font-mono ${validation.ok ? 'text-amber-300/80' : 'text-red-400'}`}>
            เดือน {thaiMonthLabel(validation.month)}
          </span>
        )}
      </div>

      {u && !u.unlimited && (
        <div className="mt-2 space-y-1">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-gray-400">{u.label}</span>
            <span className="text-gray-300 font-mono">
              ใช้แล้ว {u.used}/{u.quota} วัน
            </span>
          </div>
          <div className="h-2 rounded-full bg-navy-900 overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${u.remaining !== null && u.remaining < validation.days ? 'bg-red-500' : 'bg-amber-500'}`}
              style={{ width: `${Math.min(100, Math.max(3, (u.used / Math.max(1, u.quota)) * 100))}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-gray-500">โควตาคงเหลือ</span>
            <span className={`font-semibold font-mono ${u.remaining !== null && u.remaining < validation.days ? 'text-red-400' : 'text-emerald-400'}`}>
              {u.remaining ?? '—'} วัน
            </span>
          </div>
        </div>
      )}

      {u?.unlimited && (
        <p className="text-[11px] text-gray-400 mt-1.5">ประเภทนี้ไม่จำกัดโควตา</p>
      )}

      {validation.message && (
        <p className={`text-[11px] mt-2 leading-relaxed ${validation.ok ? 'text-emerald-400' : 'text-red-400'}`}>
          {validation.message}
        </p>
      )}
    </div>
  );
}
