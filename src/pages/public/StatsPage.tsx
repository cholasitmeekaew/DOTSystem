import { useEffect, useMemo, useState } from 'react';
import {
  BarChart3, Users, Car, DollarSign, CreditCard, MessageSquare, Siren,
  TrendingUp, TrendingDown, Shield, FileText, Clock, CheckCircle2,
  AlertCircle, Wrench, Zap, TrafficCone, ArrowRight, Megaphone, PieChart,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import {
  Officer, ServiceRecord, Vehicle, License, Complaint, EmergencyReport,
  Announcement, DEPARTMENT_LABELS, RANK_LABELS, Department, OfficerRankRecord,
  Citizen, DutyLog, CITIZEN_STATUS_LABELS,
} from '../../lib/types';
import { buildMonthlyDutyHours, buildWorkloadByCategory, formatDutyHours } from '../../lib/dutyStats';
import { calculateRevenueAndDebtSummary } from '../../lib/citizenDebt';
import { FadeIn, Stagger, StaggerItem, Skeleton, CountUp } from '../../components/animations';
import { GoldBarChart, DonutChart } from '../../components/Charts';

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
  const [ranks, setRanks] = useState<OfficerRankRecord[]>([]);
  const [serviceRecordOfficers, setServiceRecordOfficers] = useState<{ service_record_id: string; officer_id: string }[]>([]);
  const [citizens, setCitizens] = useState<Citizen[]>([]);
  const [dutyLogs, setDutyLogs] = useState<DutyLog[]>([]);
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
      supabase.from('officer_ranks').select('*').order('sort_order'),
      supabase.from('service_record_officers').select('service_record_id, officer_id'),
      supabase.from('citizens').select('id, roblox_username, discord_username, status, created_at, updated_at'),
      supabase.from('duty_logs').select('*').is('deleted_at', null).order('clock_in', { ascending: false }).limit(5000),
    ]).then(([o, v, s, l, c, e, a, r, sro, cit, dl]) => {
      setOfficers((o.data as unknown as Officer[]) ?? []);
      setVehicles((v.data as unknown as Vehicle[]) ?? []);
      setServiceRecords((s.data as unknown as ServiceRecord[]) ?? []);
      setLicenses((l.data as unknown as License[]) ?? []);
      setComplaints((c.data as unknown as Complaint[]) ?? []);
      setEmergencyReports((e.data as unknown as EmergencyReport[]) ?? []);
      setAnnouncements((a.data as unknown as Announcement[]) ?? []);
      setRanks((r.data as unknown as OfficerRankRecord[]) ?? []);
      setServiceRecordOfficers((sro.data as unknown as { service_record_id: string; officer_id: string }[]) ?? []);
      setCitizens((cit.data as unknown as Citizen[]) ?? []);
      setDutyLogs((dl.data as unknown as DutyLog[]) ?? []);
      setLoading(false);
    });
  }, []);

  // ===== Derived stats =====
  const activeOfficers = useMemo(() => officers.filter((o) => o.status === 'active'), [officers]);
  const onDutyOfficers = useMemo(() => officers.filter((o) => o.is_on_duty), [officers]);
  const impoundedVehicles = useMemo(() => vehicles.filter((v) => v.is_impounded), [vehicles]);

  const rankStats = useMemo(() => {
    return ranks
      .filter((r) => r.is_active)
      .map((r) => {
        const key = r.rank_key ?? r.label;
        const count = activeOfficers.filter((o) => o.rank === key).length;
        return { rank: r, count };
      });
  }, [ranks, activeOfficers]);

  // ===== รายได้รวม (BC) — ใช้สูตรเดียวกับ Dashboard: ยกเว้นยอดค้างชำระของ banned/suspended เด็ดขาด =====
  const revenueSummary = useMemo(
    () => calculateRevenueAndDebtSummary(serviceRecords, citizens),
    [serviceRecords, citizens],
  );
  const totalRevenue = revenueSummary.totalRevenue;
  const paidAmount = revenueSummary.paidTotal;
  const unpaidAmount = revenueSummary.unpaidTotal;
  const excludedDebtTotal = revenueSummary.excludedDebtTotal;
  const excludedDebtCount = revenueSummary.excludedDebtCount;

  // ===== ภาพรวมประชากร =====
  const citizenStats = useMemo(() => {
    const total = citizens.length;
    const normal = citizens.filter((c) => c.status === 'normal').length;
    const watched = citizens.filter((c) => c.status === 'watched').length;
    const suspended = citizens.filter((c) => c.status === 'suspended').length;
    const banned = citizens.filter((c) => c.status === 'banned').length;
    return { total, normal, watched, suspended, banned };
  }, [citizens]);

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
    for (const o of activeOfficers) {
      const cur = map.get(o.department) ?? { officers: 0, onDuty: 0, total: 0 };
      cur.officers++;
      cur.total++;
      if (o.is_on_duty) cur.onDuty++;
      map.set(o.department, cur);
    }
    return Array.from(map.entries()).map(([dept, s]) => ({ dept, ...s }));
  }, [activeOfficers]);

  const maxDeptOfficers = Math.max(1, ...deptStats.map((d) => d.officers));

  // ===== Top 5 เจ้าหน้าที่เข้าเวร/ปฏิบัติหน้าที่มากที่สุด — จาก Duty Logs (จำนวนครั้ง + ชั่วโมงสะสม) =====
  const topDutyOfficers = useMemo(() => {
    const map = new Map<string, { officerId: string; name: string; count: number; totalMinutes: number; dept: Department; rank: string }>();
    const now = Date.now();
    for (const log of dutyLogs) {
      if (log.deleted_at) continue;
      const oid = log.officer_id ?? `name:${log.officer_name}`;
      const o = log.officer_id ? officers.find((x) => x.id === log.officer_id) : undefined;
      const cur = map.get(oid) ?? {
        officerId: oid,
        name: o?.name || log.officer_name || 'ไม่ทราบชื่อ',
        count: 0,
        totalMinutes: 0,
        dept: o?.department || ('traffic_management' as Department),
        rank: o?.rank || 'officer',
      };
      cur.count++;
      let mins = Number(log.duration_minutes ?? 0);
      if (!mins || Number.isNaN(mins)) {
        try {
          const start = new Date(log.clock_in).getTime();
          const end = log.clock_out ? new Date(log.clock_out).getTime() : now;
          if (!Number.isNaN(start) && !Number.isNaN(end) && end >= start) {
            mins = Math.round((end - start) / 60000);
          } else {
            mins = 0;
          }
        } catch {
          mins = 0;
        }
      }
      cur.totalMinutes += Math.max(0, mins);
      if (o) {
        cur.name = o.name;
        cur.dept = o.department;
        cur.rank = o.rank;
      } else if (log.officer_name) {
        cur.name = log.officer_name;
      }
      map.set(oid, cur);
    }
    return [...map.values()]
      .sort((a, b) => b.count - a.count || b.totalMinutes - a.totalMinutes)
      .slice(0, 5);
  }, [dutyLogs, officers]);

  // ===== Top officers สำรอง (by service count) — ใช้เป็น fallback กรณีไม่มี duty logs =====
  const topOfficers = useMemo(() => {
    const map = new Map<string, { name: string; count: number; dept: Department; rank: string }>();

    // Helper to add officer count
    const addCount = (officerId: string, officerName?: string) => {
      const o = officers.find((x) => x.id === officerId);
      const cur = map.get(officerId) ?? {
        name: o?.name || officerName || 'ไม่ทราบชื่อ',
        count: 0,
        dept: o?.department || ('traffic_management' as Department),
        rank: o?.rank || 'officer',
      };
      cur.count++;
      if (o) {
        cur.name = o.name;
        cur.dept = o.department;
        cur.rank = o.rank;
      }
      map.set(officerId, cur);
    };

    // 1) นับจาก service_record_officers (กรณีมีบันทึกหลายคน) หรือ fallback service_records.officer_id
    if (serviceRecordOfficers.length > 0) {
      for (const sro of serviceRecordOfficers) {
        if (sro.officer_id) addCount(sro.officer_id);
      }
      // บวกเคสที่ไม่มีใน service_record_officers แต่มีใน service_records
      const coveredRecordIds = new Set(serviceRecordOfficers.map((s) => s.service_record_id));
      for (const r of serviceRecords) {
        if (!coveredRecordIds.has(r.id) && r.officer_id) {
          addCount(r.officer_id, r.officer_name);
        }
      }
    } else {
      for (const r of serviceRecords) {
        if (r.officer_id) addCount(r.officer_id, r.officer_name);
      }
    }

    // 2) นับจากการรับแจ้งเหตุฉุกเฉิน / บริการฉุกเฉิน (emergency_reports)
    for (const e of emergencyReports) {
      if (e.responded_by) {
        addCount(e.responded_by, e.responded_by_name ?? undefined);
      }
    }

    return [...map.values()].sort((a, b) => b.count - a.count).slice(0, 5);
  }, [serviceRecords, serviceRecordOfficers, emergencyReports, officers]);

  // ===== กราฟ: ชั่วโมงเวรย้อนหลัง 7 เดือน + สัดส่วนงานตามหมวด =====
  const monthlyDutyHours = useMemo(() => buildMonthlyDutyHours(dutyLogs, 7), [dutyLogs]);

  const workloadByCategory = useMemo(() => buildWorkloadByCategory(serviceRecords), [serviceRecords]);

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

      {/* Top KPI cards — 6 cards */}
      {loading ? (
        <FadeIn className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-6">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="card p-5 space-y-2">
              <Skeleton variant="text" width="60%" />
              <Skeleton variant="text" width="40%" height={28} />
            </div>
          ))}
        </FadeIn>
      ) : (
        <Stagger className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
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
              icon={<Wrench size={20} />}
              label="งานบริการและแจ้งเหตุ"
              value={serviceRecords.length + emergencyReports.length}
              subValue={`บริการ ${serviceRecords.length} · แจ้งเหตุ ${emergencyReports.length}`}
              color="blue"
              trend={serviceRecords.length + emergencyReports.length}
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
              subValue={`ชำระแล้ว ${paidAmount.toLocaleString('th-TH')} · ค้าง ${unpaidAmount.toLocaleString('th-TH')}`}
              color="amber"
              isMoney
              trend={paidAmount}
            />
          </StaggerItem>
          <StaggerItem>
            <KpiCard
              icon={<Users size={20} />}
              label="ประชาชนทั้งหมด"
              value={citizenStats.total}
              subValue={`ปกติ ${citizenStats.normal} · เฝ้าระวัง ${citizenStats.watched}`}
              color="blue"
              trend={citizenStats.total}
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

      {/* Section: ภาพรวมประชากร */}
      <FadeIn delay={0.03} className="mb-6">
        <SectionHeader icon={<Users size={18} />} title="ภาพรวมประชากรในระบบ" subtitle={`ทั้งหมด ${citizenStats.total.toLocaleString('th-TH')} คน • ไม่นับยอดหนี้ของสถานะแบน/ระงับสิทธิ์ในรายได้รวม`} />
        {loading ? (
          <Skeleton variant="card" height={120} />
        ) : citizenStats.total === 0 ? (
          <EmptyState text="ยังไม่มีข้อมูลประชาชน" />
        ) : (
          <div className="card p-5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <CitizenStatBox label={CITIZEN_STATUS_LABELS.normal} count={citizenStats.normal} total={citizenStats.total} color="emerald" />
              <CitizenStatBox label={CITIZEN_STATUS_LABELS.watched} count={citizenStats.watched} total={citizenStats.total} color="amber" />
              <CitizenStatBox label={CITIZEN_STATUS_LABELS.suspended} count={citizenStats.suspended} total={citizenStats.total} color="orange" />
              <CitizenStatBox label={CITIZEN_STATUS_LABELS.banned} count={citizenStats.banned} total={citizenStats.total} color="red" />
            </div>
            <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-navy-900">
              {citizenStats.normal > 0 && (
                <div className="bg-emerald-500 h-full" style={{ width: `${(citizenStats.normal / Math.max(1, citizenStats.total)) * 100}%` }} title={`ปกติ ${citizenStats.normal}`} />
              )}
              {citizenStats.watched > 0 && (
                <div className="bg-amber-500 h-full" style={{ width: `${(citizenStats.watched / Math.max(1, citizenStats.total)) * 100}%` }} title={`เฝ้าระวัง ${citizenStats.watched}`} />
              )}
              {citizenStats.suspended > 0 && (
                <div className="bg-orange-600 h-full" style={{ width: `${(citizenStats.suspended / Math.max(1, citizenStats.total)) * 100}%` }} title={`ระงับสิทธิ์ ${citizenStats.suspended}`} />
              )}
              {citizenStats.banned > 0 && (
                <div className="bg-red-500 h-full" style={{ width: `${(citizenStats.banned / Math.max(1, citizenStats.total)) * 100}%` }} title={`แบน ${citizenStats.banned}`} />
              )}
            </div>
            <p className="text-[11px] text-gray-500 mt-2">
              ยอดรายได้รวม (BC) ด้านบน = ชำระแล้ว + ค้างชำระเฉพาะสถานะปกติ/เฝ้าระวัง เท่านั้น (ตรงกับ Dashboard) • ยอดที่กันออก {formatMoney(excludedDebtTotal)} BC ({excludedDebtCount} รายการ)
            </p>
          </div>
        )}
      </FadeIn>

      {/* Section: กราฟงานบริการ */}
      <div className="grid lg:grid-cols-5 gap-4 mb-6">
        <FadeIn delay={0.04} className="lg:col-span-3">
          <SectionHeader
            icon={<BarChart3 size={18} />}
            title="ชั่วโมงเวรย้อนหลัง 7 เดือน"
            subtitle="ชั่วโมงสะสมจากประวัติการเข้าเวร"
            small
          />
          {loading ? (
            <Skeleton variant="card" height={240} />
          ) : (
            <div className="card p-5">
              <GoldBarChart data={monthlyDutyHours} />
            </div>
          )}
        </FadeIn>
        <FadeIn delay={0.06} className="lg:col-span-2">
          <SectionHeader
            icon={<PieChart size={18} />}
            title="สัดส่วนงานตามหมวด"
            subtitle="จำนวนงานบริการแยกตามประเภท"
            small
          />
          {loading ? (
            <Skeleton variant="card" height={240} />
          ) : workloadByCategory.length === 0 ? (
            <EmptyState text="ยังไม่มีข้อมูลงานบริการ" />
          ) : (
            <div className="card p-5">
              <DonutChart data={workloadByCategory} />
            </div>
          )}
        </FadeIn>
      </div>

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
              {rankStats.length > 0 ? (
                rankStats.map((rs, i) => (
                  <RankRow
                    key={rs.rank.id}
                    label={rs.rank.label}
                    count={rs.count}
                    color={getRankColor(rs.rank.sort_order)}
                    icon={getRankIcon(i)}
                  />
                ))
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
                label="รายได้รวม (BC) — ไม่รวมแบน/ระงับสิทธิ์"
                value={revenueSummary.totalRecordsCount}
                subValue={`${formatMoney(totalRevenue)} BC (ตรงกับ Dashboard)`}
                color="amber"
              />
              <StatRow
                icon={<CheckCircle2 size={14} />}
                label="ชำระแล้ว"
                value={revenueSummary.paidCount}
                subValue={`${formatMoney(paidAmount)} BC`}
                color="emerald"
              />
              <StatRow
                icon={<AlertCircle size={14} />}
                label="ค้างชำระ (เฉพาะปกติ/เฝ้าระวัง)"
                value={revenueSummary.unpaidCount}
                subValue={`${formatMoney(unpaidAmount)} BC`}
                color="red"
              />
              {excludedDebtCount > 0 && (
                <div className="flex items-center justify-between rounded-lg bg-red-500/5 border border-red-500/20 px-2.5 py-2">
                  <div className="flex items-center gap-1.5 text-gray-400 text-xs">
                    <Shield size={13} className="text-red-400" />
                    กันออก (แบน/ระงับสิทธิ์)
                  </div>
                  <div className="text-right">
                    <div className="text-red-400 font-bold text-sm">{excludedDebtCount} รายการ</div>
                    <div className="text-[10px] text-gray-500">{formatMoney(excludedDebtTotal)} BC ไม่นับรวม</div>
                  </div>
                </div>
              )}
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

      {/* Section 3: Top duty + Activity feed */}
      <div className="grid lg:grid-cols-2 gap-4 mb-6">
        {/* Top duty performers from Duty Logs */}
        <FadeIn delay={0.2}>
          <SectionHeader
            icon={<TrendingUp size={18} />}
            title="เจ้าหน้าที่ปฏิบัติงานมากที่สุด"
            subtitle="Top 5 — จากประวัติการเข้าเวร (จำนวนครั้ง + ชั่วโมงสะสม)"
            small
          />
          {loading ? (
            <Skeleton variant="card" height={200} />
          ) : topDutyOfficers.length === 0 ? (
            <EmptyState text="ยังไม่มีข้อมูลการเข้าเวร" />
          ) : (
            <div className="card p-5 space-y-2.5">
              {topDutyOfficers.map((o, i) => {
                const c = DEPARTMENT_COLORS[o.dept];
                return (
                  <div key={o.officerId} className="flex items-center gap-3 hover-lift p-2 -mx-2 rounded-lg">
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
                        <CountUp value={o.count} /> <span className="text-[10px] font-normal text-gray-500">เวร</span>
                      </div>
                      <div className="text-[10px] text-gray-500">{formatDutyHours(o.totalMinutes)}</div>
                    </div>
                  </div>
                );
              })}
              {topOfficers.length > 0 && (
                <p className="text-[10px] text-gray-600 pt-1 border-t border-blue-900/30">
                  อ้างอิงงานบริการสูงสุด: {topOfficers.slice(0, 3).map((t) => `${t.name} (${t.count})`).join(' • ')}
                </p>
              )}
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
    <div className="card p-5 relative hover-lift">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-gray-400">{label}</span>
        <div className={`w-8 h-8 rounded-lg border flex items-center justify-center ${colorMap[color]}`}>
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

function getRankColor(sortOrder: number): 'amber' | 'blue' | 'emerald' | 'purple' | 'cyan' | 'pink' {
  if (sortOrder === 1) return 'amber';
  if (sortOrder === 2) return 'blue';
  if (sortOrder === 3) return 'emerald';
  if (sortOrder === 4) return 'purple';
  if (sortOrder === 5) return 'cyan';
  return 'pink';
}

function getRankIcon(index: number): string {
  const icons = ['👑', '🛡️', '👤', '🌱', '⭐', '🔹', '🔸', '◆'];
  return icons[index] ?? '•';
}

function RankRow({ label, count, color, icon }: { label: string; count: number; color: string; icon: string }) {
  const colorMap: Record<string, string> = {
    amber: 'text-amber-400 bg-amber-500/10',
    blue: 'text-blue-400 bg-blue-500/10',
    emerald: 'text-emerald-400 bg-emerald-500/10',
    purple: 'text-purple-400 bg-purple-500/10',
    cyan: 'text-cyan-400 bg-cyan-500/10',
    pink: 'text-pink-400 bg-pink-500/10',
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

function CitizenStatBox({ label, count, total, color }: { label: string; count: number; total: number; color: 'emerald' | 'amber' | 'orange' | 'red' }) {
  const colorMap: Record<string, { text: string; bg: string; bar: string }> = {
    emerald: { text: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20', bar: 'bg-emerald-500' },
    amber: { text: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20', bar: 'bg-amber-500' },
    orange: { text: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/20', bar: 'bg-orange-500' },
    red: { text: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20', bar: 'bg-red-500' },
  };
  const c = colorMap[color];
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className={`rounded-lg border p-3 ${c.bg}`}>
      <div className={`text-xs ${c.text} font-medium`}>{label}</div>
      <div className="text-xl font-bold text-white mt-0.5">
        <CountUp value={count} />
      </div>
      <div className="text-[10px] text-gray-500">{pct}% ของทั้งหมด</div>
      <div className="w-full h-1.5 bg-navy-900 rounded-full overflow-hidden mt-2">
        <div className={`h-full ${c.bar} rounded-full`} style={{ width: `${pct}%` }} />
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
