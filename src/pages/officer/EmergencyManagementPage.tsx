import { useEffect, useState } from 'react';
import {
  Siren, AlertTriangle, CarFront, Wrench, Truck as TowTruck,
  Eye, Trash2, MapPin, Clock, User, CheckCircle2,
  XCircle, Loader2,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import {
  EmergencyReport, EmergencyReportType, EmergencyReportStatus,
  EMERGENCY_TYPE_LABELS, EMERGENCY_STATUS_LABELS,
} from '../../lib/types';
import { useAuth } from '../../lib/AuthContext';
import { Badge } from '../../components/Badge';
import { Modal, ConfirmDialog } from '../../components/Modal';
import { PageHeader } from '../../components/PageHeader';

const TYPE_ICONS: Record<EmergencyReportType, React.ReactNode> = {
  accident: <AlertTriangle size={16} />,
  breakdown: <CarFront size={16} />,
  towing: <TowTruck size={16} />,
  other: <Wrench size={16} />,
};

const STATUS_BADGE: Record<EmergencyReportStatus, 'warning' | 'info' | 'success' | 'neutral'> = {
  pending: 'warning',
  responding: 'info',
  resolved: 'success',
  dismissed: 'neutral',
};

export function EmergencyManagementPage() {
  const { officer, isCommissioner } = useAuth();
  const [reports, setReports] = useState<EmergencyReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<'all' | EmergencyReportStatus>('all');
  const [viewReport, setViewReport] = useState<EmergencyReport | null>(null);
  const [deleteReport, setDeleteReport] = useState<EmergencyReport | null>(null);

  useEffect(() => { fetchAll(); }, []);

  async function fetchAll() {
    setLoading(true);
    const { data } = await supabase
      .from('emergency_reports')
      .select('*')
      .order('created_at', { ascending: false });
    setReports(data ?? []);
    setLoading(false);
  }

  async function updateStatus(report: EmergencyReport, status: EmergencyReportStatus) {
    if (!officer) return;
    await supabase.from('emergency_reports').update({
      status,
      responded_by: officer.id,
      responded_by_name: officer.name,
      updated_at: new Date().toISOString(),
    }).eq('id', report.id);

    if (status !== 'pending') {
      await supabase.from('audit_logs').insert({
        action: `EMERGENCY_${status.toUpperCase()}`,
        target_type: 'emergency_report',
        target_id: report.id,
        performed_by: officer.id,
        performed_by_name: officer.name,
        details: { report_type: report.report_type, location: report.location },
      });
    }

    setReports((prev) => prev.map((r) => r.id === report.id ? { ...r, status, responded_by_name: officer.name } : r));
    if (viewReport?.id === report.id) setViewReport({ ...viewReport, status, responded_by_name: officer.name });
  }

  async function handleDelete() {
    if (!deleteReport || !officer) return;
    await supabase.from('emergency_reports').delete().eq('id', deleteReport.id);
    await supabase.from('audit_logs').insert({
      action: 'DELETE_EMERGENCY_REPORT',
      target_type: 'emergency_report',
      target_id: deleteReport.id,
      performed_by: officer.id,
      performed_by_name: officer.name,
      details: { discord_username: deleteReport.discord_username, type: deleteReport.report_type },
    });
    setDeleteReport(null);
    await fetchAll();
  }

  const filtered = reports.filter((r) => filterStatus === 'all' || r.status === filterStatus);
  const pendingCount = reports.filter((r) => r.status === 'pending').length;

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString('th-TH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const timeAgo = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'เมื่อสักครู่';
    if (mins < 60) return `${mins} นาทีที่แล้ว`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} ชม.ที่แล้ว`;
    return `${Math.floor(hrs / 24)} วันที่แล้ว`;
  };

  return (
    <div>
      <PageHeader
        icon={<Siren size={26} />}
        title="ระบบแจ้งเหตุฉุกเฉิน"
        subtitle="รับเรื่องและจัดการเหตุฉุกเฉินจากประชาชน"
        actions={pendingCount > 0 && (
          <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
            <span className="text-red-400 text-sm font-semibold">{pendingCount} เหตุรอดำเนินการ</span>
          </div>
        )}
      />

      <div className="card p-4 mb-6 relative">
        <span className="ph-corner ph-corner-tl" aria-hidden />
        <span className="ph-corner ph-corner-br" aria-hidden />
        <div className="flex gap-2">
          {(['all', 'pending', 'responding', 'resolved', 'dismissed'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                filterStatus === s ? 'bg-amber-500 text-navy-900' : 'btn-secondary'
              }`}
            >
              {s === 'all' ? 'ทั้งหมด' : EMERGENCY_STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => <div key={i} className="card p-5 animate-pulse h-48" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card p-16 text-center">
          <Siren size={40} className="text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400">ไม่มีเหตุการณ์ในขณะนี้</p>
        </div>
      ) : (
        <div className="table-panel">
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((report) => (
            <div
              key={report.id}
              className={`card overflow-hidden ${
                report.status === 'pending' ? 'border-red-500/30' : ''
              }`}
            >
              {report.image_url && (
                <div className="w-full h-32 overflow-hidden bg-navy-900 cursor-pointer" onClick={() => setViewReport(report)}>
                  <img src={report.image_url} alt="evidence" className="w-full h-full object-cover hover:scale-105 transition-transform" />
                </div>
              )}
              <div className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                      report.status === 'pending' ? 'bg-red-500/15 text-red-400' : 'bg-blue-900/40 text-blue-400'
                    }`}>
                      {TYPE_ICONS[report.report_type]}
                    </div>
                    <div>
                      <div className="text-white text-sm font-semibold">{EMERGENCY_TYPE_LABELS[report.report_type]}</div>
                      <div className="text-gray-500 text-xs">{timeAgo(report.created_at)}</div>
                    </div>
                  </div>
                  <Badge variant={STATUS_BADGE[report.status]}>
                    {EMERGENCY_STATUS_LABELS[report.status]}
                  </Badge>
                </div>

                <div className="space-y-1.5 mb-3">
                  <div className="flex items-start gap-1.5 text-xs text-gray-400">
                    <MapPin size={12} className="text-amber-400 flex-shrink-0 mt-0.5" />
                    <span className="truncate">{report.location}</span>
                  </div>
                  <div className="flex items-start gap-1.5 text-xs text-gray-400">
                    <User size={12} className="text-gray-500 flex-shrink-0 mt-0.5" />
                    <span>{report.discord_username}</span>
                  </div>
                </div>

                <p className="text-gray-400 text-xs line-clamp-2 mb-3">{report.details}</p>

                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setViewReport(report)}
                    className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-blue-500/15 text-blue-400 border border-blue-500/20 hover:bg-blue-500/25 transition-colors text-xs font-medium"
                  >
                    <Eye size={13} /> ดู
                  </button>
                  {report.status === 'pending' && (
                    <button
                      onClick={() => updateStatus(report, 'responding')}
                      className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-amber-500/15 text-amber-400 border border-amber-500/20 hover:bg-amber-500/25 transition-colors text-xs font-medium"
                    >
                      <Loader2 size={13} /> รับเรื่อง
                    </button>
                  )}
                  {report.status === 'responding' && (
                    <button
                      onClick={() => updateStatus(report, 'resolved')}
                      className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/25 transition-colors text-xs font-medium"
                    >
                      <CheckCircle2 size={13} /> เสร็จสิ้น
                    </button>
                  )}
                  {report.status !== 'dismissed' && report.status !== 'resolved' && (
                    <button
                      onClick={() => updateStatus(report, 'dismissed')}
                      className="px-2 py-1.5 rounded-lg bg-gray-500/15 text-gray-400 border border-gray-500/20 hover:bg-gray-500/25 transition-colors text-xs"
                      title="ยกเลิก"
                    >
                      <XCircle size={13} />
                    </button>
                  )}
                  {isCommissioner && (
                    <button
                      onClick={() => setDeleteReport(report)}
                      className="px-2 py-1.5 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors text-xs"
                      title="ลบ"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>
            </div>
            ))}
          </div>
        </div>
      )}

      {viewReport && (
        <Modal title={`เหตุ: ${EMERGENCY_TYPE_LABELS[viewReport.report_type]}`} onClose={() => setViewReport(null)} size="lg">
          <div className="space-y-4">
            {viewReport.image_url && (
              <div className="rounded-lg overflow-hidden border border-blue-900/50 bg-navy-900">
                <img src={viewReport.image_url} alt="evidence" className="w-full max-h-80 object-contain" />
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-xs text-gray-500 mb-1">ผู้แจ้ง</div>
                <div className="text-white text-sm flex items-center gap-1.5">
                  <User size={14} className="text-amber-400" /> {viewReport.discord_username}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500 mb-1">เวลาที่แจ้ง</div>
                <div className="text-white text-sm flex items-center gap-1.5">
                  <Clock size={14} className="text-amber-400" /> {formatDate(viewReport.created_at)}
                </div>
              </div>
              <div className="col-span-2">
                <div className="text-xs text-gray-500 mb-1">สถานที่</div>
                <div className="text-white text-sm flex items-center gap-1.5">
                  <MapPin size={14} className="text-red-400" /> {viewReport.location}
                </div>
              </div>
              <div className="col-span-2">
                <div className="text-xs text-gray-500 mb-1">รายละเอียด</div>
                <div className="text-gray-300 text-sm whitespace-pre-wrap break-words bg-navy-900/50 rounded-lg p-3">{viewReport.details}</div>
              </div>
              <div className="col-span-2">
                <div className="text-xs text-gray-500 mb-1">สถานะ</div>
                <Badge variant={STATUS_BADGE[viewReport.status]}>
                  {EMERGENCY_STATUS_LABELS[viewReport.status]}
                </Badge>
                {viewReport.responded_by_name && (
                  <span className="ml-2 text-xs text-gray-500">ดูแลโดย {viewReport.responded_by_name}</span>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-2 pt-3 border-t border-amber-500/15">
              {viewReport.status === 'pending' && (
                <button onClick={() => updateStatus(viewReport, 'responding')} className="btn-primary flex items-center gap-2">
                  <Loader2 size={15} /> รับเรื่องและเข้าช่วยเหลือ
                </button>
              )}
              {viewReport.status === 'responding' && (
                <button onClick={() => updateStatus(viewReport, 'resolved')} className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
                  <CheckCircle2 size={15} /> ทำการเสร็จสิ้น
                </button>
              )}
              {viewReport.status !== 'dismissed' && viewReport.status !== 'resolved' && (
                <button onClick={() => updateStatus(viewReport, 'dismissed')} className="btn-secondary flex items-center gap-2">
                  <XCircle size={15} /> ยกเลิกเรื่อง
                </button>
              )}
              {isCommissioner && (
                <button
                  onClick={() => { setDeleteReport(viewReport); setViewReport(null); }}
                  className="btn-danger flex items-center gap-2 ml-auto"
                >
                  <Trash2 size={15} /> ลบ
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}

      {deleteReport && (
        <ConfirmDialog
          title="ลบเรื่องแจ้งเหตุ"
          message={`ต้องการลบเรื่องแจ้งเหตุ "${EMERGENCY_TYPE_LABELS[deleteReport.report_type]}" ที่ ${deleteReport.location} ใช่หรือไม่?`}
          confirmLabel="ลบ"
          danger
          onConfirm={handleDelete}
          onCancel={() => setDeleteReport(null)}
        />
      )}
    </div>
  );
}
