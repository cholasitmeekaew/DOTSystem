import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { getOfficerFields } from '../../lib/officerColumns';
import { assignRecordOfficers, fetchAssignedOfficerIds } from '../../lib/api/revenueSharing';
import { getOfficerUsernameMap } from '../../lib/api/officerUsernames';
import type { Officer, ServiceRecord } from '../../lib/types';
import { PageHeader } from '../../components/PageHeader';
import { Badge } from '../../components/Badge';
import { Modal, ConfirmDialog } from '../../components/Modal';
import { useToast } from '../../hooks/use-toast';
import { useAuth } from '../../lib/AuthContext';
import {
  Users, Search, Check, X, ChevronDown, ChevronUp, UserPlus,
  DollarSign, Award, AlertTriangle, UserCheck,
} from 'lucide-react';

type StatusFilter = 'all' | 'unpaid' | 'paid';

const PAGE_SIZE = 40;

/** ตัวเลขเงิน */
function formatMoney(n: number): string {
  return `${Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 })} BC`;
}

/** ชื่อผู้ใช้/ชื่อเต็มสำหรับแสดงผล */
function officerLabel(o: Officer, usernameMap: Map<string, string>): string {
  const u = usernameMap.get(o.id);
  return u ? `${o.name} (@${u})` : o.name;
}

/**
 * จัดการ "เจ้าหน้าที่ที่ดูแลเคส"
 *
 * แต่ละบิลค่าบริการมีผู้ดูแลหลัก (`officer_id`) และผู้ร่วมงานได้อีก
 * ผ่าน `service_record_officers` — หน้านี้ใช้จัดการรายชื่อนั้น
 *
 * ทำไมต้องมีหน้านี้
 * ────────────────
 * ถ้าบิลไหนไม่มีผู้ได้รับมอบหมาย ตอนกดเปลี่ยนเป็น "ชำระแล้ว"
 * ระบบจะให้คะแนนแค่ผู้รับผิดชอบหลัก 1 คน (+5) และคิดส่วนแบ่งได้คนเดียว
 * ผู้ที่ไปช่วยงานจริงจะไม่ได้คะแนนและไม่ได้ส่วนแบ่ง
 */
export function CaseOfficersPage() {
  const { officer: actor } = useAuth();
  const { toast } = useToast();

  const [records, setRecords] = useState<ServiceRecord[]>([]);
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [usernameMap, setUsernameMap] = useState<Map<string, string>>(new Map());
  const [assignedMap, setAssignedMap] = useState<Record<string, string[]>>({});

  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [view, setView] = useState<'records' | 'officers'>('records');

  const [editing, setEditing] = useState<ServiceRecord | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [confirmClear, setConfirmClear] = useState<ServiceRecord | null>(null);

  /* ---------- โหลดข้อมูล ---------- */

  const load = useCallback(async () => {
  const fields = await getOfficerFields();
    setLoading(true);

    const [recRes, offRes] = await Promise.all([
      supabase.from('service_records').select('*').order('service_date', { ascending: false }),
      supabase.from('officers').select(fields).neq('status', 'deleted').order('name'),
    ]);

    const recs = (recRes.data ?? []) as ServiceRecord[];
    const offs = (offRes.data ?? []) as Officer[];
    setRecords(recs);
    setOfficers(offs);
    setUsernameMap(await getOfficerUsernameMap());

    // ดึงผู้ดูแลเคสทั้งหมดในครั้งเดียว
    const ids = await fetchAssignedOfficerIds(recs.map((r) => r.id));
    setAssignedMap(ids);

    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  /* ---------- กรองรายการ ---------- */

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return records.filter((r) => {
      if (statusFilter === 'paid' && r.status !== 'paid') return false;
      if (statusFilter === 'unpaid' && r.status === 'paid') return false;
      if (!q) return true;
      return (
        (r.service_name ?? '').toLowerCase().includes(q) ||
        (r.roblox_username ?? '').toLowerCase().includes(q) ||
        (r.discord_username ?? '').toLowerCase().includes(q) ||
        (r.officer_name ?? '').toLowerCase().includes(q)
      );
    });
  }, [records, search, statusFilter]);

  const stats = useMemo(() => {
    let withoutTeam = 0;
    let unpaid = 0;
    for (const r of records) {
      if (r.status !== 'paid') {
        unpaid += 1;
        if ((assignedMap[r.id] ?? []).length === 0) withoutTeam += 1;
      }
    }
    return { total: records.length, unpaid, withoutTeam };
  }, [records, assignedMap]);

  /* ---------- จัดการผู้ดูแลเคส ---------- */

  function openAssign(r: ServiceRecord) {
    setEditing(r);
    setPicked(new Set(assignedMap[r.id] ?? []));
  }

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function saveAssign() {
    if (!editing || !actor) return;
    setSaving(true);
    try {
      await assignRecordOfficers(editing.id, [...picked], actor.id);

      // อัปเดต state ทันที ไม่ต้องโหลดทั้งหน้า
      setAssignedMap((prev) => ({ ...prev, [editing.id]: [...picked] }));

      // บิลที่จ่ายแล้ว: เพิ่งเพิ่มผู้ดูแล → ต้องให้คะแนนคนใหม่ทันที
      // ไม่งั้นเขาจะได้คะแนนเฉพาะตอนกดสแกนรอบหน้า
      if (editing.status === 'paid') {
        const { applyServiceClosedPoints } = await import('../../lib/api/autoPoints');
        const results = await applyServiceClosedPoints(editing, [...picked]);
        const awarded = results.filter((r) => r.awarded).length;
        toast({
          title: awarded > 0 ? `บันทึกแล้ว · ให้คะแนนใหม่ ${awarded} คน` : 'บันทึกผู้ดูแลเคสแล้ว',
          description: awarded > 0
            ? 'บิลนี้ชำระแล้ว จึงให้ +5 คะแนนแก่ผู้ได้รับมอบหมายที่เพิ่งเพิ่มเข้ามา'
            : 'ผู้ดูแลเคสทุกคนได้คะแนนบิลนี้แล้ว ไม่ให้ซ้ำ',
        });
      } else {
        toast({
          title: 'บันทึกผู้ดูแลเคสแล้ว',
          description: 'จะได้ +5 คะแนนต่อคนเมื่อบิลนี้เปลี่ยนเป็นชำระแล้ว',
        });
      }

      setEditing(null);
    } catch (e) {
      toast({ title: 'บันทึกไม่สำเร็จ', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  async function clearAssign(r: ServiceRecord) {
    if (!actor) return;
    setSaving(true);
    try {
      await assignRecordOfficers(r.id, [], actor.id);
      setAssignedMap((prev) => ({ ...prev, [r.id]: [] }));
      setConfirmClear(null);
      toast({ title: 'ล้างผู้ดูแลเคสแล้ว', description: 'บิลนี้จะคิดส่วนแบ่งเฉพาะผู้รับผิดชอบหลัก' });
    } catch (e) {
      toast({ title: 'ล้างไม่สำเร็จ', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }


  /* ---------- รวมรายชื่อเจ้าหน้าที่จากทุกรายการแจ้งค่าบริการ ---------- */

  /**
   * ดึงรายชื่อผู้ดูแลเคสออกจากทุกบิล แล้วรวมเป็นรายคน
   *
   * นับทั้ง "ผู้รับผิดชอบหลัก" (`officer_id`) และ "ผู้ร่วมงาน"
   * ที่บันทึกไว้ใน service_record_officers — คนเดียวกัน
   * อาจดูแลหลายบิลจึงต้องรวมให้ถูก
   */
  const officerRollup = useMemo(() => {
    interface Acc {
      officerId: string;
      cases: number;
      unpaid: number;
      totalAmount: number;
      asPrimary: number;
      asTeam: number;
      /** ใช้กันนับบิลซ้ำเวลาคนเดียวกันเป็นทั้งหลักและร่วม */
      casesById: Set<string>;
    }
    const map = new Map<string, Acc>();

    const bump = (id: string, r: ServiceRecord, role: 'primary' | 'team') => {
      if (!id) return;
      let acc = map.get(id);
      if (!acc) {
        acc = {
          officerId: id, cases: 0, unpaid: 0, totalAmount: 0,
          asPrimary: 0, asTeam: 0, casesById: new Set<string>(),
        };
        map.set(id, acc);
      }
      // กันนับบิลเดียวสองครั้ง (เป็นทั้งหลักและร่วม)
      if (acc.casesById.has(r.id)) return;
      acc.casesById.add(r.id);

      acc.cases += 1;
      if (r.status !== 'paid') acc.unpaid += 1;
      acc.totalAmount += Number(r.amount || 0);
      if (role === 'primary') acc.asPrimary += 1;
      else acc.asTeam += 1;
    };

    for (const r of records) {
      bump(r.officer_id ?? '', r, 'primary');
      for (const id of assignedMap[r.id] ?? []) {
        if (id !== r.officer_id) bump(id, r, 'team');
      }
    }

    const list = [...map.values()];
    const q = search.trim().toLowerCase();
    const filtered = q
      ? list.filter((a) => {
          const o = officers.find((x) => x.id === a.officerId);
          if (!o) return false;
          const u = usernameMap.get(o.id);
          return (
            o.name.toLowerCase().includes(q) ||
            (u ?? '').toLowerCase().includes(q) ||
            o.rank.toLowerCase().includes(q) ||
            o.department.toLowerCase().includes(q)
          );
        })
      : list;

    return filtered.sort((a, b) => b.cases - a.cases || b.totalAmount - a.totalAmount);
  }, [records, assignedMap, officers, usernameMap, search]);

  /** บิลที่เจ้าหน้าที่คนนี้ดูแล */
  function casesOf(officerId: string): ServiceRecord[] {
    return records.filter((r) =>
      r.officer_id === officerId || (assignedMap[r.id] ?? []).includes(officerId),
    );
  }

  const [openOfficer, setOpenOfficer] = useState<string | null>(null);

  const visible = rows.slice(0, limit);

  return (
    <div>
      <PageHeader
        icon={<Users size={20} />}
        title="เจ้าหน้าที่ที่ดูแลเคส"
        subtitle="กำหนดว่าบิลค่าบริการแต่ละใบใครดูแล — มีผลกับสัดส่วนและคะแนน PPS"
      />

      {/* สรุป */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
        <div className="card p-3">
          <div className="text-xs text-gray-500">บิลทั้งหมด</div>
          <div className="text-xl font-bold text-white mt-0.5">{stats.total}</div>
        </div>
        <div className="card p-3">
          <div className="text-xs text-gray-500">ยังค้างชำระ</div>
          <div className="text-xl font-bold text-amber-400 mt-0.5">{stats.unpaid}</div>
        </div>
        <div className="card p-3">
          <div className="text-xs text-gray-500">ค้างชำระ & มีผู้ร่วมงาน</div>
          <div className="text-xl font-bold text-white mt-0.5">
            {stats.unpaid - stats.withoutTeam}
          </div>
        </div>
        <div className="card p-3 border-amber-500/30">
          <div className="text-xs text-gray-500">ค้างชำระ & ยังไม่มีทีม</div>
          <div className={`text-xl font-bold mt-0.5 ${stats.withoutTeam > 0 ? 'text-red-400' : 'text-gray-500'}`}>
            {stats.withoutTeam}
          </div>
        </div>
      </div>

      {stats.withoutTeam > 0 && (
        <div className="flex items-start gap-2 p-3 mb-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
          <AlertTriangle size={16} className="text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-200">
            มี <strong>{stats.withoutTeam}</strong> บิลที่ยังค้างชำระและไม่ได้ระบุผู้ร่วมงาน
            ตอนกดเปลี่ยนเป็น "ชำระแล้ว" จะได้คะแนนและส่วนแบ่งเฉพาะผู้รับผิดชอบหลัก 1 คน
            — แนะนำให้ระบุผู้ดูแลเคสก่อนจ่ายเงิน
          </p>
        </div>
      )}


      {/* สลับมุมมอง: รายบิล ↔ รายชื่อเจ้าหน้าที่ */}
      <div className="flex gap-1 mb-3">
        {([
          ['records', 'รายการบิล', Users],
          ['officers', 'รายชื่อเจ้าหน้าที่', UserCheck],
        ] as const).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setView(key)}
            className={`px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5 transition-colors ${
              view === key
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                : 'bg-navy-900 text-gray-400 border border-blue-900/40 hover:text-white'
            }`}
          >
            <Icon size={13} />
            {label}
          </button>
        ))}
        {view === 'officers' && (
          <span className="text-xs text-gray-500 self-center ml-1">
            {officerRollup.length} คน (ดึงจากทุกรายการในแจ้งค่าบริการ)
          </span>
        )}
      </div>

      {/* ตัวกรอง */}
      <div className="card p-3 mb-3 flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            className="input-field pl-9 w-full"
            placeholder="ค้นหาชื่อบริการ / ประชาชน / ผู้รับผิดชอบ"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setLimit(PAGE_SIZE); }}
          />
        </div>
        <div className="flex gap-1 shrink-0">
          {([
            ['all', 'ทั้งหมด', stats.total],
            ['unpaid', 'ค้างชำระ', stats.unpaid],
            ['paid', 'ชำระแล้ว', stats.total - stats.unpaid],
          ] as const).map(([key, label, count]) => (
            <button
              key={key}
              onClick={() => { setStatusFilter(key); setLimit(PAGE_SIZE); }}
              className={`px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                statusFilter === key
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  : 'bg-navy-900 text-gray-400 border border-blue-900/40 hover:text-white'
              }`}
            >
              {label} ({count})
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-center text-gray-500 text-sm py-10">กำลังโหลด…</div>
      ) : view === 'officers' ? (
        officerRollup.length === 0 ? (
          <div className="text-center text-gray-500 text-sm py-10">ยังไม่มีข้อมูลผู้ดูแลเคส</div>
        ) : (
          <div className="space-y-2">
            {officerRollup.map((a) => {
              const o = officers.find((x) => x.id === a.officerId);
              const open = openOfficer === a.officerId;
              const list = casesOf(a.officerId);
              return (
                <div key={a.officerId} className="card p-3">
                  <button
                    onClick={() => setOpenOfficer(open ? null : a.officerId)}
                    className="w-full flex items-center gap-3 text-left"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-semibold text-white text-sm truncate">
                          {o?.name ?? a.officerId.slice(0, 8)}
                        </span>
                        {o && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded border border-blue-500/30 bg-blue-500/10 text-blue-300">
                            {o.rank}
                          </span>
                        )}
                        {a.asTeam > 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded border border-cyan-500/30 bg-cyan-500/10 text-cyan-300">
                            ร่วมงาน {a.asTeam} เคส
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-gray-500 mt-0.5">
                        @{usernameMap.get(a.officerId) ?? '—'} · {o?.department ?? '-'}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 flex-shrink-0">
                      <div className="text-right">
                        <div className="text-[10px] text-gray-500">เคส</div>
                        <div className="text-sm font-bold text-white">{a.cases}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] text-gray-500">ค้างชำระ</div>
                        <div className={`text-sm font-bold ${a.unpaid > 0 ? 'text-amber-400' : 'text-gray-500'}`}>
                          {a.unpaid}
                        </div>
                      </div>
                      <div className="text-right hidden sm:block">
                        <div className="text-[10px] text-gray-500">มูลค่ารวม</div>
                        <div className="text-sm font-bold text-emerald-400">
                          {formatMoney(a.totalAmount)}
                        </div>
                      </div>
                      {open ? <ChevronUp size={15} className="text-gray-500" /> : <ChevronDown size={15} className="text-gray-500" />}
                    </div>
                  </button>

                  {open && (
                    <div className="mt-3 pt-3 border-t border-blue-900/40 space-y-1">
                      {list.map((r) => {
                        const isPrimary = r.officer_id === a.officerId;
                        return (
                          <div
                            key={r.id}
                            className="flex items-center gap-2 px-2 py-1.5 rounded bg-navy-900/40 border border-blue-900/30"
                          >
                            <span
                              className={
                                'text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 border '
                                + (isPrimary
                                  ? 'border-blue-500/30 bg-blue-500/10 text-blue-300'
                                  : 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300')
                              }
                            >
                              {isPrimary ? 'หลัก' : 'ร่วม'}
                            </span>
                            <span className="text-[11px] text-gray-300 flex-1 min-w-0 truncate">
                              {r.service_name} · {r.roblox_username}
                            </span>
                            <Badge variant={r.status === 'paid' ? 'success' : 'danger'}>
                              {r.status === 'paid' ? 'จ่ายแล้ว' : 'ค้างชำระ'}
                            </Badge>
                            <span className="text-[11px] text-amber-300 flex-shrink-0">
                              {formatMoney(r.amount)}
                            </span>
                            <button
                              onClick={() => openAssign(r)}
                              className="text-[10px] text-cyan-400 hover:text-cyan-300 flex-shrink-0"
                            >
                              จัดการ
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      ) : visible.length === 0 ? (
        <div className="text-center text-gray-500 text-sm py-10">ไม่พบรายการ</div>
      ) : (
        <div className="space-y-2">
          {visible.map((r) => {
            const team = assignedMap[r.id] ?? [];
            const primaryId = r.officer_id;
            const isPaid = r.status === 'paid';

            return (
              <div key={r.id} className="card p-3">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <DollarSign size={14} className="text-blue-400 flex-shrink-0" />
                      <span className="font-semibold text-white text-sm">{r.service_name}</span>
                      <Badge variant={isPaid ? 'success' : 'danger'}>
                        {isPaid ? 'ชำระแล้ว' : 'ค้างชำระ'}
                      </Badge>
                      {team.length > 0 && (
                        <Badge variant="info">
                          <Users size={10} className="mr-1" />
                          {team.length} คน
                        </Badge>
                      )}
                    </div>

                    <div className="text-xs text-gray-400 mt-1 truncate">
                      {r.roblox_username}
                      {r.discord_username ? ` · ${r.discord_username}` : ''}
                      {' · '}
                      <span className="text-amber-300">{formatMoney(r.amount)}</span>
                    </div>

                    {/* ผู้ดูแลเคส */}
                    <div className="mt-2 flex flex-wrap gap-1">
                      <span className="text-[10px] text-gray-500 self-center">ผู้ดูแล:</span>
                      {primaryId ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded border border-blue-500/30 bg-blue-500/10 text-blue-300">
                          {officers.find((o) => o.id === primaryId)?.name ?? r.officer_name ?? '—'}
                          <span className="text-blue-400/70"> (หลัก)</span>
                        </span>
                      ) : (
                        <span className="text-[10px] text-red-400">ไม่มีผู้รับผิดชอบหลัก</span>
                      )}
                      {team.filter((id) => id !== primaryId).map((id) => (
                        <span
                          key={id}
                          className="text-[10px] px-1.5 py-0.5 rounded border border-cyan-500/30 bg-cyan-500/10 text-cyan-300"
                        >
                          {officers.find((o) => o.id === id)?.name ?? id.slice(0, 8)}
                        </span>
                      ))}
                    </div>
                  </div>

                  <button
                    onClick={() => openAssign(r)}
                    className="btn-secondary flex items-center gap-1 text-xs flex-shrink-0"
                  >
                    <UserPlus size={14} />
                    <span className="hidden sm:inline">จัดการ</span>
                  </button>
                </div>
              </div>
            );
          })}

          {rows.length > limit && (
            <button
              onClick={() => setLimit((n) => n + PAGE_SIZE)}
              className="w-full py-2 text-xs text-amber-400 hover:text-amber-300 flex items-center justify-center gap-1"
            >
              <ChevronDown size={13} />
              แสดงเพิ่มอีก {Math.min(PAGE_SIZE, rows.length - limit)} รายการ
              (ทั้งหมด {rows.length})
            </button>
          )}
          {limit > PAGE_SIZE && (
            <button
              onClick={() => setLimit(PAGE_SIZE)}
              className="w-full py-2 text-xs text-gray-400 hover:text-white flex items-center justify-center gap-1"
            >
              <ChevronUp size={13} />
              ย่อกลับ
            </button>
          )}
        </div>
      )}

      {/* Modal เลือกผู้ดูแลเคส */}
      {editing && (
        <Modal
          title={`จัดการผู้ดูแลเคส — ${editing.service_name}`}
          onClose={() => setEditing(null)}
          size="md"
        >
          <div className="space-y-3">
            <div className="p-3 rounded-lg bg-navy-900/60 border border-blue-900/40 text-xs">
              <div className="text-gray-400">
                ประชาชน: <span className="text-white">{editing.roblox_username}</span>
              </div>
              <div className="text-gray-400 mt-0.5">
                ยอด: <span className="text-amber-300">{formatMoney(editing.amount)}</span>
                {' · '}
                สถานะ:{' '}
                <span className={editing.status === 'paid' ? 'text-emerald-400' : 'text-red-400'}>
                  {editing.status === 'paid' ? 'ชำระแล้ว' : 'ค้างชำระ'}
                </span>
              </div>
            </div>

            <div>
              <p className="text-xs text-gray-400 mb-2">
                เลือกผู้ร่วมงาน ({picked.size} คน)
                {editing.status === 'paid' && (
                  <span className="text-amber-300"> — บิลนี้จ่ายแล้ว คนที่เพิ่มเข้ามาใหม่จะได้ +5 คะแนนทันที</span>
                )}
              </p>

              <div className="max-h-64 overflow-y-auto space-y-1">
                {officers.map((o) => {
                  const isPrimary = o.id === editing.officer_id;
                  const on = picked.has(o.id);
                  return (
                    <button
                      key={o.id}
                      onClick={() => toggle(o.id)}
                      className={`w-full flex items-center gap-2 p-2 rounded-lg text-left transition-colors ${
                        on
                          ? 'bg-cyan-500/15 border border-cyan-500/40'
                          : 'bg-navy-900/40 border border-blue-900/30 hover:border-blue-900/60'
                      }`}
                    >
                      <span className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 ${
                        on ? 'bg-cyan-500 text-navy-900' : 'border border-gray-600'
                      }`}
                      >
                        {on && <Check size={12} />}
                      </span>
                      <span className="text-xs text-white flex-1 min-w-0 truncate">
                        {officerLabel(o, usernameMap)}
                      </span>
                      {isPrimary && (
                        <span className="text-[9px] text-blue-300 bg-blue-500/15 border border-blue-500/30 px-1.5 py-0.5 rounded flex-shrink-0">
                          หลัก
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-start gap-1.5 text-[11px] text-gray-500">
              <Award size={12} className="flex-shrink-0 mt-0.5 text-amber-400" />
              <span>
                ทุกคนที่เลือกจะได้ <strong className="text-amber-300">+5 คะแนน</strong> เมื่อบิลนี้เป็นชำระแล้ว
                และได้รับส่วนแบ่งตามจำนวนผู้ดูแล
              </span>
            </div>

            <div className="flex gap-2 justify-end pt-1">
              <button
                onClick={() => setEditing(null)}
                className="btn-secondary flex items-center gap-1"
              >
                <X size={14} />
                ยกเลิก
              </button>
              {(assignedMap[editing.id] ?? []).length > 0 && (
                <button
                  onClick={() => { setEditing(null); setConfirmClear(editing); }}
                  className="btn-secondary text-red-400"
                >
                  ล้างทั้งหมด
                </button>
              )}
              <button
                onClick={saveAssign}
                disabled={saving}
                className="btn-primary flex items-center gap-1"
              >
                <Check size={14} />
                {saving ? 'กำลังบันทึก…' : 'บันทึก'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ล้างผู้ดูแลเคส — ต้องมีเงื่อนไขปิด ไม่งั้น dialog จะโผล่ทันทีที่เข้าหน้า */}
      {confirmClear && (
        <ConfirmDialog
          title={`ล้างผู้ดูแลเคส — ${confirmClear.service_name}`}
          message={`บิล "${confirmClear.service_name}" ของ ${confirmClear.roblox_username} จะเหลือผู้รับผิดชอบหลักคนเดียว ส่วนแบ่งและคะแนนของผู้ร่วมงานเดิมจะถูกคืน (ถ้ามี)`}
          confirmLabel="ล้างผู้ดูแลเคส"
          danger
          onConfirm={() => clearAssign(confirmClear)}
          onCancel={() => setConfirmClear(null)}
        />
      )}
    </div>
  );
}
