import { useEffect, useState } from 'react';
import {
  MessageSquare, Eye, CheckCircle, XCircle, Clock, Search,
  User, Calendar, FileText, ExternalLink,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/AuthContext';
import { Badge } from '../../components/Badge';
import { Modal } from '../../components/Modal';
import { PageHeader } from '../../components/PageHeader';

interface Complaint {
  id: string;
  discord_username: string;
  officer_name: string;
  incident_datetime: string;
  details: string;
  evidence_url: string;
  status: 'pending' | 'reviewing' | 'resolved' | 'dismissed';
  created_at: string;
}

const STATUS_LABELS: Record<Complaint['status'], string> = {
  pending: 'รอดำเนินการ',
  reviewing: 'กำลังตรวจสอบ',
  resolved: 'ดำเนินการแล้ว',
  dismissed: 'ยกเลิก',
};

const STATUS_VARIANTS: Record<Complaint['status'], 'warning' | 'info' | 'success' | 'danger'> = {
  pending: 'warning',
  reviewing: 'info',
  resolved: 'success',
  dismissed: 'danger',
};

export function ComplaintsManagementPage() {
  const { officer } = useAuth();
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQ, setSearchQ] = useState('');
  const [filterStatus, setFilterStatus] = useState<Complaint['status'] | 'all'>('all');
  const [selected, setSelected] = useState<Complaint | null>(null);
  const [updating, setUpdating] = useState(false);

  useEffect(() => { fetchAll(); }, []);

  async function fetchAll() {
    setLoading(true);
    const { data } = await supabase
      .from('complaints')
      .select('*')
      .order('created_at', { ascending: false });
    setComplaints(data ?? []);
    setLoading(false);
  }

  async function updateStatus(id: string, newStatus: Complaint['status']) {
    setUpdating(true);
    await supabase.from('complaints').update({ status: newStatus }).eq('id', id);
    await supabase.from('audit_logs').insert({
      action: 'UPDATE_COMPLAINT_STATUS',
      target_type: 'complaint',
      target_id: id,
      performed_by: officer?.id,
      performed_by_name: officer?.name,
      details: { new_status: newStatus },
    });
    setComplaints((prev) => prev.map((c) => c.id === id ? { ...c, status: newStatus } : c));
    if (selected?.id === id) setSelected((prev) => prev ? { ...prev, status: newStatus } : null);
    setUpdating(false);
  }

  const filtered = complaints.filter((c) => {
    const q = searchQ.toLowerCase();
    const matchQ = !q ||
      c.discord_username.toLowerCase().includes(q) ||
      c.officer_name.toLowerCase().includes(q) ||
      c.details.toLowerCase().includes(q);
    const matchStatus = filterStatus === 'all' || c.status === filterStatus;
    return matchQ && matchStatus;
  });

  const counts = {
    all: complaints.length,
    pending: complaints.filter((c) => c.status === 'pending').length,
    reviewing: complaints.filter((c) => c.status === 'reviewing').length,
    resolved: complaints.filter((c) => c.status === 'resolved').length,
    dismissed: complaints.filter((c) => c.status === 'dismissed').length,
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('th-TH', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });

  return (
    <div>
      <PageHeader
        icon={<MessageSquare size={26} />}
        title="จัดการเรื่องร้องเรียน"
        subtitle="ตรวจสอบและดำเนินการกับเรื่องร้องเรียนจากประชาชน"
      />

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
        <StatCard label="ทั้งหมด" count={counts.all} active={filterStatus === 'all'} onClick={() => setFilterStatus('all')} color="gray" />
        <StatCard label="รอดำเนินการ" count={counts.pending} active={filterStatus === 'pending'} onClick={() => setFilterStatus('pending')} color="amber" />
        <StatCard label="กำลังตรวจสอบ" count={counts.reviewing} active={filterStatus === 'reviewing'} onClick={() => setFilterStatus('reviewing')} color="blue" />
        <StatCard label="ดำเนินการแล้ว" count={counts.resolved} active={filterStatus === 'resolved'} onClick={() => setFilterStatus('resolved')} color="green" />
        <StatCard label="ยกเลิก" count={counts.dismissed} active={filterStatus === 'dismissed'} onClick={() => setFilterStatus('dismissed')} color="red" />
      </div>

      {/* Search */}
      <div className="relative mb-6 max-w-sm">
        <span className="ph-corner ph-corner-tl" aria-hidden />
        <span className="ph-corner ph-corner-br" aria-hidden />
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          className="input-field pl-9"
          placeholder="ค้นหา..."
          value={searchQ}
          onChange={(e) => setSearchQ(e.target.value)}
        />
      </div>

      {/* Table */}
      <div className="table-panel">
        <div className="overflow-x-auto">
          {loading ? (
            <div className="p-8 text-center text-gray-500 text-sm">กำลังโหลด...</div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center">
              <MessageSquare size={36} className="text-gray-600 mx-auto mb-2" />
              <p className="text-gray-400 text-sm">ไม่พบเรื่องร้องเรียน</p>
            </div>
          ) : (
            <table className="w-full">
              <thead className="table-header-gold">
                <tr className="border-b border-amber-500/15">
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase">ผู้ร้องเรียน</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase">เจ้าหน้าที่ที่ร้องเรียน</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase">วันที่ร้องเรียน</th>
                  <th className="text-center px-5 py-3 text-xs font-medium text-gray-500 uppercase">สถานะ</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id} className="table-row cursor-pointer" onClick={() => setSelected(c)}>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <User size={14} className="text-gray-500" />
                        <span className="text-white text-sm">{c.discord_username || 'ไม่ระบุตัวตน'}</span>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-sm text-gray-400">{c.officer_name || '-'}</td>
                    <td className="px-5 py-4 text-sm text-gray-400 whitespace-nowrap">{formatDate(c.created_at)}</td>
                    <td className="px-5 py-4 text-center">
                      <Badge variant={STATUS_VARIANTS[c.status]}>{STATUS_LABELS[c.status]}</Badge>
                    </td>
                    <td className="px-5 py-4">
                      <button className="p-1.5 rounded text-gray-500 hover:text-amber-400 hover:bg-amber-500/10 transition-colors">
                        <Eye size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Detail Modal */}
      {selected && (
        <Modal
          title="รายละเอียดเรื่องร้องเรียน"
          onClose={() => setSelected(null)}
          size="lg"
        >
          <div className="space-y-4">
            {/* Status */}
            <div className="flex items-center justify-between">
              <span className="text-gray-400 text-sm">สถานะปัจจุบัน</span>
              <Badge variant={STATUS_VARIANTS[selected.status]}>{STATUS_LABELS[selected.status]}</Badge>
            </div>

            {/* Info Grid */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-navy-900 rounded-lg p-3">
                <div className="text-gray-500 text-xs mb-1">Discord Username</div>
                <div className="text-white text-sm font-medium">{selected.discord_username || 'ไม่ระบุตัวตน'}</div>
              </div>
              <div className="bg-navy-900 rounded-lg p-3">
                <div className="text-gray-500 text-xs mb-1">เจ้าหน้าที่ที่ร้องเรียน</div>
                <div className="text-white text-sm font-medium">{selected.officer_name || 'ไม่ระบุ'}</div>
              </div>
            </div>

            {/* Incident */}
            <div className="bg-navy-900 rounded-lg p-3">
              <div className="flex items-center gap-2 text-gray-500 text-xs mb-1">
                <Calendar size={12} />
                วัน เวลา และสถานที่เกิดเหตุ
              </div>
              <div className="text-white text-sm">{selected.incident_datetime || '-'}</div>
            </div>

            {/* Details */}
            <div className="bg-navy-900 rounded-lg p-3">
              <div className="flex items-center gap-2 text-gray-500 text-xs mb-1">
                <FileText size={12} />
                รายละเอียด
              </div>
              <div className="text-white text-sm whitespace-pre-line">{selected.details}</div>
            </div>

            {/* Evidence */}
            {selected.evidence_url && (
              <div className="bg-navy-900 rounded-lg p-3">
                <div className="text-gray-500 text-xs mb-1">หลักฐาน</div>
                <a
                  href={selected.evidence_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-amber-400 text-sm hover:underline inline-flex items-center gap-1"
                >
                  {selected.evidence_url}
                  <ExternalLink size={12} />
                </a>
              </div>
            )}

            {/* Timestamp */}
            <div className="text-gray-500 text-xs text-right">
              ร้องเรียนเมื่อ {formatDate(selected.created_at)}
            </div>

            {/* Status Actions */}
            <div className="pt-4 border-t border-amber-500/15">
              <div className="text-gray-400 text-xs mb-2">เปลี่ยนสถานะ</div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => updateStatus(selected.id, 'reviewing')}
                  disabled={updating || selected.status === 'reviewing'}
                  className={`px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                    selected.status === 'reviewing'
                      ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                      : 'bg-navy-700 text-gray-300 hover:bg-navy-600'
                  }`}
                >
                  <Clock size={12} className="inline mr-1" />
                  กำลังตรวจสอบ
                </button>
                <button
                  onClick={() => updateStatus(selected.id, 'resolved')}
                  disabled={updating || selected.status === 'resolved'}
                  className={`px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                    selected.status === 'resolved'
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                      : 'bg-navy-700 text-gray-300 hover:bg-emerald-500/20 hover:text-emerald-400'
                  }`}
                >
                  <CheckCircle size={12} className="inline mr-1" />
                  ดำเนินการแล้ว
                </button>
                <button
                  onClick={() => updateStatus(selected.id, 'dismissed')}
                  disabled={updating || selected.status === 'dismissed'}
                  className={`px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                    selected.status === 'dismissed'
                      ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                      : 'bg-navy-700 text-gray-300 hover:bg-red-500/20 hover:text-red-400'
                  }`}
                >
                  <XCircle size={12} className="inline mr-1" />
                  ยกเลิก
                </button>
              </div>
            </div>

            <div className="flex pt-3">
              <button onClick={() => setSelected(null)} className="btn-secondary w-full">
                ปิด
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function StatCard({
  label, count, active, onClick, color,
}: {
  label: string; count: number; active: boolean; onClick: () => void; color: string;
}) {
  const colors: Record<string, string> = {
    gray: active ? 'bg-gray-500/20 border-gray-500/40 text-gray-300' : 'text-gray-400',
    amber: active ? 'bg-amber-500/20 border-amber-500/40 text-amber-400' : 'text-gray-400',
    blue: active ? 'bg-blue-500/20 border-blue-500/40 text-blue-400' : 'text-gray-400',
    green: active ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400' : 'text-gray-400',
    red: active ? 'bg-red-500/20 border-red-500/40 text-red-400' : 'text-gray-400',
  };
  return (
    <button
      onClick={onClick}
      className={`card p-3 text-center transition-all ${active ? 'border' : 'hover:bg-navy-700/50'}`}
    >
      <div className={`text-xl font-bold ${colors[color]}`}>{count}</div>
      <div className={`text-[10px] ${active ? colors[color] : 'text-gray-500'}`}>{label}</div>
    </button>
  );
}
