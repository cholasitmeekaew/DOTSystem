import { useRef } from 'react';
import html2canvas from 'html2canvas';
import { Truck, Download, Phone, Power } from 'lucide-react';
import { Officer, RANK_LABELS, DEPARTMENT_LABELS } from '../lib/types';
import { useAuth } from '../lib/AuthContext';

interface Props {
  officer: Officer;
  clockInTime?: string | null;
  showActions?: boolean;
  onForceCheckout?: (officer: Officer) => void;
  onContact?: (officer: Officer) => void;
}

export function IdCard({ officer, clockInTime, showActions, onForceCheckout, onContact }: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  const { isCommissioner } = useAuth();

  async function handleDownload() {
    if (!cardRef.current) return;
    const canvas = await html2canvas(cardRef.current, {
      backgroundColor: null,
      scale: 2,
      useCORS: true,
    });
    const link = document.createElement('a');
    link.download = `dot-id-card-${officer.username}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }

  const formatTime = (iso: string | null | undefined) => {
    if (!iso) return '-';
    return new Date(iso).toLocaleString('th-TH', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div
        ref={cardRef}
        className="relative w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl"
        style={{ aspectRatio: '3 / 4' }}
      >
        {/* Background */}
        <div className="absolute inset-0 bg-gradient-to-br from-navy-800 via-navy-900 to-navy-950" />
        <div className="absolute inset-0 opacity-5" style={{
          backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 20px, rgba(245,158,11,0.5) 20px, rgba(245,158,11,0.5) 21px)',
        }} />
        {/* Top accent bar */}
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-amber-500" />

        <div className="relative p-5 h-full flex flex-col">
          {/* Header */}
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 bg-amber-500 rounded-lg flex items-center justify-center flex-shrink-0">
              <Truck size={16} className="text-navy-900" />
            </div>
            <div>
              <div className="text-[8px] text-amber-500 font-semibold tracking-widest">BIT CITIES DOT</div>
              <div className="text-xs font-bold text-white leading-tight">บัตรประจำตัวเจ้าหน้าที่</div>
            </div>
          </div>

          {/* Photo */}
          <div className="flex justify-center mb-4">
            <div className="w-28 h-28 rounded-xl overflow-hidden border-2 border-amber-500/40 bg-navy-700 flex items-center justify-center">
              {officer.photo_url ? (
                <img src={officer.photo_url} alt={officer.name} className="w-full h-full object-cover" crossOrigin="anonymous" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-amber-500/40 text-3xl font-bold">
                  {officer.name.charAt(0).toUpperCase()}
                </div>
              )}
            </div>
          </div>

          {/* Info */}
          <div className="space-y-2 flex-1">
            <div>
              <div className="text-[8px] text-gray-500 uppercase tracking-wider">ชื่อ-นามสกุล</div>
              <div className="text-white font-bold text-sm">{officer.name}</div>
            </div>
            <div className="flex gap-4">
              <div className="flex-1">
                <div className="text-[8px] text-gray-500 uppercase tracking-wider">ตำแหน่ง</div>
                <div className="text-amber-400 font-semibold text-xs">{RANK_LABELS[officer.rank] ?? officer.rank}</div>
              </div>
              <div className="flex-1">
                <div className="text-[8px] text-gray-500 uppercase tracking-wider">ฝ่าย</div>
                <div className="text-blue-400 font-semibold text-xs">{DEPARTMENT_LABELS[officer.department] ?? officer.department}</div>
              </div>
            </div>
            <div>
              <div className="text-[8px] text-gray-500 uppercase tracking-wider">เวลาเข้าเวร</div>
              <div className="text-emerald-400 font-semibold text-xs">{formatTime(clockInTime)}</div>
            </div>
          </div>

          {/* Footer */}
          <div className="mt-auto pt-3 border-t border-amber-500/20 flex items-center justify-between">
            <div className="text-[8px] text-gray-500 font-mono">ID: {officer.username}</div>
            <div className="text-[8px] text-gray-500">OFFICIAL ID CARD</div>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      {showActions && (
        <div className="flex gap-2">
          <button
            onClick={handleDownload}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-blue-500/15 text-blue-400 border border-blue-500/20 hover:bg-blue-500/25 transition-colors text-xs font-medium"
          >
            <Download size={14} /> ดาวน์โหลดบัตร
          </button>
          {onContact && (
            <button
              onClick={() => onContact(officer)}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/25 transition-colors text-xs font-medium"
            >
              <Phone size={14} /> ติดต่อด่วน
            </button>
          )}
          {isCommissioner && officer.is_on_duty && onForceCheckout && (
            <button
              onClick={() => onForceCheckout(officer)}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-red-500/15 text-red-400 border border-red-500/20 hover:bg-red-500/25 transition-colors text-xs font-medium"
            >
              <Power size={14} /> บังคับออกเวร
            </button>
          )}
        </div>
      )}
    </div>
  );
}
