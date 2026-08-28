import { useEffect, useMemo, useState } from 'react';
import { Users, Search, Shield, Briefcase, Wrench, Zap, TrafficCone, AlertCircle, X, Clock, DollarSign, Calendar } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { Officer, Department, DEPARTMENT_LABELS, RANK_LABELS, DutyLog, ServiceRecord } from '../../lib/types';
import { FadeIn, Stagger, StaggerItem, Skeleton } from '../../components/animations';
import { Modal } from '../../components/Modal';

const RANK_ORDER: Record<string, number> = {
  commissioner: 1,
  inspector: 2,
  officer: 3,
};

const RANK_COLORS: Record<string, { text: string; bg: string; border: string; glow: string }> = {
  commissioner: {
    text: 'text-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/40',
    glow: 'shadow-amber-500/20',
  },
  inspector: {
    text: 'text-blue-400',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/40',
    glow: 'shadow-blue-500/20',
  },
  officer: {
    text: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/40',
    glow: 'shadow-emerald-500/20',
  },
};

const DEPARTMENT_ICONS: Record<Department, React.ReactNode> = {
  civil_maintenance: <Wrench size={14} />,
  vehicle_rescue: <Wrench size={14} />,
  electrical: <Zap size={14} />,
  traffic_management: <TrafficCone size={14} />,
  emergency_assistance: <AlertCircle size={14} />,
};

const DEPARTMENT_ORDER: Department[] = [
  'civil_maintenance',
  'vehicle_rescue',
  'electrical',
  'traffic_management',
  'emergency_assistance',
];

export function PersonnelPage() {
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedOfficer, setSelectedOfficer] = useState<Officer | null>(null);

  useEffect(() => {
    supabase
      .from('officers')
      .select('*')
      .eq('status', 'active')
      .order('name')
      .then(({ data }: { data: Record<string, unknown>[] | null }) => {
        setOfficers((data as unknown as Officer[]) ?? []);
        setLoading(false);
      });
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return officers
      .filter((o) => {
        if (!q) return true;
        return (
          o.name.toLowerCase().includes(q) ||
          (RANK_LABELS[o.rank] ?? o.rank).toLowerCase().includes(q) ||
          (DEPARTMENT_LABELS[o.department] ?? o.department).toLowerCase().includes(q)
        );
      })
      .sort((a, b) => (RANK_ORDER[a.rank] ?? 99) - (RANK_ORDER[b.rank] ?? 99) || a.name.localeCompare(b.name, 'th'));
  }, [officers, search]);

  const groupedByDept = useMemo(() => {
    const map: Record<string, Officer[]> = {};
    for (const o of filtered) {
      if (!map[o.department]) map[o.department] = [];
      map[o.department].push(o);
    }
    return map;
  }, [filtered]);

  const onDutyCount = officers.filter((o) => o.is_on_duty).length;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10">
      {/* Header */}
      <FadeIn className="text-center mb-8">
        <div className="inline-flex w-16 h-16 bg-amber-500/10 border-2 border-amber-500/30 rounded-2xl items-center justify-center mb-4 anim-float">
          <Users size={30} className="text-amber-400" />
        </div>
        <h1 className="text-3xl md:text-4xl font-black text-white mb-2 tracking-tight">
          ทำเนียบบุคลากร
        </h1>
        <p className="text-gray-400 text-sm max-w-2xl mx-auto">
          รายชื่อเจ้าหน้าที่กรมขนส่ง Bit Cities — Department of Transportation
        </p>
        {!loading && (
          <div className="inline-flex items-center gap-3 mt-4 text-xs text-gray-500">
            <span>ทั้งหมด <span className="text-amber-400 font-bold">{officers.length}</span> คน</span>
            <span className="text-blue-900">•</span>
            <span className="text-emerald-400">กำลังปฏิบัติหน้าที่ {onDutyCount} คน</span>
          </div>
        )}
      </FadeIn>

      {/* Search */}
      <FadeIn delay={0.05} className="mb-8">
        <div className="card p-4 flex items-center gap-3 hover-lift max-w-2xl mx-auto">
          <Search size={18} className="text-gray-500 flex-shrink-0" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ค้นหาชื่อ, ตำแหน่ง, แผนก..."
            className="flex-1 bg-transparent border-none outline-none text-white placeholder-gray-500 text-sm"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="text-xs text-gray-500 hover:text-white"
            >
              ล้าง
            </button>
          )}
        </div>
      </FadeIn>

      {/* Content */}
      {loading ? (
        <FadeIn>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
              <div key={i} className="card p-4 space-y-3">
                <Skeleton variant="circle" width={64} height={64} className="mx-auto" />
                <Skeleton variant="text" className="mx-auto" width="70%" />
                <Skeleton variant="text" className="mx-auto" width="50%" height={10} />
              </div>
            ))}
          </div>
        </FadeIn>
      ) : filtered.length === 0 ? (
        <FadeIn>
          <div className="card p-12 text-center">
            <div className="inline-flex w-14 h-14 bg-navy-700 border border-blue-900/40 rounded-2xl items-center justify-center mx-auto mb-3">
              <Search size={26} className="text-gray-500" />
            </div>
            <p className="text-white font-semibold mb-1">
              {search ? 'ไม่พบบุคลากรที่ค้นหา' : 'ยังไม่มีข้อมูลบุคลากร'}
            </p>
            <p className="text-gray-400 text-sm">
              {search ? 'ลองเปลี่ยนคำค้นหา' : 'หัวหน้ากรมสามารถเพิ่มเจ้าหน้าที่ได้ที่เมนู "จัดการเจ้าหน้าที่"'}
            </p>
          </div>
        </FadeIn>
      ) : (
        <div className="space-y-10">
          {DEPARTMENT_ORDER.map((dept) => {
            const list = groupedByDept[dept];
            if (!list || list.length === 0) return null;
            return (
              <DepartmentSection
                key={dept}
                dept={dept}
                officers={list}
                onSelect={setSelectedOfficer}
              />
            );
          })}
        </div>
      )}

      {!loading && officers.length > 0 && (
        <FadeIn delay={0.2} className="mt-10 text-center text-xs text-gray-500">
          <p>ข้อมูลอัปเดตจากระบบ — กรมขนส่ง Bit Cities</p>
        </FadeIn>
      )}

      {selectedOfficer && (
        <OfficerDetailModal
          officer={selectedOfficer}
          onClose={() => setSelectedOfficer(null)}
        />
      )}
    </div>
  );
}

function DepartmentSection({
  dept,
  officers,
  onSelect,
}: {
  dept: Department;
  officers: Officer[];
  onSelect: (o: Officer) => void;
}) {
  const color = RANK_COLORS[officers[0].rank] ?? RANK_COLORS.officer;
  return (
    <section>
      <FadeIn className="flex items-center gap-3 mb-4">
        <div className={`w-10 h-10 rounded-xl ${color.bg} border ${color.border} flex items-center justify-center ${color.text}`}>
          {DEPARTMENT_ICONS[dept]}
        </div>
        <div>
          <h2 className={`text-lg font-bold ${color.text}`}>
            {DEPARTMENT_LABELS[dept] ?? dept}
          </h2>
          <p className="text-xs text-gray-500">{officers.length} คน</p>
        </div>
        <div className="flex-1 h-px bg-gradient-to-r from-blue-900/50 to-transparent ml-2" />
      </FadeIn>
      <Stagger className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {officers.map((o) => (
          <StaggerItem key={o.id}>
            <PersonnelCard officer={o} onClick={() => onSelect(o)} />
          </StaggerItem>
        ))}
      </Stagger>
    </section>
  );
}

function PersonnelCard({ officer, onClick }: { officer: Officer; onClick: () => void }) {
  const color = RANK_COLORS[officer.rank] ?? RANK_COLORS.officer;
  const isCommissioner = officer.rank === 'commissioner';

  return (
    <button
      onClick={onClick}
      className={`relative w-full rounded-2xl overflow-hidden border-2 text-left group transition-all hover-lift ${
        isCommissioner ? `border-amber-500/40 shadow-lg ${color.glow}` : 'border-blue-900/40 hover:border-amber-500/30'
      }`}
      style={{ aspectRatio: '3 / 4.5' }}
    >
      {/* Background image */}
      <div className="absolute inset-0 bg-navy-800">
        {officer.photo_url ? (
          <img
            src={officer.photo_url}
            alt={officer.name}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-navy-700 to-navy-900">
            <span className={`text-6xl font-black opacity-30 ${color.text}`}>
              {officer.name.charAt(0).toUpperCase()}
            </span>
          </div>
        )}
      </div>

      {/* Top gradient (subtle) */}
      <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/40 to-transparent pointer-events-none" />

      {/* Bottom gradient (info area) */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-navy-900 via-navy-900/95 to-transparent pt-12 pb-3 px-3">
        <div className="flex items-center gap-1.5 mb-1">
          <div className={`w-1.5 h-1.5 rounded-full ${officer.is_on_duty ? 'bg-emerald-400 anim-pulse' : 'bg-gray-500'}`} />
          <span className={`text-[10px] font-semibold ${officer.is_on_duty ? 'text-emerald-400' : 'text-gray-500'}`}>
            {officer.is_on_duty ? 'กำลังปฏิบัติหน้าที่' : 'ว่าง'}
          </span>
        </div>
        <h3 className="text-white text-sm font-bold truncate mb-0.5 drop-shadow-lg">{officer.name}</h3>
        <div className={`inline-flex items-center gap-1 ${color.text} text-[10px] font-semibold`}>
          {RANK_LABELS[officer.rank] ?? officer.rank}
        </div>
        <p className="text-gray-300 text-[10px] truncate mt-0.5 drop-shadow">
          {DEPARTMENT_LABELS[officer.department] ?? officer.department}
        </p>
      </div>

      {/* Commissioner crown bar */}
      {isCommissioner && (
        <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-transparent via-amber-500 to-transparent" />
      )}
    </button>
  );
}

function OfficerDetailModal({ officer, onClose }: { officer: Officer; onClose: () => void }) {
  const [dutyLogs, setDutyLogs] = useState<DutyLog[]>([]);
  const [services, setServices] = useState<ServiceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const color = RANK_COLORS[officer.rank] ?? RANK_COLORS.officer;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const [dutyRes, serviceRes] = await Promise.all([
        supabase
          .from('duty_logs')
          .select('*')
          .eq('officer_id', officer.id)
          .is('deleted_at', null)
          .order('clock_in', { ascending: false })
          .limit(5),
        supabase
          .from('service_records')
          .select('*')
          .eq('officer_id', officer.id)
          .order('created_at', { ascending: false })
          .limit(5),
      ]);
      if (cancelled) return;
      setDutyLogs((dutyRes.data as unknown as DutyLog[]) ?? []);
      setServices((serviceRes.data as unknown as ServiceRecord[]) ?? []);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [officer.id]);

  const totalDutyMinutes = dutyLogs.reduce((sum, d) => sum + (d.duration_minutes ?? 0), 0);
  const totalDutyHours = (totalDutyMinutes / 60).toFixed(1);
  const totalServiceAmount = services.reduce((sum, s) => sum + (s.amount ?? 0), 0);

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleString('th-TH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  return (
    <Modal title="" onClose={onClose} size="lg">
      <div className="space-y-4">
        {/* Hero */}
        <div className="relative -mt-6 -mx-6 h-48 overflow-hidden">
          {officer.photo_url ? (
            <img src={officer.photo_url} alt={officer.name} className="w-full h-full object-cover" />
          ) : (
            <div className={`w-full h-full bg-gradient-to-br from-navy-700 to-navy-900 flex items-center justify-center`}>
              <span className={`text-8xl font-black opacity-20 ${color.text}`}>
                {officer.name.charAt(0).toUpperCase()}
              </span>
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-navy-900 via-navy-900/60 to-transparent" />
          <button
            onClick={onClose}
            className="absolute top-3 right-3 w-8 h-8 bg-navy-900/70 hover:bg-navy-800 border border-blue-900/50 rounded-lg flex items-center justify-center text-white transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-1">
          <div className="flex items-center gap-2 mb-1">
            <div className={`w-2 h-2 rounded-full ${officer.is_on_duty ? 'bg-emerald-400 anim-pulse' : 'bg-gray-500'}`} />
            <span className={`text-xs font-semibold ${officer.is_on_duty ? 'text-emerald-400' : 'text-gray-500'}`}>
              {officer.is_on_duty ? 'กำลังปฏิบัติหน้าที่' : 'ว่าง'}
            </span>
          </div>
          <h2 className="text-2xl font-bold text-white mb-1">{officer.name}</h2>
          <div className={`inline-flex items-center gap-1.5 ${color.bg} ${color.text} border ${color.border} px-2.5 py-1 rounded-full text-xs font-semibold`}>
            {officer.rank === 'commissioner' && <Shield size={12} />}
            {officer.rank === 'inspector' && <Briefcase size={12} />}
            {RANK_LABELS[officer.rank] ?? officer.rank}
          </div>
          <p className="text-gray-300 text-sm mt-2 flex items-center gap-1.5">
            {DEPARTMENT_ICONS[officer.department]}
            {DEPARTMENT_LABELS[officer.department] ?? officer.department}
          </p>
        </div>

        {/* Quick stats */}
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-navy-700/50 border border-blue-900/40 rounded-lg p-3 text-center">
            <Clock size={16} className="text-amber-400 mx-auto mb-1" />
            <div className="text-lg font-bold text-white">{totalDutyHours}</div>
            <div className="text-[10px] text-gray-500">ชม. ปฏิบัติหน้าที่</div>
          </div>
          <div className="bg-navy-700/50 border border-blue-900/40 rounded-lg p-3 text-center">
            <Calendar size={16} className="text-blue-400 mx-auto mb-1" />
            <div className="text-lg font-bold text-white">{dutyLogs.length}</div>
            <div className="text-[10px] text-gray-500">เวรล่าสุด</div>
          </div>
          <div className="bg-navy-700/50 border border-blue-900/40 rounded-lg p-3 text-center">
            <DollarSign size={16} className="text-emerald-400 mx-auto mb-1" />
            <div className="text-lg font-bold text-white">{totalServiceAmount.toLocaleString()}</div>
            <div className="text-[10px] text-gray-500">ค่าบริการรวม</div>
          </div>
        </div>

        {/* Recent duty logs */}
        <div>
          <h3 className="text-sm font-semibold text-white mb-2 flex items-center gap-1.5">
            <Clock size={14} className="text-amber-400" />
            เวรที่เข้าล่าสุด
          </h3>
          {loading ? (
            <div className="space-y-2">
              <Skeleton variant="text" className="w-full" height={32} />
              <Skeleton variant="text" className="w-full" height={32} />
            </div>
          ) : dutyLogs.length === 0 ? (
            <div className="text-xs text-gray-500 text-center py-4 bg-navy-700/30 rounded-lg">ยังไม่มีประวัติการเข้าเวร</div>
          ) : (
            <div className="space-y-1.5">
              {dutyLogs.map((d) => (
                <div key={d.id} className="bg-navy-700/50 border border-blue-900/40 rounded-lg px-3 py-2 flex items-center justify-between">
                  <div className="text-xs text-white">{formatDate(d.clock_in)}</div>
                  <div className="text-[10px] text-gray-400">
                    {d.clock_out
                      ? `${(d.duration_minutes ?? 0)} นาที`
                      : <span className="text-emerald-400 font-semibold">กำลังเข้าเวร</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent services */}
        <div>
          <h3 className="text-sm font-semibold text-white mb-2 flex items-center gap-1.5">
            <DollarSign size={14} className="text-emerald-400" />
            บริการที่ทำล่าสุด
          </h3>
          {loading ? (
            <div className="space-y-2">
              <Skeleton variant="text" className="w-full" height={32} />
              <Skeleton variant="text" className="w-full" height={32} />
            </div>
          ) : services.length === 0 ? (
            <div className="text-xs text-gray-500 text-center py-4 bg-navy-700/30 rounded-lg">ยังไม่มีประวัติการให้บริการ</div>
          ) : (
            <div className="space-y-1.5">
              {services.map((s) => (
                <div key={s.id} className="bg-navy-700/50 border border-blue-900/40 rounded-lg px-3 py-2 flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-white truncate">{s.service_name}</div>
                    <div className="text-[10px] text-gray-500">{formatDate(s.created_at)}</div>
                  </div>
                  <div className="text-right ml-2 flex-shrink-0">
                    <div className="text-xs font-semibold text-amber-400">฿{s.amount.toLocaleString()}</div>
                    <div className={`text-[10px] ${s.status === 'paid' ? 'text-emerald-400' : 'text-red-400'}`}>
                      {s.status === 'paid' ? 'ชำระแล้ว' : 'ค้างชำระ'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
