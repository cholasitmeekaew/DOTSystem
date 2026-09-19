import { useEffect, useState } from 'react';
import {
  Plus, Search, DollarSign, Edit2, Trash2, Image as ImageIcon, Upload, X, Eye, Car, Lock, User, Users, Banknote,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { uploadImage, deleteImage } from '../../lib/storage';
import { ServiceRecord, ServiceRate, ServiceType, Citizen, Officer, RevenueConfig, ServicePayment } from '../../lib/types';
import { useAuth } from '../../lib/AuthContext';
import { SERVICE_CATEGORIES } from './ServiceRatesPage';
import { Badge } from '../../components/Badge';
import { Modal, ConfirmDialog } from '../../components/Modal';
import { PageHeader } from '../../components/PageHeader';
import {
  fetchRevenueConfigs, assignRecordOfficers, recalculateRecord, getScopeForCategory, fetchAssignedOfficerNames,
} from '../../lib/api/revenueSharing';

export function ServiceFeesPage() {
  const { officer, isCommissioner } = useAuth();
  const [records, setRecords] = useState<ServiceRecord[]>([]);
  const [rates, setRates] = useState<ServiceRate[]>([]);
  const [citizens, setCitizens] = useState<Citizen[]>([]);
  const [citizenSearch, setCitizenSearch] = useState('');
  const [selectedCitizenId, setSelectedCitizenId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [searchQ, setSearchQ] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'paid' | 'unpaid'>('all');
  const [showAdd, setShowAdd] = useState(false);
  const [editRecord, setEditRecord] = useState<ServiceRecord | null>(null);
  const [deleteRecord, setDeleteRecord] = useState<ServiceRecord | null>(null);
  const [viewImage, setViewImage] = useState<string | null>(null);
  // Revenue sharing state
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [configs, setConfigs] = useState<RevenueConfig[]>([]);
  const [assignedOfficerIds, setAssignedOfficerIds] = useState<string[]>([]);
  const [assignedNames, setAssignedNames] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  // Payment installment state
  const [paymentsByRecord, setPaymentsByRecord] = useState<Record<string, ServicePayment[]>>({});
  const [paymentRecord, setPaymentRecord] = useState<ServiceRecord | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [paymentLoading, setPaymentLoading] = useState(false);

  const [form, setForm] = useState({
    roblox_username: '',
    discord_username: '',
    service_rate_id: '',
    service_name: '',
    amount: '',
    status: 'unpaid' as 'paid' | 'unpaid',
    service_type: 'normal' as ServiceType,
    notes: '',
    service_date: new Date().toISOString().slice(0, 16),
    evidence_url: '' as string | null,
  });
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [evidencePreview, setEvidencePreview] = useState<string | null>(null);

  useEffect(() => {
    fetchAll();
    fetchCitizens();

    const recCh = supabase.channel('service_records_rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'service_records' }, () => fetchAll())
      .subscribe();
    const rateCh = supabase.channel('service_rates_rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'service_rates' }, () => fetchAll())
      .subscribe();
    const citCh = supabase.channel('citizens_rt_fees')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'citizens' }, () => fetchCitizens())
      .subscribe();
    const payCh = supabase.channel('service_payments_rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'service_payments' }, () => fetchAll())
      .subscribe();
    return () => { supabase.removeChannel(recCh); supabase.removeChannel(rateCh); supabase.removeChannel(citCh); supabase.removeChannel(payCh); };
  }, []);

  async function fetchAll() {
    const [rec, rateData, offData, cfgs] = await Promise.all([
      supabase.from('service_records').select('*').order('service_date', { ascending: false }),
      supabase.from('service_rates').select('*').eq('is_active', true).order('name'),
      supabase.from('officers').select('*').neq('status', 'deleted').order('name'),
      fetchRevenueConfigs(),
    ]);
    const recordsList = (rec.data ?? []) as ServiceRecord[];
    setRecords(recordsList);
    setRates(rateData.data ?? []);
    const officersList = (offData.data ?? []) as Officer[];
    setOfficers(officersList);
    setConfigs(cfgs);
    // สร้าง lookup map
    const officerLookup: Record<string, string> = {};
    for (const o of officersList) officerLookup[o.id] = o.name;
    // ดึงชื่อ officers ที่ assign แต่ละ record
    const namesMap: Record<string, string> = {};
    await Promise.all(recordsList.slice(0, 50).map(async (r) => {
      const names = await fetchAssignedOfficerNames(r.id, officerLookup);
      if (names) namesMap[r.id] = names;
    }));
    setAssignedNames(namesMap);
    // ดึงประวัติการชำระเงินของรายการทั้งหมด
    const paymentsMap: Record<string, ServicePayment[]> = {};
    if (recordsList.length > 0) {
      const { data: payData } = await supabase
        .from('service_payments')
        .select('*')
        .in('service_record_id', recordsList.map((r) => r.id))
        .order('created_at', { ascending: false });
      for (const p of (payData ?? []) as ServicePayment[]) {
        if (!paymentsMap[p.service_record_id]) paymentsMap[p.service_record_id] = [];
        paymentsMap[p.service_record_id].push(p);
      }
    }
    setPaymentsByRecord(paymentsMap);
    setLoading(false);
  }

  async function fetchCitizens() {
    const { data } = await supabase.from('citizens').select('*').order('roblox_username', { ascending: true });
    setCitizens(data ?? []);
  }

  const filteredCitizens = citizens.filter((c) => {
    if (!citizenSearch.trim()) return true;
    const q = citizenSearch.toLowerCase();
    return c.roblox_username.toLowerCase().includes(q) || (c.discord_username || '').toLowerCase().includes(q);
  });

  function handleCitizenSelect(citizenId: string) {
    setSelectedCitizenId(citizenId);
    const c = citizens.find((x) => x.id === citizenId);
    if (c) {
      setForm((f) => ({ ...f, roblox_username: c.roblox_username, discord_username: c.discord_username || '' }));
    }
  }

  function resetForm() {
    setForm({
      roblox_username: '', discord_username: '', service_rate_id: '',
      service_name: '', amount: '', status: 'unpaid', service_type: 'normal', notes: '',
      service_date: new Date().toISOString().slice(0, 16),
      evidence_url: null,
    });
    setEvidenceFile(null);
    setEvidencePreview(null);
    setSelectedCitizenId('');
    setAssignedOfficerIds([]);
  }

  function handleEvidenceSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setEvidenceFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setEvidencePreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!officer) return;
    if (assignedOfficerIds.length === 0) {
      alert('กรุณาเลือกเจ้าหน้าที่รับเคสอย่างน้อย 1 คน');
      return;
    }
    setUploading(true);

    let evidenceUrl = editRecord?.evidence_url ?? null;
    if (evidenceFile) {
      const uploaded = await uploadImage(evidenceFile, 'evidence');
      if (uploaded) {
        if (editRecord?.evidence_url) deleteImage(editRecord.evidence_url);
        evidenceUrl = uploaded;
      }
    } else if (!evidencePreview && editRecord?.evidence_url) {
      deleteImage(editRecord.evidence_url);
      evidenceUrl = null;
    }

    const assignedNames = assignedOfficerIds
      .map((id) => officers.find((o) => o.id === id)?.name)
      .filter(Boolean)
      .join(', ');

    const amount = parseFloat(form.amount) || 0;
    const payload = {
      roblox_username: form.roblox_username,
      discord_username: form.discord_username,
      citizen_id: selectedCitizenId || null,
      service_rate_id: form.service_rate_id || null,
      service_name: form.service_name,
      amount,
      status: form.status,
      service_type: form.service_type,
      officer_id: assignedOfficerIds[0] || officer.id,
      officer_name: assignedNames || officer.name,
      notes: form.notes,
      evidence_url: evidenceUrl,
      service_date: new Date(form.service_date).toISOString(),
      updated_at: new Date().toISOString(),
    };

    let recordId: string | null = null;
    if (editRecord) {
      recordId = editRecord.id;
      await supabase.from('service_records').update(payload).eq('id', editRecord.id);
    } else {
      const { data } = await supabase.from('service_records').insert(payload).select('id').single();
      recordId = data?.id ?? null;
    }

    if (recordId) {
      // assign officers
      await assignRecordOfficers(recordId, assignedOfficerIds, officer.id);
      // calculate revenue shares
      const scope = getScopeForCategory(form.service_name);
      const cfg = configs.find((c) => c.scope === scope);
      if (cfg) {
        await recalculateRecord(recordId, cfg.officer_share_percent);
      }
    }
    setUploading(false);
    setShowAdd(false);
    setEditRecord(null);
    resetForm();
    await fetchAll();
  }

  function openEdit(rec: ServiceRecord) {
    setEditRecord(rec);
    setSelectedCitizenId(rec.citizen_id ?? '');
    setForm({
      roblox_username: rec.roblox_username,
      discord_username: rec.discord_username,
      service_rate_id: rec.service_rate_id ?? '',
      service_name: rec.service_name,
      amount: rec.amount.toString(),
      status: rec.status,
      service_type: rec.service_type,
      notes: rec.notes,
      service_date: new Date(rec.service_date).toISOString().slice(0, 16),
      evidence_url: rec.evidence_url ?? null,
    });
    setEvidenceFile(null);
    setEvidencePreview(rec.evidence_url ?? null);
    setShowAdd(true);
    // Initialize with rec.officer_id if present
    setAssignedOfficerIds(rec.officer_id ? [rec.officer_id] : []);
    // โหลด assigned officers
    supabase
      .from('service_record_officers')
      .select('officer_id')
      .eq('service_record_id', rec.id)
      .then((res: { data: { officer_id: string }[] | null }) => {
        const rows = (res.data ?? []);
        if (rows.length > 0) {
          setAssignedOfficerIds(rows.map((r) => r.officer_id));
        }
      });
  }

  async function handleDelete() {
    if (!deleteRecord) return;
    if (deleteRecord.evidence_url) deleteImage(deleteRecord.evidence_url);
    await supabase.from('service_records').delete().eq('id', deleteRecord.id);
    setDeleteRecord(null);
    await fetchAll();
  }

  function getPaidAmount(rec: ServiceRecord) {
    return rec.paid_amount ?? 0;
  }

  function getPaymentStatus(rec: ServiceRecord) {
    const paid = getPaidAmount(rec);
    if (paid >= rec.amount) return { label: 'ชำระแล้ว', variant: 'success' as const, key: 'paid' };
    if (paid > 0) return { label: 'ชำระบางส่วน', variant: 'warning' as const, key: 'partial' };
    return { label: 'ค้างชำระ', variant: 'danger' as const, key: 'unpaid' };
  }

  function openPaymentModal(rec: ServiceRecord) {
    setPaymentRecord(rec);
    setPaymentAmount('');
    setPaymentNotes('');
  }

  async function submitPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!officer || !paymentRecord) return;
    const remaining = paymentRecord.amount - getPaidAmount(paymentRecord);
    const amount = parseFloat(paymentAmount);
    if (!amount || amount <= 0) {
      alert('กรุณาระบุจำนวนเงินที่มากกว่า 0');
      return;
    }
    if (amount > remaining) {
      alert(`ยอดชำระต้องไม่เกินยอดคงเหลือ ${formatMoney(remaining)}`);
      return;
    }
    setPaymentLoading(true);
    const { error } = await supabase.rpc('record_service_payment', {
      p_service_record_id: paymentRecord.id,
      p_amount: amount,
      p_officer_id: officer.id,
      p_officer_name: officer.name,
      p_notes: paymentNotes.trim() || null,
      p_officer_rank: officer.rank,
    });
    setPaymentLoading(false);
    if (error) {
      alert('เกิดข้อผิดพลาด: ' + error.message);
      return;
    }
    setPaymentRecord(null);
    setPaymentAmount('');
    setPaymentNotes('');
    await fetchAll();
  }

  function handleRateSelect(rateId: string) {
    const rate = rates.find((r) => r.id === rateId);
    setForm((f) => ({
      ...f,
      service_rate_id: rateId,
      service_name: rate?.name ?? f.service_name,
      amount: rate ? rate.price.toString() : f.amount,
    }));
  }

  const filtered = records.filter((r) => {
    const q = searchQ.toLowerCase();
    const matchQ = !q || r.roblox_username.toLowerCase().includes(q) || r.discord_username.toLowerCase().includes(q) || r.service_name.toLowerCase().includes(q);
    const matchStatus = filterStatus === 'all' || r.status === filterStatus;
    return matchQ && matchStatus;
  });

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('th-TH', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const formatMoney = (n: number) => n.toLocaleString('th-TH') + ' BC';

  return (
    <div>
      <PageHeader
        icon={<DollarSign size={26} />}
        title="ค่าบริการ"
        subtitle="จัดการรายการค่าบริการและหลักฐาน"
        actions={
          <button onClick={() => { setEditRecord(null); resetForm(); setShowAdd(true); }} className="btn-primary flex items-center gap-2">
            <Plus size={16} /> เพิ่มรายการ
          </button>
        }
      />

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6 relative">
        <span className="ph-corner ph-corner-tl" aria-hidden />
        <span className="ph-corner ph-corner-br" aria-hidden />
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input className="input-field pl-9" placeholder="ค้นหา Username หรือบริการ..." value={searchQ} onChange={(e) => setSearchQ(e.target.value)} />
        </div>
        <div className="flex gap-2">
          {(['all', 'unpaid', 'paid'] as const).map((s) => (
            <button key={s} onClick={() => setFilterStatus(s)} className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${filterStatus === s ? 'bg-amber-500 text-navy-900' : 'btn-secondary'}`}>
              {s === 'all' ? 'ทั้งหมด' : s === 'paid' ? 'ชำระแล้ว' : 'ค้างชำระ'}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="table-panel">
        <div className="overflow-x-auto">
          {loading ? (
            <div className="p-8 text-center text-gray-500 text-sm">กำลังโหลด...</div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center">
              <DollarSign size={36} className="text-gray-600 mx-auto mb-2" />
              <p className="text-gray-400 text-sm">ไม่พบรายการ</p>
            </div>
          ) : (
            <table className="w-full">
              <thead className="table-header-gold">
                <tr className="border-b border-amber-500/15">
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase">ประชาชน</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase">บริการ</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase">วันที่</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase">เจ้าหน้าที่</th>
                  <th className="text-right px-5 py-3 text-xs font-medium text-gray-500 uppercase">ยอด</th>
                  <th className="text-right px-5 py-3 text-xs font-medium text-gray-500 uppercase">ชำระแล้ว</th>
                  <th className="text-right px-5 py-3 text-xs font-medium text-gray-500 uppercase">ค้างชำระ</th>
                  <th className="text-center px-5 py-3 text-xs font-medium text-gray-500 uppercase">ประเภท</th>
                  <th className="text-center px-5 py-3 text-xs font-medium text-gray-500 uppercase">สถานะ</th>
                  <th className="text-center px-5 py-3 text-xs font-medium text-gray-500 uppercase">หลักฐาน</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((rec) => (
                  <tr key={rec.id} className="table-row">
                    <td className="px-5 py-4">
                      {rec.roblox_username && <div className="text-white text-sm">{rec.roblox_username}</div>}
                      {rec.discord_username && <div className="text-gray-400 text-xs">{rec.discord_username}</div>}
                    </td>
                    <td className="px-5 py-4">
                      <div className="text-white text-sm font-medium">{rec.service_name}</div>
                      {rec.notes && <div className="text-gray-500 text-xs">{rec.notes}</div>}
                    </td>
                    <td className="px-5 py-4 text-sm text-gray-400 whitespace-nowrap">{formatDate(rec.service_date)}</td>
                    <td className="px-5 py-4 text-sm text-gray-400">{assignedNames[rec.id] || rec.officer_name}</td>
                    <td className="px-5 py-4 text-right text-sm font-semibold text-white whitespace-nowrap">{formatMoney(rec.amount)}</td>
                    <td className="px-5 py-4 text-right text-sm font-medium text-emerald-400 whitespace-nowrap">{formatMoney(getPaidAmount(rec))}</td>
                    <td className="px-5 py-4 text-right text-sm font-medium text-red-400 whitespace-nowrap">{formatMoney(Math.max(0, rec.amount - getPaidAmount(rec)))}</td>
                    <td className="px-5 py-4 text-center">
                      <Badge variant={rec.service_type === 'impound' ? 'danger' : 'info'}>
                        {rec.service_type === 'impound' ? 'ยึด' : 'ปกติ'}
                      </Badge>
                    </td>
                    <td className="px-5 py-4 text-center">
                      {(() => {
                        const ps = getPaymentStatus(rec);
                        return <Badge variant={ps.variant}>{ps.label}</Badge>;
                      })()}
                    </td>
                    <td className="px-5 py-4 text-center">
                      {rec.evidence_url ? (
                        <button
                          onClick={() => setViewImage(rec.evidence_url)}
                          className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-blue-500/15 text-blue-400 hover:bg-blue-500/25 transition-colors"
                          title="ดูรูปหลักฐาน"
                        >
                          <Eye size={15} />
                        </button>
                      ) : (
                        <span className="text-gray-600 text-xs">-</span>
                      )}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-1 justify-end">
                        {(() => {
                          const canEdit = isCommissioner || (officer && rec.officer_id === officer.id);
                          if (!canEdit) return <span className="text-gray-600 text-xs" title="ไม่สามารถแก้ไขได้ เฉพาะผู้ที่สร้างรายการนี้เท่านั้น">—</span>;
                          return (
                            <>
                              {isCommissioner && getPaidAmount(rec) < rec.amount && (
                                <button onClick={() => openPaymentModal(rec)} className="p-1.5 rounded text-gray-500 hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors" title="บันทึกการชำระเงิน">
                                  <Banknote size={16} />
                                </button>
                              )}
                              <button onClick={() => openEdit(rec)} className="p-1.5 rounded text-gray-500 hover:text-amber-400 hover:bg-amber-500/10 transition-colors" title="แก้ไข">
                                <Edit2 size={14} />
                              </button>
                              {isCommissioner && (
                                <button onClick={() => setDeleteRecord(rec)} className="p-1.5 rounded text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors" title="ลบ">
                                  <Trash2 size={14} />
                                </button>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Add/Edit Modal */}
      {showAdd && (
        <Modal title={editRecord ? 'แก้ไขรายการค่าบริการ' : 'เพิ่มรายการค่าบริการ'} onClose={() => { setShowAdd(false); setEditRecord(null); resetForm(); }} size="lg">
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Citizen Selector */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">เลือกประชาชน (จากระบบจัดการประชาชน)</label>
              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  className="input-field pl-9 mb-2"
                  placeholder="ค้นหาชื่อ Roblox หรือ Discord..."
                  value={citizenSearch}
                  onChange={(e) => setCitizenSearch(e.target.value)}
                />
              </div>
              <select
                className="input-field"
                value={selectedCitizenId}
                onChange={(e) => handleCitizenSelect(e.target.value)}
              >
                <option value="">-- เลือกประชาชน (หรือกรอกชื่อด้วยตัวเองด้านล่าง) --</option>
                {filteredCitizens.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.roblox_username}{c.discord_username ? ' (@' + c.discord_username + ')' : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Roblox Username</label>
                <input className="input-field" placeholder="ชื่อ Roblox" value={form.roblox_username} onChange={(e) => setForm({ ...form, roblox_username: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Discord Username</label>
                <input className="input-field" placeholder="ชื่อ Discord" value={form.discord_username} onChange={(e) => setForm({ ...form, discord_username: e.target.value })} />
              </div>
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">ประเภทบริการ (เลือกจากรายการเพื่อกรอกชื่อและราคาอัตโนมัติ)</label>
              <select className="input-field" value={form.service_rate_id} onChange={(e) => handleRateSelect(e.target.value)}>
                <option value="">-- เลือกประเภทบริการ (หรือพิมพ์ชื่อบริการเองด้านล่าง) --</option>
                {Object.entries(
                  rates.reduce<Record<string, ServiceRate[]>>((acc, r) => {
                    const cat = r.category || 'general';
                    if (!acc[cat]) acc[cat] = [];
                    acc[cat].push(r);
                    return acc;
                  }, {})
                ).map(([cat, catRates]) => (
                  <optgroup key={cat} label={`${SERVICE_CATEGORIES[cat]?.icon ?? '📋'} ${SERVICE_CATEGORIES[cat]?.label ?? cat}`}>
                    {catRates.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name} — {r.price.toLocaleString('th-TH')} BC
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1">ชื่อบริการ *</label>
                <input className="input-field" required placeholder="ชื่อบริการ" value={form.service_name} onChange={(e) => setForm({ ...form, service_name: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">ราคา (BC) *</label>
                <input type="number" className="input-field" required placeholder="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
              </div>
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">ประเภทการบริการ</label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setForm({ ...form, service_type: 'normal' })}
                  className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border-2 text-sm font-medium transition-all ${
                    form.service_type === 'normal'
                      ? 'bg-blue-500/15 border-blue-500/40 text-blue-400'
                      : 'bg-navy-900 border-amber-500/15 text-gray-500 hover:border-blue-700/50'
                  }`}
                >
                  <Car size={16} /> ปกติ
                </button>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, service_type: 'impound' })}
                  className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border-2 text-sm font-medium transition-all ${
                    form.service_type === 'impound'
                      ? 'bg-red-500/15 border-red-500/40 text-red-400'
                      : 'bg-navy-900 border-amber-500/15 text-gray-500 hover:border-red-700/50'
                  }`}
                >
                  <Lock size={16} /> ยึด
                </button>
              </div>
            </div>

            {/* เจ้าหน้าที่รับเคส (required) */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">
                <Users size={12} className="inline mr-1" />
                เจ้าหน้าที่รับเคส * <span className="text-amber-400">(อย่างน้อย 1 คน)</span>
              </label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {assignedOfficerIds.map((oid) => {
                  const o = officers.find((x) => x.id === oid);
                  if (!o) return null;
                  return (
                    <span key={oid} className="inline-flex items-center gap-1 px-2 py-1 bg-blue-500/15 border border-blue-500/30 rounded text-xs text-blue-300">
                      {o.name}
                      <button type="button" onClick={() => setAssignedOfficerIds((p) => p.filter((x) => x !== oid))} className="hover:text-red-400">
                        <X size={12} />
                      </button>
                    </span>
                  );
                })}
                {assignedOfficerIds.length === 0 && <span className="text-xs text-gray-500">ยังไม่ได้เลือก</span>}
              </div>
              <select
                className="input-field text-sm"
                value=""
                onChange={(e) => {
                  const v = e.target.value;
                  if (v && !assignedOfficerIds.includes(v)) {
                    setAssignedOfficerIds((p) => [...p, v]);
                  }
                  e.target.value = '';
                }}
              >
                <option value="">+ เพิ่มเจ้าหน้าที่</option>
                {officers
                  .filter((o) => !assignedOfficerIds.includes(o.id))
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name} ({o.rank})
                    </option>
                  ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1">วันที่ให้บริการ</label>
                <input type="datetime-local" className="input-field" value={form.service_date} onChange={(e) => setForm({ ...form, service_date: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">สถานะ</label>
                <select className="input-field" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as 'paid' | 'unpaid' })}>
                  <option value="unpaid">ค้างชำระ</option>
                  <option value="paid">ชำระแล้ว</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">หมายเหตุ</label>
              <textarea className="input-field" rows={2} placeholder="หมายเหตุ..." value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>

            {/* Evidence Image Upload */}
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">รูปภาพหลักฐานการใช้บริการ</label>
              {evidencePreview ? (
                <div className="relative group">
                  <img src={evidencePreview} alt="evidence" className="w-full max-h-56 object-contain rounded-lg border border-blue-900/50 bg-navy-900" />
                  <button
                    type="button"
                    onClick={() => { setEvidencePreview(null); setEvidenceFile(null); }}
                    className="absolute top-2 right-2 w-7 h-7 bg-red-600 rounded-lg flex items-center justify-center opacity-90 hover:opacity-100"
                  >
                    <X size={16} className="text-white" />
                  </button>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center gap-2 py-6 border-2 border-dashed border-blue-900/50 rounded-lg cursor-pointer hover:border-amber-500/40 hover:bg-navy-700/30 transition-all">
                  <Upload size={24} className="text-gray-600" />
                  <span className="text-xs text-gray-500">คลิกเพื่ออัปโหลดสลิป / ใบเสร็จ / รูปหลักฐาน</span>
                  <input type="file" accept="image/*" className="hidden" onChange={handleEvidenceSelect} />
                </label>
              )}
            </div>

            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => { setShowAdd(false); setEditRecord(null); resetForm(); }} className="btn-secondary flex-1">ยกเลิก</button>
              <button type="submit" disabled={uploading} className="btn-primary flex-1 disabled:opacity-50">
                {uploading ? 'กำลังอัปโหลด...' : editRecord ? 'บันทึกการแก้ไข' : 'เพิ่มรายการ'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Image Viewer Modal */}
      {viewImage && (
        <Modal title="รูปภาพหลักฐาน" onClose={() => setViewImage(null)} size="lg">
          <div className="flex justify-center">
            <img src={viewImage} alt="evidence" className="max-w-full max-h-[60vh] rounded-lg object-contain" />
          </div>
          <div className="mt-4 flex justify-center">
            <a href={viewImage} download className="btn-secondary flex items-center gap-2">
              <ImageIcon size={16} /> ดาวน์โหลดรูปภาพ
            </a>
          </div>
        </Modal>
      )}

      {/* Payment Modal */}
      {paymentRecord && (
        <Modal title={`บันทึกการชำระเงิน — ${paymentRecord.service_name}`} onClose={() => setPaymentRecord(null)} size="md">
          <form onSubmit={submitPayment} className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="card p-3 text-center">
                <div className="text-xs text-gray-400">ยอดเต็ม</div>
                <div className="text-lg font-bold text-white">{formatMoney(paymentRecord.amount)}</div>
              </div>
              <div className="card p-3 text-center">
                <div className="text-xs text-gray-400">ชำระแล้ว</div>
                <div className="text-lg font-bold text-emerald-400">{formatMoney(getPaidAmount(paymentRecord))}</div>
              </div>
              <div className="card p-3 text-center">
                <div className="text-xs text-gray-400">ค้างชำระ</div>
                <div className="text-lg font-bold text-red-400">{formatMoney(Math.max(0, paymentRecord.amount - getPaidAmount(paymentRecord)))}</div>
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">จำนวนเงินที่ชำระครั้งนี้ (BC) *</label>
              <input
                type="number"
                className="input-field"
                placeholder="0"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
                min={0.01}
                step="0.01"
                max={Math.max(0, paymentRecord.amount - getPaidAmount(paymentRecord))}
                required
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">หมายเหตุ</label>
              <textarea className="input-field" rows={2} placeholder="หมายเหตุการชำระเงิน..." value={paymentNotes} onChange={(e) => setPaymentNotes(e.target.value)} />
            </div>
            {paymentsByRecord[paymentRecord.id] && paymentsByRecord[paymentRecord.id].length > 0 && (
              <div className="card p-3 space-y-2">
                <h4 className="text-xs font-semibold text-white">ประวัติการชำระเงิน</h4>
                {paymentsByRecord[paymentRecord.id].map((p) => (
                  <div key={p.id} className="flex justify-between text-xs">
                    <span className="text-gray-400">{formatDate(p.created_at)} {p.recorded_by_name ? `— ${p.recorded_by_name}` : ''}</span>
                    <span className="text-emerald-400 font-semibold">{formatMoney(p.amount)}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setPaymentRecord(null)} className="btn-secondary flex-1">ยกเลิก</button>
              <button type="submit" disabled={paymentLoading} className="btn-primary flex-1 disabled:opacity-50">
                {paymentLoading ? 'กำลังบันทึก...' : 'บันทึกการชำระเงิน'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Delete Confirm */}
      {deleteRecord && (
        <ConfirmDialog
          title="ลบรายการค่าบริการ"
          message={`ต้องการลบรายการ "${deleteRecord.service_name}" ของ ${deleteRecord.roblox_username || deleteRecord.discord_username} ใช่หรือไม่?`}
          confirmLabel="ลบ"
          danger
          onConfirm={handleDelete}
          onCancel={() => setDeleteRecord(null)}
        />
      )}
    </div>
  );
}
