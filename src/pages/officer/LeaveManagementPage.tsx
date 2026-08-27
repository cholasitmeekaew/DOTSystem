import { useEffect, useState } from 'react';
import {
  Plus, Calendar, Edit2, Trash2, X, Save, CheckCircle2, XCircle,
  Clock, User, FileText, CalendarDays, CalendarRange,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/AuthContext';
import {
  OfficerLeave, LeaveType, LeaveStatus,
  LEAVE_TYPE_LABELS, LEAVE_STATUS_LABELS,
} from '../../lib/types';
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

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: 'numeric' });
}

function daysBetween(start: string, end: string) {
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  return Math.floor((e - s) / (1000 * 60 * 60 * 24)) + 1;
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

  const [form, setForm] = useState({
    leave_type: 'sick' as LeaveType,
    start_date: new Date().toISOString().slice(0, 10),
    end_date: new Date().toISOString().slice(0, 10),
    reason: '',
  });

  useEffect(() => {
    fetchLeaves();
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

  function openAdd() {
    setEditingLeave(null);
    setForm({ leave_type: 'sick', start_date: new Date().toISOString().slice(0, 10), end_date: new Date().toISOString().slice(0, 10), reason: '' });
    setShowForm(true);
  }

  function openEdit(l: OfficerLeave) {
    setEditingLeave(l);
    setForm({ leave_type: l.leave_type, start_date: l.start_date, end_date: l.end_date, reason: l.reason || '' });
    setShowForm(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!officer) return;
    if (new Date(form.end_date) < new Date(form.start_date)) return;

    const payload = {
      officer_id: officer.id,
      officer_name: officer.name,
      leave_type: form.leave_type,
      start_date: form.start_date,
      end_date: form.end_date,
      reason: form.reason || null,
      status: 'pending' as LeaveStatus,
      updated_at: new Date().toISOString(),
    };

    if (editingLeave) {
      await supabase.from('officer_leaves').update({ ...payload, status: editingLeave.status }).eq('id', editingLeave.id);
    } else {
      await supabase.from('officer_leaves').insert(payload);
    }
    setShowForm(false);
  }

  async function deleteLeave(id: string) {
    await supabase.from('officer_leaves').delete().eq('id', id);
    setConfirmDelete(null);
  }

  async function cancelLeave(id: string) {
    await supabase.from('officer_leaves').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', id);
  }

  async function submitReview() {
    if (!reviewingLeave || !officer) return;
    await supabase.from('officer_leaves').update({
      status: reviewAction,
      reviewed_by: officer.id,
      reviewed_by_name: officer.name,
      reviewed_at: new Date().toISOString(),
      review_note: reviewNote || null,
      updated_at: new Date().toISOString(),
    }).eq('id', reviewingLeave.id);
    setReviewingLeave(null);
    setReviewNote('');
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
              <select className="input-field" value={form.leave_type} onChange={(e) => setForm({ ...form, leave_type: e.target.value as LeaveType })}>
                {Object.entries(LEAVE_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">วันที่เริ่มลา</label>
                <input type="date" className="input-field" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">วันที่สิ้นสุด</label>
                <input type="date" className="input-field" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
              </div>
            </div>
            {form.start_date && form.end_date && new Date(form.end_date) >= new Date(form.start_date) && (
              <div className="text-xs text-amber-400 bg-amber-500/10 rounded-lg px-3 py-2 flex items-center gap-1.5">
                <Clock size={13} />
                จำนวนวันลา: {daysBetween(form.start_date, form.end_date)} วัน
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">เหตุผลการลา</label>
              <textarea className="input-field resize-none" rows={3} placeholder="ระบุเหตุผล..." value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary flex-1">ยกเลิก</button>
              <button type="submit" className="btn-primary flex-1 flex items-center justify-center gap-2">
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
