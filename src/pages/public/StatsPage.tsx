import { useEffect, useMemo, useState } from 'react';
import {
  BarChart3, Users, Car, DollarSign, CreditCard, MessageSquare, Siren,
  TrendingUp, TrendingDown, Shield, FileText, Clock, CheckCircle2,
  AlertCircle, Wrench, Zap, TrafficCone, ArrowRight, Megaphone,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import {
  Officer, ServiceRecord, Vehicle, License, Complaint, EmergencyReport,
  Announcement, DEPARTMENT_LABELS, RANK_LABELS, Department,
} from '../../lib/types';
import { FadeIn, Stagger, StaggerItem, Skeleton, CountUp } from '../../components/animations';

const DEPARTMENT_COLORS: Record<Department, { bg: string; text: string; border: string; bar: string }> = {
  civil_maintenance: { bg: 'bg-orange-500/10', text: 'text-orange-400', border: 'border-orange-500/30', bar: 'bg-orange-500' },
  vehicle_rescue: { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/30', bar: 'bg-blue-500' },
  electrical: { bg: 'bg-yellow-500/10', text: 'text-yellow-400', border: 'border-yellow-500/30', bar: 'bg-yellow-500' },
  traffic_management: { bg: 'bg-purple-500/10', text: 'text-purple-400', border: 'border-purple-500/30', bar: 'bg-purple-500' },
  emergency_assistance: { bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/30', bar: 'bg-red-500' },
};

const DEPARTMENT_ICONS: Record<Department, React.ReactNode> = {
  civil_maintenance: <Wrench size={16} />,
  vehicle_rescue: <Car size={16} />,
  electrical: <Zap size={16} />,
  traffic_management: <TrafficCone size={16} />,
  emergency_assistance: <Siren size={16} />,
};

export function StatsPage() {
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [serviceRecords, setServiceRecords] = useState<ServiceRecord[]>([]);
  const [licenses, setLicenses] = useState<License[]>([]);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [emergencyReports, setEmergencyReports] = useState<EmergencyReport[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [ranks, setRanks] = useState<Array<{ rank_key: string | null; label: string; sort_order: number }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      supabase.from('officers').select('*'),
      supabase.from('vehicles').select('*'),
      supabase.from('service_records').select('*'),
      supabase.from('licenses').select('*'),
      supabase.from('complaints').select('*'),
      supabase.from('emergency_reports').select('*'),
      supabase.from('announcements').select('*').order('created_at', { ascending: false }).limit(5),
      supabase.from('officer_ranks').select('rank_key, label, sort_order').order('sort_order'),
    ]).then(([o, v, s, l, c, e, a, r]) => {
      setOfficers((o.data as unknown as Officer[]) ?? []);
      setVehicles((v.data as unknown as Vehicle[]) ?? []);
      setServiceRecords((s.data as unknown as ServiceRecord[]) ?? []);
      setLicenses((l.data as unknown as License[]) ?? []);
      setComplaints((c.data as unknown as Complaint[]) ?? []);
      setEmergencyReports((e.data as unknown as EmergencyReport[]) ?? []);
      setAnnouncements((a.data as unknown as Announcement[]) ?? []);
      setRanks((r.data as Array<{ rank_key: string | null; label: string; sort_order: number }>) ?? []);
      setLoading(false);
    });
  }, []);

  // ===== Derived stats =====
  const activeOfficers = useMemo(() => officers.filter((o) => o.status === 'active'), [officers]);
  const onDutyOfficers = useMemo(() => officers.filter((o) => o.is_on_duty), [officers]);
  const impoundedVehicles = useMemo(() => vehicles.filter((v) => v.is_impounded), [vehicles]);

  const totalRevenue = useMemo(
    () => serviceRecords.reduce((s, r) => s + Number(r.amount), 0),
    [serviceRecords],
  );
  const paidAmount = useMemo(
    () => serviceRecords.filter((r) => r.status === 'paid').reduce((s, r) => s + Number(r.amount), 0),
    [serviceRecords],
  );
  const unpaidAmount = useMemo(
    () => serviceRecords.filter((r) => r.status === 'unpaid').reduce((s, r) => s + Number(r.amount), 0),
    [serviceRecords],
  );

  const activeLicenses = useMemo(() => licenses.filter((l) => l.status === 'active'), [licenses]);
  const expiredLicenses = useMemo(
    () => licenses.filter((l) => l.expiry_date && new Date(l.expiry_date) < new Date()),
    [licenses],
  );

  const openComplaints = useMemo(
    () => complaints.filter((c) => c.status === 'pending' || c.status === 'investigating'),
    [complaints],
  );
  const resolvedComplaints = useMemo(() => complaints.filter((c) => c.status === 'resolved'), [complaints]);

  const activeEmergencies = useMemo(
    () => emergencyReports.filter((e) => e.status === 'pending' || e.status === 'responding'),
    [emergencyReports],
  );
  const resolvedEmergencies = useMemo(
    () => emergencyReports.filter((e) => e.status === 'resolved'),
    [emergencyReports],
  );

  // ===== Department distribution =====
  const deptStats = useMemo(() => {
    const map = new Map<Department, { officers: number; onDuty: number; total: number }>();
    for (const o of officers) {
      const cur = map.get(o.department) ?? { officers: 0, onDuty: 0, total: 0 };
      cur.officers++;
      cur.total++;
      if (o.is_on_duty) cur.onDuty++;
      map.set(o.department, cur);
    }
    return Array.from(map.entries()).map(([dept, s]) => ({ dept, ...s }));
  }, [officers]);

  const maxDeptOfficers = Math.max(1, ...deptStats.map((d) => d.officers));

  // ===== Top officers (by service count) =====
  const topOfficers = useMemo(() => {
    const map = new Map<string, { name: string; count: number; dept: Department; rank: string }>();
    for (const r of serviceRecords) {
      if (!r.officer_id) continue;
      const cur = map.get(r.officer_id) ?? {
        name: r.officer_name || 'ไม่ทราบชื่อ',
        count: 0,
        dept: 'traffic_management' as Department,
        rank: 'officer',
      };
      cur.count++;
      const o = officers.find((x) => x.id === r.officer_id);
      if (o) {
        cur.dept = o.department;
        cur.rank = o.rank;
      }
      map.set(r.officer_id, cur);
    }
    return [...map.values()].sort((a, b) => b.count - a.count).slice(0, 5);
  }, [serviceRecords, officers]);

  // ===== Activity feed (mix of recent events) =====
  const activityFeed = useMemo(() => {
    const items: { type: 'emergency' | 'complaint' | 'service' | 'announcement'; at: string; data: any }[] = [];
    for (const e of emergencyReports.slice(0, 5)) {
      items.push({ type: 'emergency', at: e.created_at, data: e });
    }
    for (const c of complaints.slice(0, 5)) {
      items.push({ type: 'complaint', at: c.created_at, data: c });
    }
    for (const s of serviceRecords.slice(0, 5)) {
      items.push({ type: 'service', at: s.created_at, data: s });
    }
    for (const a of announcements.slice(0, 3)) {
      items.push({ type: 'announcement', at: a.created_at, data: a });
    }
    return items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 8);
  }, [emergencyReports, complaints, serviceRecords, announcements]);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
      {/* Header */}
      <FadeIn className="text-center mb-8">
        <div className="inline-flex w-16 h-16 bg-emerald-500/10 border-2 border-emerald-500/30 rounded-2xl items-center justify-center mb-4 anim-float">
          <BarChart3 size={30} className="text-emerald-400" />
        </div>
        <h1 className="text-3xl md:text-4xl font-black text-white mb-2 tracking-tight">
          สถิติภาพรวมหน่วยงาน
        </h1>
        <p className="text-gray-400 text-sm max-w-2xl mx-auto">
          ข้อมูลสรุปการดำเนินงานกรมขนส่ง Bit Cities — Department of Transportation
        </p>
        <p className="text-gray-600 text-xs mt-2">
          อัปเดตล่าสุด {new Date().toLocaleString('th-TH', { dateStyle: 'long', timeStyle: 'short' })}
        </p>
      </FadeIn>

      {/* Top KPI cards — 4 cards */}
      {loading ? (
        <FadeIn className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="card p-5 space-y-2">
              <Skeleton variant="text" width="60%" />
              <Skeleton variant="text" width="40%" height={28} />
            </div>
          ))}
        </FadeIn>
      ) : (
        <Stagger className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <StaggerItem>
            <KpiCard
              icon={<Users size={20} />}
              label="เจ้าหน้าที่ทั้งหมด"
              value={activeOfficers.length}
              subValue={`กำลังปฏิบัติงาน ${onDutyOfficers.length}`}
              color="emerald"
              trend={onDutyOfficers.length}
            />
          </StaggerItem>
          <StaggerItem>
            <KpiCard
              icon={<Car size={20} />}
              label="ยานพาหนะในระบบ"
              value={vehicles.length}
              subValue={`ถูกยึด ${impoundedVehicles.length}`}
              color={impoundedVehicles.length > 0 ? 'red' : 'blue'}
              trend={impoundedVehicles.length}
              trendLabel="ถูกยึด"
            />
          </StaggerItem>
          <StaggerItem>
            <KpiCard
              icon={<DollarSign size={20} />}
              label="รายได้รวม (BC)"
              value={totalRevenue}
              subValue={`ชำระแล้ว ${paidAmount.toLocaleString('th-TH')}`}
              color="amber"
              isMoney
              trend={paidAmount}
            />
          </StaggerItem>
          <StaggerItem>
            <KpiCard
              icon={<Megaphone size={20} />}
              label="ประกาศ"
              value={announcements.length}
              subValue="ประกาศล่าสุด"
              color="purple"
            />
          </StaggerItem>
        </Stagger>
      )}

      {/* Section 1: Department distribution */}
      <FadeIn delay={0.05} className="mb-6">
        <SectionHeader icon={<Shield size={18} />} title="การกระจายกำลังพลตามแผนก" subtitle="จำนวนเจ้าหน้าที่และสถานะการปฏิบัติงาน" />
        {loading ? (
          <Skeleton variant="card" height={200} />
        ) : deptStats.length === 0 ? (
          <EmptyState text="ยังไม่มีข้อมูลเจ้าหน้าที่" />
        ) : (
          <Stagger className="card p-5 space-y-3">
            {deptStats
              .sort((a, b) => b.officers - a.officers)
              .map((d) => {
                const c = DEPARTMENT_COLORS[d.dept];
                return (
                  <StaggerItem key={d.dept}>
                    <div className={`p-3 rounded-lg ${c.bg} ${c.border} border hover-lift`}>
                      <div className="flex items-center justify-between mb-2">
                        <div className={`flex items-center gap-2 ${c.text} font-semibold text-sm`}>
                          {DEPARTMENT_ICONS[d.dept]}
                          {DEPARTMENT_LABELS[d.dept] ?? d.dept}
                        </div>
                        <div className="text-right text-xs">
                          <span className={`${c.text} font-bold text-base`}>{d.officers}</span>
                          <span className="text-gray-500"> คน</span>
                          <span className="text-gray-600 mx-1">•</span>
                          <span className="text-emerald-400 font-medium">{d.onDuty}</span>
                          <span className="text-gray-500"> ปฏิบัติงาน</span>
                        </div>
                      </div>
                      <div className="w-full h-2 bg-navy-900 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${c.bar} rounded-full transition-all duration-700`}
                          style={{ width: `${(d.officers / maxDeptOfficers) * 100}%` }}
                        />
                      </div>
                    </div>
                  </StaggerItem>
                );
              })}
          </Stagger>
        )}
      </FadeIn>

      {/* Section 2: 2-column — Officers + Work Stats */}
      <div className="grid lg:grid-cols-2 gap-4 mb-6">
        {/* Officers breakdown */}
        <FadeIn delay={0.1}>
          <SectionHeader
            icon={<Users size={18} />}
            title="สถิติเจ้าหน้าที่"
            subtitle="แยกตามตำแหน่งและสถานะ"
            small
          />
          {loading ? (
            <Skeleton variant="card" height={180} />
          ) : (
            <div className="card p-5 space-y-3">
              {ranks.length > 0 ? (
                ranks.map((r) => {
                  const key = r.rank_key ?? r.label;
                  return (
                    <RankRow
                      key={key}
                      label={r.label}
                      count={activeOfficers.filter((o) => o.rank === key).length}
                      color="emerald"
                      icon="👤"
                    />
                  );
                })
              ) : (
                <>
                  <RankRow label="หัวหน้ากรม" count={activeOfficers.filter((o) => o.rank === 'commissioner').length} color="amber" icon="👑" />
                  <RankRow label="ผู้คุมสอบ" count={activeOfficers.filter((o) => o.rank === 'inspector').length} color="blue" icon="🛡️" />
                  <RankRow label="พนักงาน" count={activeOfficers.filter((o) => o.rank === 'officer').length} color="emerald" icon="👤" />
                </>
              )}
              <div className="pt-3 border-t border-blue-900/30 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-gray-400 flex items-center gap-1.5">
                    <span className="w-2 h-2 bg-emerald-400 rounded-full anim-pulse" />
                    กำลังปฏิบัติงาน
                  </span>
                  <span className="text-emerald-400 font-bold">
                    <CountUp value={onDutyOfficers.length} /> / {activeOfficers.length}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-400 flex items-center gap-1.5">
                    <span className="w-2 h-2 bg-gray-500 rounded-full" />
                    ไม่ได้ปฏิบัติงาน
                  </span>
                  <span className="text-gray-400 font-bold">
                    <CountUp value={activeOfficers.length - onDutyOfficers.length} />
                  </span>
                </div>
              </div>
            </div>
          )}
        </FadeIn>

        {/* Work stats */}
        <FadeIn delay={0.15}>
          <SectionHeader
            icon={<DollarSign size={18} />}
            title="สถิติงานบริการ"
            subtitle="ค่าบริการ ใบขับขี่ และใบสั่ง"
            small
          />
          {loading ? (
            <Skeleton variant="card" height={180} />
          ) : (
            <div className="card p-5 space-y-3 text-sm">
              <StatRow
                icon={<DollarSign size={14} />}
                label="ค่าบริการทั้งหมด"
                value={serviceRecords.length}
                subValue={`${formatMoney(totalRevenue)} BC`}
                color="amber"
              />
              <StatRow
                icon={<CheckCircle2 size={14} />}
                label="ชำระแล้ว"
                value={serviceRecords.filter((r) => r.status === 'paid').length}
                subValue={`${formatMoney(paidAmount)} BC`}
                color="emerald"
              />
              <StatRow
                icon={<AlertCircle size={14} />}
                label="ค้างชำระ"
                value={serviceRecords.filter((r) => r.status === 'unpaid').length}
                subValue={`${formatMoney(unpaidAmount)} BC`}
                color="red"
              />
              <StatRow
                icon={<CreditCard size={14} />}
                label="ใบขับขี่ (ใช้งานได้)"
                value={activeLicenses.length}
                subValue={expiredLicenses.length > 0 ? `หมดอายุ ${expiredLicenses.length} ใบ` : 'ทั้งหมดยังใช้งานได้'}
                color={expiredLicenses.length > 0 ? 'amber' : 'emerald'}
              />
              <StatRow
                icon={<MessageSquare size={14} />}
                label="เรื่องร้องเรียน (เปิดอยู่)"
                value={openComplaints.length}
                subValue={`แก้ไขแล้ว ${resolvedComplaints.length}`}
                color={openComplaints.length > 0 ? 'amber' : 'emerald'}
              />
              <StatRow
                icon={<Siren size={14} />}
                label="เหตุฉุกเฉิน (กำลังดำเนินการ)"
                value={activeEmergencies.length}
                subValue={`จัดการแล้ว ${resolvedEmergencies.length}`}
                color={activeEmergencies.length > 0 ? 'red' : 'emerald'}
              />
            </div>
          )}
        </FadeIn>
      </div>

      {/* Section 3: Top officers + Activity feed */}
      <div className="grid lg:grid-cols-2 gap-4 mb-6">
        {/* Top performers */}
        <FadeIn delay={0.2}>
          <SectionHeader
            icon={<TrendingUp size={18} />}
            title="เจ้าหน้าที่ทำงานมากที่สุด"
            subtitle="Top 5 — จากจำนวนการบันทึกค่าบริการ"
            small
          />
          {loading ? (
            <Skeleton variant="card" height={200} />
          ) : topOfficers.length === 0 ? (
            <EmptyState text="ยังไม่มีข้อมูลการบันทึกค่าบริการ" />
          ) : (
            <div className="card p-5 space-y-2.5">
              {topOfficers.map((o, i) => {
                const c = DEPARTMENT_COLORS[o.dept];
                return (
                  <div key={i} className="flex items-center gap-3 hover-lift p-2 -mx-2 rounded-lg">
                    <div
                      className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                        i === 0 ? 'bg-amber-500 text-navy-900' :
                        i === 1 ? 'bg-gray-300 text-navy-900' :
                        i === 2 ? 'bg-orange-700 text-white' :
                        'bg-navy-700 text-gray-400'
                      }`}
                    >
                      {i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-white text-sm font-semibold truncate">{o.name}</div>
                      <div className={`text-[11px] ${c.text} truncate flex items-center gap-1`}>
                        {DEPARTMENT_ICONS[o.dept]} {DEPARTMENT_LABELS[o.dept] ?? o.dept}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-amber-400 font-bold text-sm">
                        <CountUp value={o.count} />
                      </div>
                      <div className="text-[10px] text-gray-500">งาน</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </FadeIn>

        {/* Activity feed */}
        <FadeIn delay={0.25}>
          <SectionHeader
            icon={<Clock size={18} />}
            title="กิจกรรมล่าสุด"
            subtitle="เหตุฉุกเฉิน เรื่องร้องเรียน และค่าบริการ"
            small
          />
          {loading ? (
            <Skeleton variant="card" height={200} />
          ) : activityFeed.length === 0 ? (
            <EmptyState text="ยังไม่มีกิจกรรมในระบบ" />
          ) : (
            <div className="card p-5 space-y-2.5 max-h-[280px] overflow-y-auto scrollbar-thin">
              {activityFeed.map((item, i) => (
                <ActivityItem key={i} item={item} />
              ))}
            </div>
          )}
        </FadeIn>
      </div>

      {/* Footer note */}
      <FadeIn delay={0.3} className="text-center text-xs text-gray-500 mt-8">
        <p>ข้อมูลอัปเดตจากระบบ — กรมขนส่ง Bit Cities</p>
        <p className="text-gray-600 mt-1">ข้อมูลนี้เปิดเผยต่อสาธารณะ เพื่อความโปร่งใสในการดำเนินงาน</p>
      </FadeIn>
    </div>
  );
}

/* ============== Sub-components ============== */

interface KpiCardProps {
  icon: React.ReactNode;
  label: string;
  value: number;
  subValue: string;
  color: 'emerald' | 'red' | 'blue' | 'amber' | 'purple';
  isMoney?: boolean;
  trend?: number;
  trendLabel?: string;
}

function KpiCard({ icon, label, value, subValue, color, isMoney }: KpiCardProps) {
  const colorMap: Record<string, string> = {
    emerald: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    red: 'text-red-400 bg-red-500/10 border-red-500/20',
    blue: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
    amber: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
    purple: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
  };
  return (
    <div className={`card p-4 border ${colorMap[color]} hover-lift`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-gray-400">{label}</span>
        <div className={`w-8 h-8 rounded-lg ${colorMap[color].split(' ').slice(1).join(' ')} flex items-center justify-center`}>
          {icon}
        </div>
      </div>
      <div className={`text-2xl font-bold text-white ${isMoney ? 'text-lg' : ''}`}>
        {isMoney ? (
          <CountUp value={value} suffix=" BC" />
        ) : (
          <CountUp value={value} />
        )}
      </div>
      <div className="text-xs text-gray-500 mt-0.5">{subValue}</div>
    </div>
  );
}

function SectionHeader({ icon, title, subtitle, small }: { icon: React.ReactNode; title: string; subtitle?: string; small?: boolean }) {
  return (
    <div className={`flex items-center gap-3 ${small ? 'mb-2' : 'mb-3'}`}>
      <div className={`${small ? 'w-7 h-7' : 'w-8 h-8'} bg-navy-800 border border-blue-900/40 rounded-lg flex items-center justify-center text-amber-400`}>
        {icon}
      </div>
      <div>
        <h2 className={`${small ? 'text-sm' : 'text-base'} font-bold text-white`}>{title}</h2>
        {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
      </div>
    </div>
  );
}

function RankRow({ label, count, color, icon }: { label: string; count: number; color: string; icon: string }) {
  const colorMap: Record<string, string> = {
    amber: 'text-amber-400 bg-amber-500/10',
    blue: 'text-blue-400 bg-blue-500/10',
    emerald: 'text-emerald-400 bg-emerald-500/10',
  };
  return (
    <div className="flex items-center justify-between text-sm">
      <div className="flex items-center gap-2 text-gray-300">
        <span className="text-base">{icon}</span>
        {label}
      </div>
      <div className={`px-2 py-0.5 rounded-full text-xs font-bold ${colorMap[color]}`}>
        <CountUp value={count} /> คน
      </div>
    </div>
  );
}

function StatRow({ icon, label, value, subValue, color }: {
  icon: React.ReactNode; label: string; value: number; subValue: string; color: string;
}) {
  const colorMap: Record<string, string> = {
    emerald: 'text-emerald-400',
    red: 'text-red-400',
    amber: 'text-amber-400',
    blue: 'text-blue-400',
  };
  return (
    <div className="flex items-center justify-between">
      <div className={`flex items-center gap-1.5 ${colorMap[color]}`}>
        {icon}
        <span className="text-gray-300">{label}</span>
      </div>
      <div className="text-right">
        <div className={`${colorMap[color]} font-bold`}>
          <CountUp value={value} />
        </div>
        <div className="text-[10px] text-gray-500">{subValue}</div>
      </div>
    </div>
  );
}

function ActivityItem({ item }: { item: { type: string; at: string; data: any } }) {
  const config = {
    emergency: { icon: <Siren size={14} />, color: 'text-red-400', label: 'เหตุฉุกเฉิน' },
    complaint: { icon: <MessageSquare size={14} />, color: 'text-amber-400', label: 'เรื่องร้องเรียน' },
    service: { icon: <DollarSign size={14} />, color: 'text-emerald-400', label: 'ค่าบริการ' },
    announcement: { icon: <Megaphone size={14} />, color: 'text-blue-400', label: 'ประกาศ' },
  }[item.type as 'emergency' | 'complaint' | 'service' | 'announcement'];

  const detail =
    item.type === 'emergency' ? (item.data.location || item.data.details?.slice(0, 40) || 'ไม่ระบุ')
    : item.type === 'complaint' ? (item.data.category || item.data.description?.slice(0, 40) || 'ไม่ระบุ')
    : item.type === 'service' ? `${item.data.service_name} • ${item.data.roblox_username}`
    : item.data.title;

  return (
    <div className="flex items-start gap-2.5 text-xs">
      <div className={`${config.color} mt-0.5 flex-shrink-0`}>{config.icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className={`${config.color} font-semibold`}>{config.label}</span>
          <span className="text-gray-600">•</span>
          <span className="text-gray-500">{formatTimeAgo(item.at)}</span>
        </div>
        <div className="text-gray-300 truncate mt-0.5">{detail}</div>
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="card p-8 text-center">
      <BarChart3 size={28} className="text-gray-600 mx-auto mb-2" />
      <p className="text-gray-400 text-sm">{text}</p>
    </div>
  );
}

/* ============== Utils ============== */

function formatMoney(n: number) {
  return n.toLocaleString('th-TH');
}

function formatTimeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'เมื่อกี้นี้';
  if (min < 60) return `${min} นาทีที่แล้ว`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} ชม.ที่แล้ว`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} วันที่แล้ว`;
  return new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
}
