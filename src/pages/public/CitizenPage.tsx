import { ReactNode, useEffect, useRef, useState } from 'react';
import {
  Search, User, AlertCircle, Clock, DollarSign, MessageSquare, Siren,
  FileText, CheckCircle2, Car, MapPin,
  Bike, Truck as TowTruck, CarFront, Lock, CreditCard, Shield, Hash, MessageCircle,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import {
  ServiceRecord, Vehicle, License, Complaint,
  VEHICLE_TYPE_LABELS, EMERGENCY_TYPE_LABELS,
  EMERGENCY_STATUS_LABELS, EmergencyReport,
} from '../../lib/types';
import { Badge } from '../../components/Badge';
import { Modal } from '../../components/Modal';
import {
  FadeIn, Stagger, StaggerItem, TabTransition, Skeleton, CountUp,
} from '../../components/animations';

type Tab = 'overview' | 'vehicles' | 'licenses' | 'fees' | 'emergency' | 'complaints';
type SearchType = 'roblox' | 'discord' | 'plate';

const IMPOUND_BADGE = 'inline-flex items-center gap-1 bg-red-500/20 text-red-400 border border-red-500/30 px-2 py-0.5 rounded-full text-xs font-medium';
const OK_BADGE = 'inline-flex items-center gap-1 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full text-xs font-medium';

interface SearchTypeOption {
  id: SearchType;
  label: string;
  description: string;
  icon: ReactNode;
  placeholder: string;
  badge?: string;
}

const SEARCH_TYPE_OPTIONS: SearchTypeOption[] = [
  {
    id: 'discord',
    label: 'Discord Username',
    description: 'ค้นหาด้วยชื่อ Discord',
    icon: <MessageCircle size={18} />,
    placeholder: 'ระบุ Discord Username...',
  },
  {
    id: 'roblox',
    label: 'Roblox Username',
    description: 'ค้นหาด้วยชื่อในเกม',
    icon: <User size={18} />,
    placeholder: 'ระบุ Roblox Username...',
  },
  {
    id: 'plate',
    label: 'ทะเบียนรถ',
    description: 'ตรวจสอบสถานะการถูกยึด',
    icon: <Car size={18} />,
    placeholder: 'เช่น กข1234 หรือ 1กข1234',
    badge: 'แนะนำ',
  },
];

export function CitizenPage() {
  const [tab, setTab] = useState<Tab>('overview');
  const [searchType, setSearchType] = useState<SearchType>('discord');
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [licenses, setLicenses] = useState<License[]>([]);
  const [feeRecords, setFeeRecords] = useState<ServiceRecord[]>([]);
  const [emergencyReports, setEmergencyReports] = useState<EmergencyReport[]>([]);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [viewImage, setViewImage] = useState<string | null>(null);

  const tabs: { id: Tab; label: string; icon: ReactNode }[] = [
    { id: 'overview', label: 'ข้อมูลรวม', icon: <User size={16} /> },
    { id: 'vehicles', label: 'ยานพาหนะ', icon: <Car size={16} /> },
    { id: 'licenses', label: 'ใบอนุญาต', icon: <CreditCard size={16} /> },
    { id: 'fees', label: 'ค่าบริการ', icon: <DollarSign size={16} /> },
    { id: 'emergency', label: 'ประวัติแจ้งเหตุ', icon: <Siren size={16} /> },
    { id: 'complaints', label: 'ประวัติร้องเรียน', icon: <MessageSquare size={16} /> },
  ];

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setSearched(false);
    setVehicles([]);
    setLicenses([]);
    setFeeRecords([]);
    setEmergencyReports([]);
    setComplaints([]);

    const q = query.trim();

    if (searchType === 'plate') {
      const normalized = q.toUpperCase().replace(/\s+/g, '');
      const { data: vData } = await supabase
        .from('vehicles')
        .select('*')
        .eq('license_plate', normalized)
        .order('created_at', { ascending: false });
      setVehicles(vData ?? []);
      // auto-switch ไปแท็บยานพาหนะเมื่อค้นด้วย plate
      setTab('vehicles');

      if (vData && vData.length > 0 && vData[0].owner_name) {
        await loadAssociatedData(vData[0].owner_name, 'discord_username');
      }
    } else {
      const field = searchType === 'roblox' ? 'roblox_username' : 'discord_username';
      await loadAssociatedData(q, field);
    }

    setSearched(true);
    setLoading(false);
  }

  async function loadAssociatedData(username: string, field: string) {
    const [vRes, lRes, fRes, eRes, cRes] = await Promise.all([
      supabase.from('vehicles').select('*').ilike('owner_name', '%' + username + '%').order('created_at', { ascending: false }),
      supabase.from('licenses').select('*').ilike(field, '%' + username + '%').order('created_at', { ascending: false }),
      supabase.from('service_records').select('*').ilike(field, '%' + username + '%').order('service_date', { ascending: false }),
      supabase.from('emergency_reports').select('*').ilike('discord_username', '%' + username + '%').order('created_at', { ascending: false }),
      supabase.from('complaints').select('*').or('discord_username.ilike.%' + username + '%,complainant_name.ilike.%' + username + '%').order('created_at', { ascending: false }),
    ]);

    setVehicles(vRes.data ?? []);
    setLicenses(lRes.data ?? []);
    setFeeRecords(fRes.data ?? []);
    setEmergencyReports(eRes.data ?? []);
    setComplaints(cRes.data ?? []);
  }

  const totalUnpaid = feeRecords.filter((r) => r.status === 'unpaid').reduce((s, r) => s + Number(r.amount), 0);
  const totalPaid = feeRecords.filter((r) => r.status === 'paid').reduce((s, r) => s + Number(r.amount), 0);
  const impoundedCount = vehicles.filter((v) => v.is_impounded).length;
  const activeLicenses = licenses.filter((l) => l.status === 'active').length;
  const pendingEmergency = emergencyReports.filter((e) => e.status === 'pending' || e.status === 'responding').length;
  const pendingComplaints = complaints.filter((c) => c.status === 'pending' || c.status === 'investigating').length;

  const formatDate = (iso: string | null) => {
    if (!iso) return '-';
    return new Date(iso).toLocaleString('th-TH', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };
  const formatMoney = (n: number) => Number(n).toLocaleString('th-TH') + ' BC';

  const vehicleIcon = (type: string) => {
    switch (type) {
      case 'motorcycle': return <Bike size={16} />;
      case 'pickup': return <TowTruck size={16} />;
      case 'truck': return <TowTruck size={16} />;
      case 'van': return <CarFront size={16} />;
      default: return <Car size={16} />;
    }
  };

  const currentSearchOption = SEARCH_TYPE_OPTIONS.find((o) => o.id === searchType)!;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      {/* Hero */}
      <FadeIn className="text-center mb-8">
        <div className="inline-flex w-16 h-16 bg-blue-900/50 border border-blue-700/50 rounded-2xl items-center justify-center mb-4 anim-float">
          <User size={30} className="text-blue-400" />
        </div>
        <h1 className="text-3xl font-bold text-white mb-2">ระบบประชาชน</h1>
        <p className="text-gray-400 text-sm max-w-2xl mx-auto">
          ศูนย์ค้นหาข้อมูลประชาชน — ตรวจสอบสถานะรถ ใบขับขี่ ค่าบริการ และประวัติการแจ้งเหตุได้ในที่เดียว
        </p>
      </FadeIn>

      {/* Search Section */}
      <div className="-mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-navy-900/95 border-b border-blue-900/30 mb-4 anim-slideInDown rounded-xl">
        {/* Search Type — Visual Cards */}
        <Stagger className="grid grid-cols-3 gap-2 mb-3" delayChildren={0}>
          {SEARCH_TYPE_OPTIONS.map((opt) => {
            const active = searchType === opt.id;
            return (
              <StaggerItem key={opt.id}>
                <button
                  type="button"
                  onClick={() => { setSearchType(opt.id); setSearched(false); }}
                  className={`w-full relative p-3 rounded-xl border-2 text-left transition-all duration-200 btn-ripple ${
                    active
                      ? 'border-amber-500 bg-amber-500/10 shadow-lg shadow-amber-500/10'
                      : 'border-blue-900/40 bg-navy-800 hover:border-amber-500/40 hover:bg-navy-700'
                  }`}
                >
                  {opt.badge && (
                    <span className="absolute -top-1.5 -right-1.5 bg-amber-500 text-navy-900 text-[9px] font-bold px-1.5 py-0.5 rounded-full shadow-md">
                      {opt.badge}
                    </span>
                  )}
                  <div className="flex items-center gap-2">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                      active ? 'bg-amber-500/20 text-amber-400' : 'bg-navy-700 text-gray-400'
                    }`}>
                      {opt.icon}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className={`text-xs font-semibold ${active ? 'text-amber-400' : 'text-white'}`}>{opt.label}</div>
                      <div className="text-[10px] text-gray-500 truncate">{opt.description}</div>
                    </div>
                  </div>
                </button>
              </StaggerItem>
            );
          })}
        </Stagger>

        {/* Search Bar */}
        <form onSubmit={handleSearch} className="flex gap-2">
          <div className="flex-1 relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              className={'input-field pl-9 ' + (searchType === 'plate' ? 'uppercase' : '')}
              placeholder={currentSearchOption.placeholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <button type="submit" disabled={loading} className="btn-primary px-5 flex-shrink-0 btn-ripple">
            {loading ? 'กำลังค้นหา...' : 'ค้นหา'}
          </button>
        </form>
      </div>

      {/* Tabs */}
      <div className="-mx-4 sm:-mx-6 px-4 sm:px-6 py-2 bg-navy-900/95 border-b border-blue-900/30 mb-6 anim-fadeIn rounded-xl">
        <div className="flex gap-1 overflow-x-auto scrollbar-thin pb-1">
          {tabs.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`relative flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                  active
                    ? 'bg-amber-500 text-navy-900 shadow-md shadow-amber-500/20'
                    : 'bg-navy-800/60 text-gray-400 hover:text-white border border-blue-900/40 hover:bg-navy-700'
                }`}
              >
                {t.icon}
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      {!searched && !loading && (
        <FadeIn>
          <div className="card p-12 text-center">
            <div className="inline-flex w-16 h-16 bg-navy-700 border border-blue-900/40 rounded-2xl items-center justify-center mb-4 anim-float">
              <Search size={28} className="text-gray-500" />
            </div>
            <p className="text-white font-semibold mb-1">เริ่มค้นหาข้อมูล</p>
            <p className="text-gray-400 text-sm max-w-md mx-auto">
              เลือกประเภทการค้นหา แล้วกรอกข้อมูลที่ต้องการตรวจสอบ — ระบบจะแสดงข้อมูลทั้งหมดที่เกี่ยวข้อง
            </p>
          </div>
        </FadeIn>
      )}

      {loading && (
        <FadeIn>
          <div className="card p-6 space-y-4">
            <div className="flex items-center gap-3 mb-2">
              <div className="inline-block w-5 h-5 border-2 border-amber-500 border-t-transparent rounded-full anim-spin3d" />
              <span className="text-gray-300 text-sm">กำลังค้นหาข้อมูล...</span>
            </div>
            <Skeleton variant="card" height={80} />
            <Skeleton variant="card" height={120} />
            <Skeleton variant="card" height={120} />
          </div>
        </FadeIn>
      )}

      {searched && !loading && (
        <TabTransition tabId={tab}>
          {tab === 'overview' && (
            <OverviewTab
              vehicles={vehicles}
              licenses={licenses}
              feeRecords={feeRecords}
              emergencyReports={emergencyReports}
              complaints={complaints}
              totalUnpaid={totalUnpaid}
              totalPaid={totalPaid}
              impoundedCount={impoundedCount}
              activeLicenses={activeLicenses}
              pendingEmergency={pendingEmergency}
              pendingComplaints={pendingComplaints}
              formatMoney={formatMoney}
            />
          )}

          {tab === 'vehicles' && (
            <VehiclesTab
              vehicles={vehicles}
              feeRecords={feeRecords}
              searched={searched}
              vehicleIcon={vehicleIcon}
              formatDate={formatDate}
              formatMoney={formatMoney}
              onViewImage={setViewImage}
            />
          )}

          {tab === 'licenses' && (
            <LicensesTab licenses={licenses} formatDate={formatDate} />
          )}

          {tab === 'fees' && (
            <FeesTab feeRecords={feeRecords} totalUnpaid={totalUnpaid} totalPaid={totalPaid} formatDate={formatDate} formatMoney={formatMoney} onViewImage={setViewImage} />
          )}

          {tab === 'emergency' && (
            <EmergencyHistoryTab emergencyReports={emergencyReports} formatDate={formatDate} />
          )}

          {tab === 'complaints' && (
            <ComplaintsHistoryTab complaints={complaints} formatDate={formatDate} />
          )}
        </TabTransition>
      )}

      {viewImage && (
        <Modal title="ดูรูปภาพ" onClose={() => setViewImage(null)} size="lg">
          <div className="flex justify-center"><img src={viewImage} alt="รูปภาพ" className="max-w-full max-h-[60vh] rounded-lg object-contain" /></div>
        </Modal>
      )}
    </div>
  );
}

/* =================== Overview Tab =================== */
function OverviewTab({
  vehicles, licenses, feeRecords, emergencyReports, complaints,
  totalUnpaid, totalPaid, impoundedCount, activeLicenses, pendingEmergency, pendingComplaints, formatMoney,
}: {
  vehicles: Vehicle[];
  licenses: License[];
  feeRecords: ServiceRecord[];
  emergencyReports: EmergencyReport[];
  complaints: Complaint[];
  totalUnpaid: number;
  totalPaid: number;
  impoundedCount: number;
  activeLicenses: number;
  pendingEmergency: number;
  pendingComplaints: number;
  formatMoney: (n: number) => string;
}) {
  const hasData = vehicles.length > 0 || licenses.length > 0 || feeRecords.length > 0 || emergencyReports.length > 0 || complaints.length > 0;

  if (!hasData) {
    return (
      <FadeIn>
        <div className="card p-12 text-center">
          <div className="inline-flex w-16 h-16 bg-navy-700 border border-blue-900/40 rounded-2xl items-center justify-center mx-auto mb-4">
            <Search size={28} className="text-gray-500" />
          </div>
          <p className="text-white font-semibold mb-1">ไม่พบข้อมูล</p>
          <p className="text-gray-400 text-sm">ไม่พบข้อมูลสำหรับการค้นหานี้ในระบบ</p>
        </div>
      </FadeIn>
    );
  }

  return (
    <div className="space-y-6">
      <Stagger className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StaggerItem>
          <SummaryCard icon={<Car size={18} />} label="ยานพาหนะทั้งหมด" value={vehicles.length} subValue={'ถูกยึด ' + impoundedCount} variant={impoundedCount > 0 ? 'danger' : 'neutral'} />
        </StaggerItem>
        <StaggerItem>
          <SummaryCard icon={<CreditCard size={18} />} label="ใบอนุญาต" value={licenses.length} subValue={'ใช้งานได้ ' + activeLicenses} variant="info" />
        </StaggerItem>
        <StaggerItem>
          <SummaryCard icon={<DollarSign size={18} />} label="ยอดค้างชำระ" value={formatMoney(totalUnpaid)} subValue={'ชำระแล้ว ' + formatMoney(totalPaid)} variant={totalUnpaid > 0 ? 'danger' : 'success'} isMoney />
        </StaggerItem>
        <StaggerItem>
          <SummaryCard icon={<Siren size={18} />} label="แจ้งเหตุ" value={emergencyReports.length} subValue={'รอดำเนินการ ' + pendingEmergency} variant="warning" />
        </StaggerItem>
      </Stagger>

      {totalUnpaid > 0 && (
        <FadeIn>
          <div className="flex items-start gap-3 bg-red-500/10 border border-red-500/30 rounded-xl p-4 hover-lift">
            <AlertCircle size={18} className="text-red-400 mt-0.5 flex-shrink-0" />
            <div>
              <div className="text-red-400 font-semibold text-sm">มียอดค้างชำระ {formatMoney(totalUnpaid)}</div>
              <div className="text-gray-400 text-xs mt-0.5">กรุณาติดต่อเจ้าหน้าที่ DOT เพื่อชำระค่าบริการ</div>
            </div>
          </div>
        </FadeIn>
      )}

      {impoundedCount > 0 && (
        <FadeIn delay={0.1}>
          <div className="flex items-start gap-3 bg-red-500/10 border border-red-500/30 rounded-xl p-4 hover-lift">
            <Lock size={18} className="text-red-400 mt-0.5 flex-shrink-0" />
            <div>
              <div className="text-red-400 font-semibold text-sm">มียานพาหนะถูกยึด {impoundedCount} คัน</div>
              <div className="text-gray-400 text-xs mt-0.5">กรุณาติดต่อเจ้าหน้าที่ DOT เพื่อทำการปลดยึด</div>
            </div>
          </div>
        </FadeIn>
      )}

      {complaints.length > 0 && (
        <FadeIn delay={0.15}>
          <div className="card p-5 hover-lift">
            <h3 className="text-white font-semibold text-sm mb-3 flex items-center gap-2">
              <MessageSquare size={16} className="text-amber-400" /> สรุปเรื่องร้องเรียน
            </h3>
            <div className="flex items-center gap-4 text-sm">
              <span className="text-gray-400">ทั้งหมด: <span className="text-white font-semibold">{complaints.length}</span></span>
              <span className="text-gray-400">รอดำเนินการ: <span className="text-amber-400 font-semibold">{pendingComplaints}</span></span>
            </div>
          </div>
        </FadeIn>
      )}
    </div>
  );
}

function SummaryCard({ icon, label, value, subValue, variant, isMoney }: {
  icon: ReactNode;
  label: string;
  value: string | number;
  subValue: string;
  variant: 'danger' | 'success' | 'info' | 'warning' | 'neutral';
  isMoney?: boolean;
}) {
  const colorMap: Record<string, string> = {
    danger: 'text-red-400 bg-red-500/10 border-red-500/20',
    success: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    info: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
    warning: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
    neutral: 'text-gray-400 bg-navy-700 border-blue-900/40',
  };
  return (
    <div className={`card p-4 border hover-lift ${colorMap[variant]}`}>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-xs text-gray-400">{label}</span>
      </div>
      <div className="text-xl font-bold text-white">
        {isMoney ? (
          <CountUp value={typeof value === 'string' ? parseInt(value.replace(/[^\d]/g, ''), 10) || 0 : value} suffix=" BC" />
        ) : (
          <CountUp value={typeof value === 'number' ? value : 0} />
        )}
      </div>
      <div className="text-xs text-gray-500 mt-0.5">{subValue}</div>
    </div>
  );
}

/* =================== Vehicles Tab (รวม Vehicle Check) =================== */
function VehiclesTab({ vehicles, feeRecords, searched, vehicleIcon, formatDate, formatMoney, onViewImage }: {
  vehicles: Vehicle[];
  feeRecords: ServiceRecord[];
  searched: boolean;
  vehicleIcon: (type: string) => ReactNode;
  formatDate: (iso: string | null) => string;
  formatMoney: (n: number) => string;
  onViewImage: (url: string) => void;
}) {
  if (!searched) {
    return (
      <FadeIn>
        <div className="card p-10 text-center">
          <div className="inline-flex w-14 h-14 bg-amber-500/10 border-2 border-amber-500/30 rounded-2xl items-center justify-center mx-auto mb-4 anim-float">
            <Car size={26} className="text-amber-400" />
          </div>
          <p className="text-white font-semibold mb-1">เลือก "ทะเบียนรถ" เพื่อตรวจสอบ</p>
          <p className="text-gray-400 text-sm max-w-md mx-auto">
            กรอกทะเบียนรถ เช่น <span className="text-amber-400 font-mono">กข1234</span> เพื่อตรวจสอบสถานะการถูกยึด ประวัติค่าบริการ และข้อมูลเจ้าของ
          </p>
        </div>
      </FadeIn>
    );
  }

  if (vehicles.length === 0) {
    return (
      <FadeIn>
        <div className="card p-10 text-center">
          <div className="w-14 h-14 bg-gray-500/10 border-2 border-gray-500/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Search size={28} className="text-gray-500" />
          </div>
          <h3 className="text-white font-semibold mb-1">ไม่พบข้อมูลยานพาหนะ</h3>
          <p className="text-gray-400 text-sm">ไม่พบข้อมูลในระบบ อาจไม่ได้ถูกยึดหรือยังไม่ได้ลงทะเบียน</p>
        </div>
      </FadeIn>
    );
  }

  return (
    <Stagger className="space-y-4">
      {vehicles.map((v) => {
        const cardCls = v.is_impounded
          ? 'card p-5 border-red-500/30 relative overflow-hidden'
          : 'card p-5 border-emerald-500/20 relative overflow-hidden';
        const iconCls = v.is_impounded
          ? 'w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 bg-red-500/10 border-2 border-red-500/30'
          : 'w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 bg-emerald-500/10 border-2 border-emerald-500/30';
        return (
          <StaggerItem key={v.id}>
            <div className={`${cardCls} hover-lift`}>
              {v.is_impounded && (
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-red-500 to-transparent glow-pulse-red" />
              )}
              {!v.is_impounded && (
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-emerald-500 to-transparent" />
              )}
              <div className="flex items-start gap-4">
                <div className={iconCls}>
                  {v.is_impounded
                    ? <Lock size={26} className="text-red-400" />
                    : <CheckCircle2 size={26} className="text-emerald-400" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h3 className="text-xl font-bold text-white tracking-wider">{v.license_plate}</h3>
                    {v.is_impounded
                      ? <span className={IMPOUND_BADGE}><div className="w-1.5 h-1.5 bg-red-400 rounded-full anim-pulse" /> ถูกยึด</span>
                      : <span className={OK_BADGE}><div className="w-1.5 h-1.5 bg-emerald-400 rounded-full" /> ปกติ</span>}
                  </div>

                  <p className={`text-sm mb-3 font-medium ${v.is_impounded ? 'text-red-400' : 'text-emerald-400'}`}>
                    {v.is_impounded
                      ? '⚠️ ยานพาหนะคันนี้ถูกยึดอยู่ในขณะนี้ กรุณาติดต่อเจ้าหน้าที่ DOT'
                      : '✅ ยานพาหนะคันนี้ไม่ได้ถูกยึด สามารถใช้งานได้ปกติ'}
                  </p>

                  {v.is_impounded && v.image_url && (
                    <button onClick={() => onViewImage(v.image_url!)} className="block w-full mb-4 rounded-lg overflow-hidden border border-red-500/20 bg-navy-900 hover:opacity-80 transition-opacity">
                      <img src={v.image_url!} alt="ยานพาหนะที่ถูกยึด" className="w-full max-h-56 object-contain" />
                    </button>
                  )}

                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 pt-3 border-t border-blue-900/30">
                    <DetailItem icon={vehicleIcon(v.vehicle_type)} label="ประเภท" value={VEHICLE_TYPE_LABELS[v.vehicle_type]} />
                    <DetailItem icon={<User size={14} />} label="เจ้าของ" value={v.owner_name || '-'} />
                    <DetailItem icon={<Car size={14} />} label="สี" value={v.color || '-'} />
                    {v.brand_model && <DetailItem icon={<Hash size={14} />} label="ยี่ห้อ/รุ่น" value={v.brand_model} />}
                    {v.is_impounded && (
                      <>
                        <DetailItem icon={<MapPin size={14} />} label="สถานที่เก็บ" value={v.impound_location || '-'} />
                        <DetailItem icon={<FileText size={14} />} label="เหตุผลที่ยึด" value={v.impound_reason || '-'} />
                        <DetailItem icon={<Clock size={14} />} label="เวลาที่ยึด" value={formatDate(v.impounded_at)} />
                        <DetailItem icon={<User size={14} />} label="เจ้าหน้าที่ที่ยึด" value={v.impounded_by_name || '-'} />
                      </>
                    )}
                    {v.released_at && (
                      <>
                        <DetailItem icon={<Clock size={14} />} label="เวลาที่ปล่อย" value={formatDate(v.released_at)} />
                        <DetailItem icon={<User size={14} />} label="เจ้าหน้าที่ที่ปล่อย" value={v.released_by_name || '-'} />
                      </>
                    )}
                  </div>

                  {v.is_impounded && feeRecords.filter((f) => f.service_type === 'impound').length > 0 && (
                    <div className="mt-4 pt-3 border-t border-blue-900/30">
                      <h4 className="text-amber-400 text-xs font-semibold mb-2 flex items-center gap-1.5">
                        <DollarSign size={12} /> ประวัติค่าบริการที่เกี่ยวข้อง
                      </h4>
                      <div className="space-y-2">
                        {feeRecords.filter((f) => f.service_type === 'impound').map((fee) => (
                          <div key={fee.id} className="flex items-center justify-between bg-navy-900/50 rounded-lg px-3 py-2 hover:bg-navy-900 transition-colors">
                            <div>
                              <span className="text-white text-sm font-medium">{fee.service_name}</span>
                              <span className="text-gray-500 text-xs ml-2">{formatDate(fee.service_date)}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className={'text-sm font-bold ' + (fee.status === 'paid' ? 'text-emerald-400' : 'text-red-400')}>{formatMoney(Number(fee.amount))}</span>
                              <Badge variant={fee.status === 'paid' ? 'success' : 'danger'}>{fee.status === 'paid' ? 'ชำระแล้ว' : 'ค้างชำระ'}</Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </StaggerItem>
        );
      })}
    </Stagger>
  );
}

/* =================== Licenses Tab =================== */
function LicensesTab({ licenses, formatDate }: { licenses: License[]; formatDate: (iso: string | null) => string }) {
  if (licenses.length === 0) {
    return (
      <FadeIn>
        <div className="card p-12 text-center">
          <CreditCard size={36} className="text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">ไม่พบข้อมูลใบอนุญาต</p>
        </div>
      </FadeIn>
    );
  }

  const isExpired = (iso: string | null) => iso && new Date(iso) < new Date();
  const isExpiringSoon = (iso: string | null) => {
    if (!iso) return false;
    const diff = new Date(iso).getTime() - Date.now();
    return diff > 0 && diff < 30 * 24 * 60 * 60 * 1000;
  };

  return (
    <Stagger className="space-y-4">
      {licenses.map((lic) => {
        const expired = isExpired(lic.expiry_date);
        const expiringSoon = isExpiringSoon(lic.expiry_date);
        const cardCls = expired ? 'card p-5 border-red-500/30' : expiringSoon ? 'card p-5 border-amber-500/30' : 'card p-5 border-emerald-500/20';
        const iconCls = expired
          ? 'w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 bg-red-500/10 border-2 border-red-500/30'
          : expiringSoon
          ? 'w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 bg-amber-500/10 border-2 border-amber-500/30'
          : 'w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 bg-emerald-500/10 border-2 border-emerald-500/30';
        const iconColor = expired ? 'text-red-400' : expiringSoon ? 'text-amber-400' : 'text-emerald-400';
        return (
          <StaggerItem key={lic.id}>
            <div className={`${cardCls} hover-lift`}>
              <div className="flex items-start gap-4">
                <div className={iconCls}>
                  <CreditCard size={26} className={iconColor} />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h3 className="text-lg font-bold text-white">{lic.license_type === 'driver' ? 'ใบขับขี่' : lic.license_type}</h3>
                    {lic.license_number && <span className="text-gray-500 text-sm">#{lic.license_number}</span>}
                    {expired ? <Badge variant="danger">หมดอายุ</Badge> : expiringSoon ? <Badge variant="warning">ใกล้หมดอายุ</Badge> : <Badge variant="success">ใช้งานได้</Badge>}
                  </div>
                  <div className="grid grid-cols-2 gap-4 pt-3 border-t border-blue-900/30">
                    <DetailItem icon={<User size={14} />} label="Discord" value={lic.discord_username || '-'} />
                    <DetailItem icon={<User size={14} />} label="Roblox" value={lic.roblox_username} />
                    <DetailItem icon={<Clock size={14} />} label="วันออกบัตร" value={formatDate(lic.issue_date)} />
                    <DetailItem icon={<Clock size={14} />} label="วันหมดอายุ" value={formatDate(lic.expiry_date)} />
                    {lic.issued_by_name && <DetailItem icon={<Shield size={14} />} label="ออกโดย" value={lic.issued_by_name} />}
                    {lic.notes && <DetailItem icon={<FileText size={14} />} label="หมายเหตุ" value={lic.notes} />}
                  </div>
                </div>
              </div>
            </div>
          </StaggerItem>
        );
      })}
    </Stagger>
  );
}

/* =================== Fees Tab =================== */
function FeesTab({ feeRecords, totalUnpaid, totalPaid, formatDate, formatMoney, onViewImage }: {
  feeRecords: ServiceRecord[];
  totalUnpaid: number;
  totalPaid: number;
  formatDate: (iso: string | null) => string;
  formatMoney: (n: number) => string;
  onViewImage: (url: string) => void;
}) {
  if (feeRecords.length === 0) {
    return (
      <FadeIn>
        <div className="card p-12 text-center">
          <DollarSign size={36} className="text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">ไม่พบประวัติค่าบริการ</p>
        </div>
      </FadeIn>
    );
  }

  return (
    <div className="space-y-4">
      <Stagger className="grid grid-cols-3 gap-3">
        <StaggerItem>
          <div className="card p-4 text-center hover-lift">
            <div className="text-2xl font-bold text-white mb-1"><CountUp value={feeRecords.length} /></div>
            <div className="text-xs text-gray-400">รายการทั้งหมด</div>
          </div>
        </StaggerItem>
        <StaggerItem>
          <div className="card p-4 text-center hover-lift">
            <div className="text-2xl font-bold text-red-400 mb-1"><CountUp value={totalUnpaid} suffix=" BC" /></div>
            <div className="text-xs text-gray-400">ยอดค้างชำระ</div>
          </div>
        </StaggerItem>
        <StaggerItem>
          <div className="card p-4 text-center hover-lift">
            <div className="text-2xl font-bold text-emerald-400 mb-1"><CountUp value={totalPaid} suffix=" BC" /></div>
            <div className="text-xs text-gray-400">ชำระแล้ว</div>
          </div>
        </StaggerItem>
      </Stagger>

      {totalUnpaid > 0 && (
        <FadeIn>
          <div className="flex items-start gap-3 bg-red-500/10 border border-red-500/30 rounded-xl p-4 hover-lift">
            <AlertCircle size={18} className="text-red-400 mt-0.5 flex-shrink-0" />
            <div><div className="text-red-400 font-semibold text-sm">มียอดค้างชำระ</div><div className="text-gray-400 text-xs mt-0.5">กรุณาติดต่อเจ้าหน้าที่ DOT เพื่อชำระค่าบริการ</div></div>
          </div>
        </FadeIn>
      )}

      <Stagger className="space-y-3">
        {feeRecords.map((rec) => {
          const cardCls = rec.service_type === 'impound' ? 'card p-4 border-red-500/20' : 'card p-4';
          return (
            <StaggerItem key={rec.id}>
              <div className={`${cardCls} hover-lift`}>
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Badge variant={rec.service_type === 'impound' ? 'danger' : 'info'}>
                      {rec.service_type === 'impound' ? <><Lock size={10} /> ยึด</> : 'ปกติ'}
                    </Badge>
                    <span className="text-white text-sm font-medium">{rec.service_name}</span>
                  </div>
                  <span className={'text-sm font-bold ' + (rec.status === 'paid' ? 'text-emerald-400' : 'text-red-400')}>{formatMoney(Number(rec.amount))}</span>
                </div>
                {rec.evidence_url && (
                  <button onClick={() => onViewImage(rec.evidence_url!)} className="block w-full mb-2 rounded-lg overflow-hidden border border-blue-900/40 bg-navy-900 hover:opacity-80 transition-opacity">
                    <img src={rec.evidence_url!} alt="หลักฐาน" className="w-full max-h-40 object-cover" />
                  </button>
                )}
                <div className="flex items-center justify-between text-xs text-gray-500">
                  <span>{formatDate(rec.service_date)} · เจ้าหน้าที่: {rec.officer_name}</span>
                  <Badge variant={rec.status === 'paid' ? 'success' : 'danger'}>{rec.status === 'paid' ? 'ชำระแล้ว' : 'ค้างชำระ'}</Badge>
                </div>
                {rec.notes && <div className="mt-2 text-xs text-gray-500">{rec.notes}</div>}
              </div>
            </StaggerItem>
          );
        })}
      </Stagger>
    </div>
  );
}

/* =================== Emergency History Tab =================== */
function EmergencyHistoryTab({ emergencyReports, formatDate }: {
  emergencyReports: EmergencyReport[];
  formatDate: (iso: string | null) => string;
}) {
  if (emergencyReports.length === 0) {
    return (
      <FadeIn>
        <div className="card p-12 text-center">
          <Siren size={36} className="text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">ไม่พบประวัติการแจ้งเหตุ</p>
        </div>
      </FadeIn>
    );
  }

  return (
    <Stagger className="space-y-3">
      {emergencyReports.map((rep) => (
        <StaggerItem key={rep.id}>
          <div className="card p-4 hover-lift">
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-2">
                <Siren size={16} className="text-red-400" />
                <span className="text-white text-sm font-medium">{EMERGENCY_TYPE_LABELS[rep.report_type] ?? rep.report_type}</span>
              </div>
              <Badge variant={rep.status === 'resolved' ? 'success' : rep.status === 'responding' ? 'warning' : rep.status === 'dismissed' ? 'neutral' : 'danger'}>
                {EMERGENCY_STATUS_LABELS[rep.status as keyof typeof EMERGENCY_STATUS_LABELS] ?? rep.status}
              </Badge>
            </div>
            {rep.location && <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-1"><MapPin size={12} /> {rep.location}</div>}
            <div className="text-xs text-gray-500 mb-1">{rep.details}</div>
            <div className="flex items-center justify-between text-xs text-gray-500">
              <span>{formatDate(rep.created_at)}</span>
              {rep.responded_by_name && <span>เจ้าหน้าที่: {rep.responded_by_name}</span>}
            </div>
          </div>
        </StaggerItem>
      ))}
    </Stagger>
  );
}

/* =================== Complaints History Tab =================== */
function ComplaintsHistoryTab({ complaints, formatDate }: {
  complaints: Complaint[];
  formatDate: (iso: string | null) => string;
}) {
  if (complaints.length === 0) {
    return (
      <FadeIn>
        <div className="card p-12 text-center">
          <MessageSquare size={36} className="text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">ไม่พบประวัติการร้องเรียน</p>
        </div>
      </FadeIn>
    );
  }

  return (
    <Stagger className="space-y-3">
      {complaints.map((c) => (
        <StaggerItem key={c.id}>
          <div className="card p-4 hover-lift">
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-2">
                <MessageSquare size={16} className="text-amber-400" />
                <span className="text-white text-sm font-medium">{c.category || 'ร้องเรียนทั่วไป'}</span>
              </div>
              <Badge variant={c.status === 'resolved' ? 'success' : c.status === 'investigating' ? 'warning' : c.status === 'dismissed' ? 'neutral' : 'danger'}>
                {c.status === 'pending' ? 'รอดำเนินการ' : c.status === 'investigating' ? 'กำลังสอบสวน' : c.status === 'resolved' ? 'ดำเนินการแล้ว' : c.status === 'dismissed' ? 'ยกเลิก' : c.status}
              </Badge>
            </div>
            {c.officer_name && <div className="text-xs text-gray-400 mb-1">เจ้าหน้าที่ที่ร้องเรียน: {c.officer_name}</div>}
            <div className="text-xs text-gray-500 mb-1">{c.description || c.details || '-'}</div>
            <div className="text-xs text-gray-500">{formatDate(c.created_at)}</div>
          </div>
        </StaggerItem>
      ))}
    </Stagger>
  );
}

/* =================== Shared =================== */
function DetailItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-gray-500 mb-1 flex items-center gap-1"><span className="text-amber-400">{icon}</span>{label}</div>
      <div className="text-white text-sm">{value}</div>
    </div>
  );
}
