/* =============================================================
 * ReportDetailModal.tsx
 * -------------------------------------------------------------
 * Modal ดูรายละเอียดรายงานปฏิบัติงาน — ใช้ component เดียวกันทุกที่
 *
 *   • หน้าอนุมัติรายงาน (หัวหน้ากรม)          → OperationsPage
 *   • ประวัติรายงานการปฏิบัติงานทั้งหมด (Admin) → WorkReportsAdminPage
 *
 * เดิมสองที่เป็นคนละ UI คนละชุด ทำให้ผู้ดูแลต้องสลับความคุ้นเคย
 *
 * ระยะห่าง: ทุกกล่องมี padding ชั้นใน + leading ที่อ่านสบาย
 * ไม่ให้ตัวอักษรชิดขอบ และเว้นระหว่างหัวข้อกับเนื้อหาชัดเจน
 * ============================================================= */

import { useState } from 'react';
import { Clock, XCircle, CheckCircle2, ExternalLink, Trash2, X } from 'lucide-react';
import { Modal } from './Modal';
import { Badge } from './Badge';
import { dutyCategoryLabel } from '../lib/api/workReportsAdmin';
import type { WorkReport, WorkReportCase, WorkReportStatus } from '../lib/types';

/* ---------- ตัวช่วยแปลงค่า ---------- */

const CASE_STATUS_LABELS: Record<string, string> = {
  completed: 'เสร็จสิ้น',
  in_progress: 'กำลังดำเนินการ',
  transferred: 'ส่งต่อ',
};

export function caseStatusLabel(value: string | null | undefined): string {
  return value ? (CASE_STATUS_LABELS[value] ?? value) : '-';
}

/** รูปแบบเดียวกับหน้าอนุมัติรายงาน — วันที่แบบสั้น ไม่ยาวจนล้นกล่อง */
const fmtDateTime = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const date = d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  return `${date} ${time}`;
};

/* ---------- Banner สถานะรายงาน ---------- */

export function ReportStatusBanner({ report }: { report: WorkReport }) {
  const status = (report.status ?? 'pending') as WorkReportStatus;

  const config = {
    pending: {
      label: 'รอตรวจ',
      chip: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
      dot: 'bg-amber-400',
      Icon: Clock,
      hint: 'รายงานนี้ยังไม่ได้รับการตรวจ',
    },
    approved: {
      label: 'อนุมัติแล้ว',
      chip: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
      dot: 'bg-emerald-400',
      Icon: CheckCircle2,
      hint: 'รายงานนี้ได้รับการอนุมัติแล้ว',
    },
    rejected: {
      label: 'ไม่อนุมัติ',
      chip: 'bg-red-500/15 text-red-300 border-red-500/40',
      dot: 'bg-red-400',
      Icon: XCircle,
      hint: 'รายงานนี้ไม่ผ่านการตรวจ',
    },
  }[status];

  const Icon = config.Icon;
  const reviewed = Boolean(report.reviewed_by_name);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-x-4 gap-y-3
                    rounded-xl border border-blue-900/40 bg-navy-900/50 px-5 py-4">
      <div className="flex items-start gap-3 min-w-0">
        <span className={`p-2 rounded-lg flex-shrink-0 ${config.chip.split(' ')[0]}`}>
          <Icon size={16} className={config.chip.split(' ')[1]} />
        </span>
        <div className="min-w-0">
          <div className="text-[11px] text-gray-500 leading-relaxed">สถานะรายงาน</div>
          <div className="flex items-center gap-2.5 mt-1.5 flex-wrap">
            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-semibold ${config.chip}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`} />
              {config.label}
            </span>
            {reviewed && (
              <span className="text-[11px] text-gray-400 leading-relaxed">
                ตรวจโดย: <span className="text-gray-200">{report.reviewed_by_name}</span>
                {report.reviewed_at && <> เมื่อ {fmtDateTime(report.reviewed_at)}</>}
              </span>
            )}
          </div>
          {!reviewed && (
            <p className="text-[11px] text-gray-500 mt-1.5 leading-relaxed">{config.hint}</p>
          )}
        </div>
      </div>

      {reviewed && (
        <div className="text-left sm:text-right flex-shrink-0">
          <div className="text-[11px] text-gray-500 leading-relaxed">คะแนนที่ได้รับ</div>
          <div className={`text-lg font-bold mt-1 leading-none ${
            (report.reviewed_points ?? 0) > 0 ? 'text-emerald-400' : 'text-gray-500'
          }`}>
            {(report.reviewed_points ?? 0) > 0 ? `+${report.reviewed_points}` : '—'}
          </div>
        </div>
      )}

      {/* เหตุผลที่ไม่อนุมัติ — กินเต็มแถว */}
      {status === 'rejected' && (
        <div className="sm:col-span-full flex items-start gap-2.5 rounded-lg
                        border border-red-500/30 bg-red-500/10 px-4 py-3">
          <XCircle size={15} className="text-red-400 mt-0.5 flex-shrink-0" />
          <div className="min-w-0">
            <div className="text-[11px] font-semibold text-red-300 leading-relaxed">เหตุผลที่ไม่อนุมัติ</div>
            <div className={`text-xs mt-1.5 leading-relaxed whitespace-pre-wrap ${
              report.review_note ? 'text-gray-200' : 'text-red-300/70 italic'
            }`}>
              {report.review_note || 'ไม่ได้ระบุเหตุผล'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- Modal ---------- */

export function ReportDetailModal({
  report, cases, onClose, onDelete, deleting, onOpenCitizen, onChangeCaseStatus,
}: {
  report: WorkReport;
  cases: WorkReportCase[];
  onClose: () => void;
  /** ถ้าไม่ส่ง = โหมดดูอย่างเดียว (ไม่แสดงปุ่มลบ) */
  onDelete?: () => void;
  deleting?: boolean;
  onOpenCitizen?: (caseItem: WorkReportCase) => void;
  /** เปลี่ยนสถานะเคสย่อย — ถ้าไม่ส่ง = ดูอย่างเดียว (ใครก็ตามที่ส่งจะเป็นผู้แก้) */
  onChangeCaseStatus?: (caseId: string, next: 'completed' | 'in_progress' | 'transferred') => void;
}) {
  const [evidence, setEvidence] = useState<string | null>(null);

  return (
    <>
      <Modal title={`รายงานของ ${report.officer_name}`} onClose={onClose} size="xl">
        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1.5 pb-1">

          {/* สถานะรวมของรายงาน */}
          <ReportStatusBanner report={report} />

          {/* การ์ดสรุป 3 ช่อง */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-navy-900/50 border border-blue-900/40 rounded-xl px-4 py-3.5">
              <div className="text-[11px] text-gray-500 leading-relaxed">วันที่ส่งรายงาน</div>
              <div className="text-sm text-gray-200 mt-1.5 leading-relaxed">{fmtDateTime(report.created_at)}</div>
            </div>
            <div className="bg-navy-900/50 border border-blue-900/40 rounded-xl px-4 py-3.5">
              <div className="text-[11px] text-gray-500 leading-relaxed">หมวดงาน</div>
              <div className="text-sm text-white mt-1.5 leading-relaxed">{dutyCategoryLabel(report.duty_category)}</div>
            </div>
            <div className="bg-navy-900/50 border border-blue-900/40 rounded-xl px-4 py-3.5">
              <div className="text-[11px] text-gray-500 leading-relaxed">จำนวนเคส</div>
              <div className="text-sm font-semibold text-amber-300 mt-1.5 leading-relaxed">
                {cases.length.toLocaleString('th-TH')} เคส
              </div>
            </div>
          </div>

          {/* รายละเอียดภาพรวม */}
          {(report.summary || report.report_text) && (
            <div className="bg-navy-900/50 rounded-xl border border-blue-900/40 px-4 py-3.5">
              <div className="text-[11px] text-gray-500 leading-relaxed">รายละเอียดภาพรวม</div>
              <div className="text-sm text-gray-200 mt-2 leading-relaxed whitespace-pre-wrap">
                {report.summary || report.report_text}
              </div>
            </div>
          )}

          {/* การ์ดเคส */}
          <div className="space-y-3">
            {cases.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-6">ไม่มีเคสในรายงานนี้</p>
            ) : cases.map((item, idx) => (
              <div key={item.id} className="bg-navy-900/50 rounded-xl border border-blue-900/40 px-4 py-4 space-y-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="text-[11px] font-bold text-amber-400 leading-relaxed">เคส #{idx + 1}</div>
                    <div className="text-white text-sm font-semibold mt-1 leading-relaxed">
                      {item.case_name || item.case_type || 'ไม่ระบุชื่อเคส'}
                    </div>
                  </div>
                  <Badge variant={
                    item.case_status === 'completed' ? 'success'
                      : item.case_status === 'transferred' ? 'warning' : 'neutral'
                  }>
                    {caseStatusLabel(item.case_status)}
                  </Badge>
                </div>

                {/* เปลี่ยนสถานะเคส — เกณฑ์ PPS ผูก +5 คะแนนกับการเปลี่ยนเป็น "เสร็จสิ้น" */}
                {onChangeCaseStatus && (
                  <div className="flex flex-wrap gap-1.5 mt-2.5 pt-2.5 border-t border-blue-900/30">
                    {(['completed', 'in_progress', 'transferred'] as const).map((st) => (
                      <button
                        key={st}
                        type="button"
                        onClick={() => onChangeCaseStatus(item.id, st)}
                        disabled={item.case_status === st}
                        className={`px-2 py-1 rounded-lg text-[11px] font-medium border transition-colors disabled:opacity-50 disabled:cursor-default ${
                          item.case_status === st
                            ? 'border-amber-500/50 bg-amber-500/10 text-amber-300'
                            : 'border-blue-900/50 text-gray-400 hover:border-amber-500/30 hover:text-white'
                        }`}
                        title={st === 'completed' ? 'ปิดเคสสำเร็จ → ได้ +5 คะแนน' : undefined}
                      >
                        {caseStatusLabel(st)}
                      </button>
                    ))}
                  </div>
                )}

                {item.citizen_username && (
                  <button
                    type="button"
                    onClick={() => (onOpenCitizen ? onOpenCitizen(item) : setEvidence(null))}
                    disabled={!onOpenCitizen}
                    className="inline-flex items-center gap-1.5 text-xs text-blue-300 bg-blue-500/10
                               border border-blue-500/20 rounded-lg px-2.5 py-1.5 leading-relaxed
                               hover:bg-blue-500/20 transition-colors disabled:opacity-70 disabled:cursor-default"
                  >
                    <ExternalLink size={12} />
                    ประชาชนที่เกี่ยวข้อง: {item.citizen_username}
                  </button>
                )}

                {item.details && (
                  <p className="text-sm text-gray-200 leading-relaxed whitespace-pre-wrap">{item.details}</p>
                )}

                {item.evidence_url && (
                  <button type="button" onClick={() => setEvidence(item.evidence_url)} className="block group">
                    <img
                      src={item.evidence_url}
                      alt="ภาพหลักฐาน"
                      loading="lazy"
                      className="max-h-56 max-w-full rounded-lg border border-blue-900/50 object-contain
                                 bg-navy-900 group-hover:opacity-90 transition-opacity"
                    />
                    <span className="block text-[11px] text-emerald-400 group-hover:underline mt-2 leading-relaxed">
                      คลิกเพื่อดูภาพขนาดเต็ม
                    </span>
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* ปุ่ม action: ลบซ้าย · ปิดขวา */}
        <div className="flex items-center gap-2.5 mt-5 pt-4 border-t border-blue-900/40">
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              disabled={deleting}
              className="btn-danger flex items-center gap-1.5 text-xs disabled:opacity-50"
            >
              <Trash2 size={14} />
              ลบรายงานนี้
            </button>
          )}
          <button type="button" onClick={onClose} className="btn-secondary px-5 py-2 ml-auto text-sm">
            ปิด
          </button>
        </div>
      </Modal>

      {/* รูปขนาดเต็ม */}
      {evidence && (
        <Modal title="รูปภาพหลักฐาน" onClose={() => setEvidence(null)} size="lg">
          <div className="flex justify-center">
            <img
              src={evidence}
              alt="ภาพหลักฐาน"
              className="max-w-full max-h-[70vh] rounded-lg object-contain"
            />
          </div>
        </Modal>
      )}
    </>
  );
}
