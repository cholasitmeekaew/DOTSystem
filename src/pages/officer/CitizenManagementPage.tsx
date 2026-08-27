import { ReactNode, useEffect, useMemo, useState } from 'react';
import {
  Search, UserCog, Plus, Edit2, Trash2, Car, CreditCard, X,
  AlertCircle, CheckCircle2, Lock, User, FileText, Clock, MapPin,
  Bike, Truck as TowTruck, CarFront, Shield, Save, DollarSign, Eye, Upload,
  BarChart3, BriefcaseBusiness, ChevronUp, ChevronDown,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { uploadImage, deleteImage } from '../../lib/storage';
import {
  Citizen, CitizenStatus, Vehicle, License, ServiceRecord, ServiceRate, ServiceType,
  VEHICLE_TYPE_LABELS, VEHICLE_CATEGORY_LABELS, CITIZEN_STATUS_LABELS,
  VehicleType, VEHICLE_BRAND_MODELS, VEHICLE_COLORS,
} from '../../lib/types';
import { useAuth } from '../../lib/AuthContext';
import { Badge } from '../../components/Badge';
import { Modal, ConfirmDialog } from '../../components/Modal';
import { PageHeader } from '../../components/PageHeader';
import { RankedList, type RankItem } from '../../components/RankedList';
import { SERVICE_CATEGORIES } from './ServiceRatesPage';

type Tab = 'overview' | 'vehicles' | 'licenses' | 'fees';

export function CitizenManagementPage() {
  const { officer, isCommissioner } = useAuth();
  const [tab, setTab] = useState<Tab>('overview');
  const [searchQ, setSearchQ] = useState('');
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);

  const [citizens, setCitizens] = useState<Citizen[]>([]);
  const [selectedCitizen, setSelectedCitizen] = useState<Citizen | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [licenses, setLicenses] = useState<License[]>([]);
  const [feeRecords, setFeeRecords] = useState<ServiceRecord[]>([]);
  const [rates, setRates] = useState<ServiceRate[]>([]);

  const [showCitizenForm, setShowCitizenForm] = useState(false);
  const [editingCitizen, setEditingCitizen] = useState<Citizen | null>(null);
  const [citizenForm, setCitizenForm] = useState({ roblox_username: '', discord_username: '', status: 'normal' as CitizenStatus, notes: '' });

  const [showVehicleForm, setShowVehicleForm] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);
  const [vehicleForm, setVehicleForm] = useState({
    license_plate: '', owner_name: '', vehicle_type: 'sedan' as VehicleType,
    color: '', brand: '', model: '', brand_model: '', vehicle_category: 'personal', is_impounded: false,
    impound_reason: '', impound_location: '', notes: '',
  });

  const [showLicenseForm, setShowLicenseForm] = useState(false);
  const [editingLicense, setEditingLicense] = useState<License | null>(null);
  const [licenseForm, setLicenseForm] = useState({
    license_type: 'driver', license_number: '', issue_date: '', expiry_date: '',
    status: 'active', notes: '',
  });

  const [showFeeForm, setShowFeeForm] = useState(false);
  const [editingFee, setEditingFee] = useState<ServiceRecord | null>(null);
  const [feeForm, setFeeForm] = useState({
    service_rate_id: '', service_name: '', amount: '',
    status: 'unpaid' as 'paid' | 'unpaid', service_type: 'normal' as ServiceType,
    notes: '', service_date: new Date().toISOString().slice(0, 16),
  });
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [evidencePreview, setEvidencePreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const [confirmDelete, setConfirmDelete] = useState<{ type: 'citizen' | 'vehicle' | 'license' | 'fee'; id: string; name: string } | null>(null);
  const [allRecords, setAllRecords] = useState<ServiceRecord[]>([]);
  const [showDash, setShowDash] = useState(true);
  const [dashSortAmount, setDashSortAmount] = useState<'desc' | 'asc'>('desc');
  const [dashSortDays, setDashSortDays] = useState<'desc' | 'asc'>('desc');
  const [dashSortUsage, setDashSortUsage] = useState<'desc' | 'asc'>('desc');

  useEffect(() => {
    fetchCitizens();
    fetchRates();
    fetchRecords();

    const citCh = supabase.channel('citizens_rt_mgmt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'citizens' }, () => fetchCitizens())
      .subscribe();
    const rateCh = supabase.channel('service_rates_rt_mgmt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'service_rates' }, () => fetchRates())
      .subscribe();
    const recCh = supabase.channel('service_records_rt_stats')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'service_records' }, () => fetchRecords())
      .subscribe();
    return () => { supabase.removeChannel(citCh); supabase.removeChannel(rateCh); supabase.removeChannel(recCh); };
  }, []);

  async function fetchRecords() {
    const { data } = await supabase.from('service_records').select('*');
    setAllRecords(data ?? []);
  }

  const citizenName = (id: string | null) =>
    id ? (citizens.find((c) => c.id === id)?.roblox_username ?? 'ไม่ทราบชื่อ') : 'ไม่ระบุตัวตน';

  const dashOverdueAmount = useMemo<RankItem[]>(() => {
    const map = new Map<string, { amount: number; count: number }>();
    for (const r of allRecords) {
      if (!r.citizen_id || r.status !== 'unpaid') continue;
      const cur = map.get(r.citizen_id) ?? { amount: 0, count: 0 };
      cur.amount += r.amount;
      cur.count += 1;
      map.set(r.citizen_id, cur);
    }
    return [...map.entries()]
      .sort((a, b) => b[1].amount - a[1].amount)
      .map(([cid, s]) => ({
        id: cid,
        primary: citizenName(cid),
        value: `${s.amount.toLocaleString('th-TH')} BC`,
        subValue: `${s.count} รายการ`,
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRecords, citizens]);

  const dashOverdueDays = useMemo<RankItem[]>(() => {
    const now = Date.now();
    const map = new Map<string, { oldest: number; amount: number }>();
    for (const r of allRecords) {
      if (!r.citizen_id || r.status !== 'unpaid') continue;
      const dateStr = r.service_date || r.created_at;
      const t = dateStr ? new Date(dateStr).getTime() : NaN;
      if (Number.isNaN(t)) continue;
      const cur = map.get(r.citizen_id);
      if (!cur || t < cur.oldest) map.set(r.citizen_id, { oldest: t, amount: cur ? cur.amount + r.amount : r.amount });
      else cur.amount += r.amount;
    }
    return [...map.entries()]
      .map(([cid, v]) => ({ cid, days: Math.max(0, Math.floor((now - v.oldest) / 86_400_000)), amount: v.amount }))
      .sort((a, b) => b.days - a.days || b.amount - a.amount)
      .map(({ cid, days, amount }) => ({
        id: cid,
        primary: citizenName(cid),
        value: `${days.toLocaleString('th-TH')} วัน`,
        subValue: `${amount.toLocaleString('th-TH')} BC`,
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRecords, citizens]);

  const dashUsage = useMemo<RankItem[]>(() => {
    const map = new Map<string, { count: number; total: number }>();
    for (const r of allRecords) {
      if (!r.citizen_id) continue;
      const cur = map.get(r.citizen_id) ?? { count: 0, total: 0 };
      cur.count += 1;
      cur.total += r.amount;
      map.set(r.citizen_id, cur);
    }
    return [...map.entries()]
      .filter(([, v]) => v.count > 0)
      .sort((a, b) => b[1].count - a[1].count || b[1].total - a[1].total)
      .map(([cid, v]) => ({
        id: cid,
        primary: citizenName(cid),
        value: `${v.count} ครั้ง`,
        subValue: `${v.total.toLocaleString('th-TH')} BC`,
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRecords, citizens]);

  function jumpToCitizen(item: RankItem) {
    const c = citizens.find((x) => x.id === item.id);
    if (c) selectCitizen(c);
  }

  async function fetchCitizens() {
    setLoading(true);
    const { data } = await supabase.from('citizens').select('*').order('updated_at', { ascending: false });
    setCitizens(data ?? []);
    setLoading(false);
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!searchQ.trim()) { setSearched(true); return; }
    setLoading(true);
    const q = searchQ.trim();
    const { data } = await supabase
      .from('citizens')
      .select('*')
      .or('roblox_username.ilike.%' + q + '%,discord_username.ilike.%' + q + '%')
      .order('updated_at', { ascending: false });
    setCitizens(data ?? []);
    setSearched(true);
    setLoading(false);
  }

  async function selectCitizen(c: Citizen) {
    setSelectedCitizen(c);
    setTab('overview');
    await Promise.all([fetchVehicles(c.id), fetchLicenses(c.id), fetchFees(c.id)]);
  }

  useEffect(() => {
    if (!selectedCitizen) return;
    const vehCh = supabase.channel('vehicles_rt_' + selectedCitizen.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicles', filter: 'citizen_id=eq.' + selectedCitizen.id }, () => fetchVehicles(selectedCitizen.id))
      .subscribe();
    const licCh = supabase.channel('licenses_rt_' + selectedCitizen.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'licenses', filter: 'citizen_id=eq.' + selectedCitizen.id }, () => fetchLicenses(selectedCitizen.id))
      .subscribe();
    const feeCh = supabase.channel('fees_rt_' + selectedCitizen.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'service_records', filter: 'citizen_id=eq.' + selectedCitizen.id }, () => fetchFees(selectedCitizen.id))
      .subscribe();
    return () => { supabase.removeChannel(vehCh); supabase.removeChannel(licCh); supabase.removeChannel(feeCh); };
  }, [selectedCitizen?.id]);

  async function fetchVehicles(citizenId: string) {
    const { data } = await supabase.from('vehicles').select('*').eq('citizen_id', citizenId).order('created_at', { ascending: false });
    setVehicles(data ?? []);
  }

  async function fetchLicenses(citizenId: string) {
    const { data } = await supabase.from('licenses').select('*').eq('citizen_id', citizenId).order('created_at', { ascending: false });
    setLicenses(data ?? []);
  }

  async function fetchFees(citizenId: string) {
    const { data } = await supabase.from('service_records').select('*').eq('citizen_id', citizenId).order('service_date', { ascending: false });
    setFeeRecords(data ?? []);
  }

  async function fetchRates() {
    const { data } = await supabase.from('service_rates').select('*').eq('is_active', true).order('name');
    setRates(data ?? []);
  }

  /* ===== Citizen CRUD ===== */
  function openAddCitizen() {
    setEditingCitizen(null);
    setCitizenForm({ roblox_username: '', discord_username: '', status: 'normal', notes: '' });
    setShowCitizenForm(true);
  }

  function openEditCitizen(c: Citizen) {
    setEditingCitizen(c);
    setCitizenForm({ roblox_username: c.roblox_username, discord_username: c.discord_username || '', status: c.status, notes: c.notes || '' });
    setShowCitizenForm(true);
  }

  async function handleCitizenSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!citizenForm.roblox_username.trim()) return;
    if (editingCitizen) {
      await supabase.from('citizens').update({
        roblox_username: citizenForm.roblox_username.trim(),
        discord_username: citizenForm.discord_username.trim() || null,
        status: citizenForm.status,
        notes: citizenForm.notes.trim() || null,
        updated_at: new Date().toISOString(),
      }).eq('id', editingCitizen.id);
      if (selectedCitizen?.id === editingCitizen.id) {
        setSelectedCitizen({ ...editingCitizen, ...citizenForm, discord_username: citizenForm.discord_username.trim() || null, notes: citizenForm.notes.trim() || null });
      }
    } else {
      const { data } = await supabase.from('citizens').insert({
        roblox_username: citizenForm.roblox_username.trim(),
        discord_username: citizenForm.discord_username.trim() || null,
        status: citizenForm.status,
        notes: citizenForm.notes.trim() || null,
      }).select().single();
      if (data) await selectCitizen(data);
    }
    setShowCitizenForm(false);
    await fetchCitizens();
  }

  async function deleteCitizen(id: string) {
    await supabase.from('citizens').delete().eq('id', id);
    if (selectedCitizen?.id === id) {
      setSelectedCitizen(null);
      setVehicles([]);
      setLicenses([]);
    }
    await fetchCitizens();
  }

  /* ===== Vehicle CRUD ===== */
  function openAddVehicle() {
    if (!selectedCitizen) return;
    setEditingVehicle(null);
    setVehicleForm({
      license_plate: '', owner_name: selectedCitizen.roblox_username,
      vehicle_type: 'sedan' as VehicleType, color: '', brand: '', model: '', brand_model: '',
      vehicle_category: 'personal', is_impounded: false,
      impound_reason: '', impound_location: '', notes: '',
    });
    setShowVehicleForm(true);
  }

  function openEditVehicle(v: Vehicle) {
    setEditingVehicle(v);
    const brandModel = v.brand_model || '';
    let brand = '';
    let model = '';
    for (const [b, models] of Object.entries(VEHICLE_BRAND_MODELS)) {
      if (brandModel.startsWith(b + ' ')) {
        brand = b;
        model = brandModel.slice(b.length + 1);
        break;
      } else if (brandModel === b) {
        brand = b;
        model = '';
        break;
      }
    }
    if (!brand && brandModel) {
      brand = 'อื่นๆ';
      model = brandModel;
    }
    setVehicleForm({
      license_plate: v.license_plate, owner_name: v.owner_name || '',
      vehicle_type: v.vehicle_type, color: v.color || '', brand, model, brand_model: brandModel,
      vehicle_category: v.vehicle_category || 'personal', is_impounded: v.is_impounded,
      impound_reason: v.impound_reason || '', impound_location: v.impound_location || '',
      notes: v.notes || '',
    });
    setShowVehicleForm(true);
  }

  async function handleVehicleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedCitizen || !vehicleForm.license_plate.trim()) return;
    const brandModel = vehicleForm.brand === 'อื่นๆ'
      ? vehicleForm.model.trim()
      : [vehicleForm.brand, vehicleForm.model].filter(Boolean).join(' ').trim();
    const payload = {
      license_plate: vehicleForm.license_plate.trim().toUpperCase().split(' ').join(''),
      owner_name: vehicleForm.owner_name.trim() || null,
      vehicle_type: vehicleForm.vehicle_type,
      color: vehicleForm.color || null,
      brand_model: brandModel || null,
      vehicle_category: vehicleForm.vehicle_category,
      citizen_id: selectedCitizen.id,
      is_impounded: vehicleForm.is_impounded,
      impound_reason: vehicleForm.is_impounded ? (vehicleForm.impound_reason.trim() || null) : null,
      impound_location: vehicleForm.is_impounded ? (vehicleForm.impound_location.trim() || null) : null,
      impounded_at: vehicleForm.is_impounded && !editingVehicle?.is_impounded ? new Date().toISOString() : editingVehicle?.impounded_at || null,
      impounded_by: vehicleForm.is_impounded && !editingVehicle?.is_impounded ? officer?.id : editingVehicle?.impounded_by || null,
      impounded_by_name: vehicleForm.is_impounded && !editingVehicle?.is_impounded ? officer?.name : editingVehicle?.impounded_by_name || null,
      notes: vehicleForm.notes.trim() || null,
      updated_at: new Date().toISOString(),
    };
    if (editingVehicle) {
      await supabase.from('vehicles').update(payload).eq('id', editingVehicle.id);
    } else {
      await supabase.from('vehicles').insert(payload);
    }
    setShowVehicleForm(false);
    await fetchVehicles(selectedCitizen.id);
  }

  async function deleteVehicle(id: string) {
    if (!selectedCitizen) return;
    await supabase.from('vehicles').delete().eq('id', id);
    await fetchVehicles(selectedCitizen.id);
  }

  /* ===== License CRUD ===== */
  function openAddLicense() {
    if (!selectedCitizen) return;
    setEditingLicense(null);
    setLicenseForm({
      license_type: 'driver', license_number: '',
      issue_date: new Date().toISOString().split('T')[0],
      expiry_date: '', status: 'active', notes: '',
    });
    setShowLicenseForm(true);
  }

  function openEditLicense(l: License) {
    setEditingLicense(l);
    setLicenseForm({
      license_type: l.license_type, license_number: l.license_number || '',
      issue_date: l.issue_date ? l.issue_date.split('T')[0] : '',
      expiry_date: l.expiry_date ? l.expiry_date.split('T')[0] : '',
      status: l.status, notes: l.notes || '',
    });
    setShowLicenseForm(true);
  }

  async function handleLicenseSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedCitizen) return;
    const payload = {
      roblox_username: selectedCitizen.roblox_username,
      discord_username: selectedCitizen.discord_username,
      citizen_id: selectedCitizen.id,
      license_type: licenseForm.license_type,
      license_number: licenseForm.license_number.trim() || null,
      issue_date: licenseForm.issue_date ? new Date(licenseForm.issue_date).toISOString() : new Date().toISOString(),
      expiry_date: licenseForm.expiry_date ? new Date(licenseForm.expiry_date).toISOString() : null,
      status: licenseForm.status,
      notes: licenseForm.notes.trim() || null,
      issued_by: editingLicense?.issued_by ?? officer?.id ?? null,
      issued_by_name: editingLicense?.issued_by_name ?? officer?.name ?? null,
      updated_at: new Date().toISOString(),
    };
    if (editingLicense) {
      await supabase.from('licenses').update(payload).eq('id', editingLicense.id);
    } else {
      await supabase.from('licenses').insert(payload);
    }
    setShowLicenseForm(false);
    await fetchLicenses(selectedCitizen.id);
  }

  async function deleteLicense(id: string) {
    if (!selectedCitizen) return;
    await supabase.from('licenses').delete().eq('id', id);
    await fetchLicenses(selectedCitizen.id);
  }

  /* ===== Fee CRUD ===== */
  function openAddFee() {
    if (!selectedCitizen) return;
    setEditingFee(null);
    setFeeForm({
      service_rate_id: '', service_name: '', amount: '',
      status: 'unpaid', service_type: 'normal',
      notes: '', service_date: new Date().toISOString().slice(0, 16),
    });
    setEvidenceFile(null);
    setEvidencePreview(null);
    setShowFeeForm(true);
  }

  function openEditFee(f: ServiceRecord) {
    setEditingFee(f);
    setFeeForm({
      service_rate_id: f.service_rate_id ?? '',
      service_name: f.service_name, amount: f.amount.toString(),
      status: f.status, service_type: f.service_type,
      notes: f.notes, service_date: new Date(f.service_date).toISOString().slice(0, 16),
    });
    setEvidenceFile(null);
    setEvidencePreview(f.evidence_url ?? null);
    setShowFeeForm(true);
  }

  function handleEvidenceSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setEvidenceFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setEvidencePreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  }

  function handleRateSelect(rateId: string) {
    const rate = rates.find((r) => r.id === rateId);
    setFeeForm((f) => ({
      ...f,
      service_rate_id: rateId,
      service_name: rate?.name ?? f.service_name,
      amount: rate ? rate.price.toString() : f.amount,
    }));
  }

  async function handleFeeSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedCitizen || !feeForm.service_name.trim()) return;
    setUploading(true);

    let evidenceUrl = editingFee?.evidence_url ?? null;
    if (evidenceFile) {
      const uploaded = await uploadImage(evidenceFile, 'evidence');
      if (uploaded) {
        if (editingFee?.evidence_url) deleteImage(editingFee.evidence_url);
        evidenceUrl = uploaded;
      }
    } else if (!evidencePreview && editingFee?.evidence_url) {
      deleteImage(editingFee.evidence_url);
      evidenceUrl = null;
    }

    const payload = {
      roblox_username: selectedCitizen.roblox_username,
      discord_username: selectedCitizen.discord_username || '',
      citizen_id: selectedCitizen.id,
      service_rate_id: feeForm.service_rate_id || null,
      service_name: feeForm.service_name,
      amount: parseFloat(feeForm.amount) || 0,
      status: feeForm.status,
      service_type: feeForm.service_type,
      officer_id: officer?.id ?? null,
      officer_name: officer?.name ?? '',
      notes: feeForm.notes,
      evidence_url: evidenceUrl,
      service_date: new Date(feeForm.service_date).toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (editingFee) {
      await supabase.from('service_records').update(payload).eq('id', editingFee.id);
    } else {
      await supabase.from('service_records').insert(payload);
    }
    setUploading(false);
    setShowFeeForm(false);
    await fetchFees(selectedCitizen.id);
  }

  async function toggleFeeStatus(f: ServiceRecord) {
    if (!isCommissioner && officer && f.officer_id !== officer.id) return;
    const newStatus = f.status === 'paid' ? 'unpaid' : 'paid';
    await supabase.from('service_records').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', f.id);
    setFeeRecords((prev) => prev.map((r) => r.id === f.id ? { ...r, status: newStatus } : r));
  }

  async function deleteFee(id: string) {
    if (!selectedCitizen) return;
    const rec = feeRecords.find((r) => r.id === id);
    if (rec?.evidence_url) deleteImage(rec.evidence_url);
    await supabase.from('service_records').delete().eq('id', id);
    await fetchFees(selectedCitizen.id);
  }

  const [viewFeeImage, setViewFeeImage] = useState<string | null>(null);

  const formatDate = (iso: string | null) => {
    if (!iso) return '-';
    return new Date(iso).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const vehicleIcon = (type: string) => {
    switch (type) {
      case 'motorcycle': return <Bike size={16} />;
      case 'pickup': return <TowTruck size={16} />;
      case 'truck': return <TowTruck size={16} />;
      case 'van': return <CarFront size={16} />;
      default: return <Car size={16} />;
    }
  };

  const formatMoney = (n: number) => Number(n).toLocaleString('th-TH') + ' BC';

  const tabs: { id: Tab; label: string; icon: ReactNode }[] = [
    { id: 'overview', label: 'ข้อมูลรวม', icon: <User size={16} /> },
    { id: 'vehicles', label: 'ยานพาหนะ', icon: <Car size={16} /> },
    { id: 'licenses', label: 'ใบอนุญาต', icon: <CreditCard size={16} /> },
    { id: 'fees', label: 'ค่าบริการ', icon: <DollarSign size={16} /> },
  ];

  return (
    <div>
      <PageHeader
        icon={<UserCog size={26} />}
        title="จัดการข้อมูลประชาชน"
        subtitle="ค้นหาและจัดการข้อมูลประชาชน — สำหรับหัวหน้ากรมเท่านั้น"
        actions={
          <button onClick={openAddCitizen} className="btn-primary flex items-center gap-2">
            <Plus size={16} /> เพิ่มประชาชน
          </button>
        }
      />

      {/* Search */}
      <form onSubmit={handleSearch} className="card p-4 mb-6">
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              className="input-field pl-9"
              placeholder="ค้นหาด้วย Roblox หรือ Discord Username..."
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
            />
          </div>
          <button type="submit" disabled={loading} className="btn-primary px-6">
            {loading ? 'กำลังค้นหา...' : 'ค้นหา'}
          </button>
        </div>
      </form>

      {/* Summary Dashboard */}
      <div className="card overflow-hidden mb-6">
        <button
          onClick={() => setShowDash((v) => !v)}
          className="ph-panel-head w-full flex items-center justify-between gap-2"
        >
          <span className="flex items-center gap-2">
            <span className="ph-corner ph-corner-tl" aria-hidden />
            <BarChart3 size={15} className="text-amber-400" />
            <span className="text-xs font-bold text-white tracking-wide">แดชบอร์ดสรุปข้อมูลประชาชน</span>
          </span>
          {showDash ? <ChevronUp size={15} className="text-gray-400" /> : <ChevronDown size={15} className="text-gray-400" />}
        </button>
        {showDash && (
          <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Overdue Amount */}
            <div className="card overflow-hidden flex flex-col">
              <div className="ph-panel-head flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <span className="ph-corner ph-corner-tl" aria-hidden />
                  <span className="ph-corner ph-corner-br" aria-hidden />
                  <DollarSign size={13} className="text-amber-400" />
                  <h3 className="text-xs font-bold text-white tracking-wide">ค้างชำระ (ยอดเงิน)</h3>
                </span>
                <div className="gold-toggle">
                  <button className={dashSortAmount === 'desc' ? 'active' : ''} onClick={(e) => { e.stopPropagation(); setDashSortAmount('desc'); }}>มาก→น้อย</button>
                  <button className={dashSortAmount === 'asc' ? 'active' : ''} onClick={(e) => { e.stopPropagation(); setDashSortAmount('asc'); }}>น้อย→มาก</button>
                </div>
              </div>
              <div className="flex-1 p-2 space-y-1.5 min-h-[180px]">
                {dashOverdueAmount.length === 0 ? (
                  <p className="text-gray-500 text-xs text-center py-8">ไม่มีรายการค้างชำระ</p>
                ) : (dashSortAmount === 'desc' ? dashOverdueAmount : [...dashOverdueAmount].reverse()).map((item, idx) => (
                  <button key={item.id} onClick={() => jumpToCitizen(item)} className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 hover:bg-navy-700/70 cursor-pointer text-left transition-colors">
                    <span className={`w-6 h-6 rounded-md border flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${idx === 0 ? 'bg-amber-500/20 text-amber-300 border-amber-500/50' : idx === 1 ? 'bg-slate-400/15 text-slate-300 border-slate-400/40' : idx === 2 ? 'bg-orange-700/20 text-orange-300 border-orange-600/40' : 'bg-navy-700/60 text-gray-500 border-blue-900/40'}`}>{idx + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-white text-xs font-medium truncate">{item.primary}</div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-white text-xs font-semibold whitespace-nowrap">{item.value}</div>
                      {item.subValue && <div className="text-gray-500 text-[10px] whitespace-nowrap">{item.subValue}</div>}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Overdue Days */}
            <div className="card overflow-hidden flex flex-col">
              <div className="ph-panel-head flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <span className="ph-corner ph-corner-tl" aria-hidden />
                  <span className="ph-corner ph-corner-br" aria-hidden />
                  <Clock size={13} className="text-amber-400" />
                  <h3 className="text-xs font-bold text-white tracking-wide">ค้างชำระ (นานสุด)</h3>
                </span>
                <div className="gold-toggle">
                  <button className={dashSortDays === 'desc' ? 'active' : ''} onClick={(e) => { e.stopPropagation(); setDashSortDays('desc'); }}>นาน→สั้น</button>
                  <button className={dashSortDays === 'asc' ? 'active' : ''} onClick={(e) => { e.stopPropagation(); setDashSortDays('asc'); }}>สั้น→นาน</button>
                </div>
              </div>
              <div className="flex-1 p-2 space-y-1.5 min-h-[180px]">
                {dashOverdueDays.length === 0 ? (
                  <p className="text-gray-500 text-xs text-center py-8">ไม่มีรายการค้างชำระ</p>
                ) : (dashSortDays === 'desc' ? dashOverdueDays : [...dashOverdueDays].reverse()).map((item, idx) => (
                  <button key={item.id} onClick={() => jumpToCitizen(item)} className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 hover:bg-navy-700/70 cursor-pointer text-left transition-colors">
                    <span className={`w-6 h-6 rounded-md border flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${idx === 0 ? 'bg-amber-500/20 text-amber-300 border-amber-500/50' : idx === 1 ? 'bg-slate-400/15 text-slate-300 border-slate-400/40' : idx === 2 ? 'bg-orange-700/20 text-orange-300 border-orange-600/40' : 'bg-navy-700/60 text-gray-500 border-blue-900/40'}`}>{idx + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-white text-xs font-medium truncate">{item.primary}</div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-white text-xs font-semibold whitespace-nowrap">{item.value}</div>
                      {item.subValue && <div className="text-gray-500 text-[10px] whitespace-nowrap">{item.subValue}</div>}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Service Usage */}
            <div className="card overflow-hidden flex flex-col">
              <div className="ph-panel-head flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <span className="ph-corner ph-corner-tl" aria-hidden />
                  <span className="ph-corner ph-corner-br" aria-hidden />
                  <BriefcaseBusiness size={13} className="text-amber-400" />
                  <h3 className="text-xs font-bold text-white tracking-wide">การใช้บริการ</h3>
                </span>
                <div className="gold-toggle">
                  <button className={dashSortUsage === 'desc' ? 'active' : ''} onClick={(e) => { e.stopPropagation(); setDashSortUsage('desc'); }}>มาก→น้อย</button>
                  <button className={dashSortUsage === 'asc' ? 'active' : ''} onClick={(e) => { e.stopPropagation(); setDashSortUsage('asc'); }}>น้อย→มาก</button>
                </div>
              </div>
              <div className="flex-1 p-2 space-y-1.5 min-h-[180px]">
                {dashUsage.length === 0 ? (
                  <p className="text-gray-500 text-xs text-center py-8">ยังไม่มีประวัติใช้บริการ</p>
                ) : (dashSortUsage === 'desc' ? dashUsage : [...dashUsage].reverse()).map((item, idx) => (
                  <button key={item.id} onClick={() => jumpToCitizen(item)} className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 hover:bg-navy-700/70 cursor-pointer text-left transition-colors">
                    <span className={`w-6 h-6 rounded-md border flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${idx === 0 ? 'bg-amber-500/20 text-amber-300 border-amber-500/50' : idx === 1 ? 'bg-slate-400/15 text-slate-300 border-slate-400/40' : idx === 2 ? 'bg-orange-700/20 text-orange-300 border-orange-600/40' : 'bg-navy-700/60 text-gray-500 border-blue-900/40'}`}>{idx + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-white text-xs font-medium truncate">{item.primary}</div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-white text-xs font-semibold whitespace-nowrap">{item.value}</div>
                      {item.subValue && <div className="text-gray-500 text-[10px] whitespace-nowrap">{item.subValue}</div>}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Citizen List */}
        <div className="lg:col-span-1">
          <h2 className="text-sm font-semibold text-gray-400 mb-3">รายการประชาชน ({citizens.length})</h2>
          <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
            {citizens.length === 0 && (
              <div className="card p-6 text-center">
                <UserCog size={28} className="text-gray-600 mx-auto mb-2" />
                <p className="text-gray-400 text-sm">{searched ? 'ไม่พบข้อมูล' : 'ยังไม่มีข้อมูลประชาชน'}</p>
              </div>
            )}
            {citizens.map((c) => (
              <button
                key={c.id}
                onClick={() => selectCitizen(c)}
                className={'w-full text-left card p-3 transition-all hover:border-amber-500/40 ' + (selectedCitizen?.id === c.id ? 'border-amber-500/50 bg-amber-500/5' : '')}
              >
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="text-white text-sm font-medium truncate">{c.roblox_username}</div>
                    {c.discord_username && <div className="text-gray-500 text-xs truncate">{c.discord_username}</div>}
                  </div>
                  <CitizenStatusBadge status={c.status} />
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Detail Panel */}
        <div className="lg:col-span-2">
          {!selectedCitizen ? (
            <div className="card p-12 text-center">
              <UserCog size={40} className="text-gray-600 mx-auto mb-3" />
              <p className="text-gray-400 text-sm">เลือกประชาชนจากรายการด้านซ้าย หรือกด "เพิ่มประชาชน" เพื่อเริ่มต้น</p>
            </div>
          ) : (
            <>
              {/* Tabs */}
              <div className="flex gap-1.5 mb-4 overflow-x-auto pb-1">
                {tabs.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className={'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all ' + (tab === t.id ? 'bg-amber-500 text-navy-900' : 'bg-navy-800 text-gray-400 hover:text-white border border-blue-900/40')}
                  >
                    {t.icon}
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Overview Tab */}
              {tab === 'overview' && (
                <div className="card p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 bg-blue-500/10 border border-blue-500/20 rounded-xl flex items-center justify-center">
                        <User size={24} className="text-blue-400" />
                      </div>
                      <div>
                        <h3 className="text-lg font-bold text-white">{selectedCitizen.roblox_username}</h3>
                        {selectedCitizen.discord_username && <p className="text-gray-500 text-sm">{selectedCitizen.discord_username}</p>}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => openEditCitizen(selectedCitizen)} className="btn-secondary px-3 py-1.5 text-sm flex items-center gap-1.5">
                        <Edit2 size={14} /> แก้ไข
                      </button>
                      <button onClick={() => setConfirmDelete({ type: 'citizen', id: selectedCitizen.id, name: selectedCitizen.roblox_username })} className="bg-red-500/10 text-red-400 border border-red-500/20 px-3 py-1.5 rounded-lg text-sm hover:bg-red-500/20 flex items-center gap-1.5">
                        <Trash2 size={14} /> ลบ
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 pt-4 border-t border-blue-900/30">
                    <DetailItem icon={<User size={14} />} label="Roblox Username" value={selectedCitizen.roblox_username} />
                    <DetailItem icon={<User size={14} />} label="Discord Username" value={selectedCitizen.discord_username || '-'} />
                    <div>
                      <div className="text-xs text-gray-500 mb-1 flex items-center gap-1"><Shield size={14} className="text-amber-400" /> สถานะ</div>
                      <CitizenStatusBadge status={selectedCitizen.status} />
                    </div>
                    <DetailItem icon={<Clock size={14} />} label="ลงทะเบียนเมื่อ" value={formatDate(selectedCitizen.created_at)} />
                  </div>

                  {selectedCitizen.notes && (
                    <div className="mt-4 pt-4 border-t border-blue-900/30">
                      <div className="text-xs text-gray-500 mb-1 flex items-center gap-1"><FileText size={14} className="text-amber-400" /> หมายเหตุส่วนตัว</div>
                      <div className="bg-navy-900/50 rounded-lg p-3 text-gray-300 text-sm">{selectedCitizen.notes}</div>
                    </div>
                  )}

                  {/* Quick stats */}
                  <div className="mt-4 pt-4 border-t border-blue-900/30 grid grid-cols-2 gap-3">
                    <div className="bg-navy-900/50 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-white">{vehicles.length}</div>
                      <div className="text-xs text-gray-500">ยานพาหนะ</div>
                    </div>
                    <div className="bg-navy-900/50 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-white">{licenses.length}</div>
                      <div className="text-xs text-gray-500">ใบอนุญาต</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Fees Tab */}
              {tab === 'fees' && (() => {
                const feeTotal = feeRecords.reduce((s, r) => s + Number(r.amount), 0);
                const feePaid = feeRecords.filter((r) => r.status === 'paid').reduce((s, r) => s + Number(r.amount), 0);
                const feeUnpaid = feeTotal - feePaid;
                return (
                <div>
                  {/* Summary cards */}
                  <div className="grid grid-cols-3 gap-3 mb-4">
                    <div className="card p-4 text-center">
                      <div className="text-xl font-bold text-white">{formatMoney(feeTotal)}</div>
                      <div className="text-xs text-gray-500 mt-0.5">ยอดรวมทั้งหมด ({feeRecords.length} รายการ)</div>
                    </div>
                    <div className="card p-4 text-center border-emerald-500/20">
                      <div className="text-xl font-bold text-emerald-400">{formatMoney(feePaid)}</div>
                      <div className="text-xs text-gray-500 mt-0.5">ชำระแล้ว</div>
                    </div>
                    <div className="card p-4 text-center border-red-500/20">
                      <div className="text-xl font-bold text-red-400">{formatMoney(feeUnpaid)}</div>
                      <div className="text-xs text-gray-500 mt-0.5">ค้างชำระ</div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-semibold text-gray-400">ประวัติค่าบริการ ({feeRecords.length})</h3>
                    <button onClick={openAddFee} className="btn-primary px-4 py-1.5 text-sm flex items-center gap-1.5">
                      <Plus size={14} /> เพิ่มค่าบริการ
                    </button>
                  </div>
                  {feeRecords.length === 0 ? (
                    <div className="card p-8 text-center">
                      <DollarSign size={28} className="text-gray-600 mx-auto mb-2" />
                      <p className="text-gray-400 text-sm">ยังไม่มีประวัติค่าบริการ</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {feeRecords.map((f) => {
                        const canEdit = isCommissioner || (officer && f.officer_id === officer.id);
                        return (
                        <div key={f.id} className={'card p-4 ' + (f.service_type === 'impound' ? 'border-red-500/20' : '')}>
                          <div className="flex items-start justify-between">
                            <div className="flex items-center gap-3">
                              <div className={'w-10 h-10 rounded-lg flex items-center justify-center ' + (f.service_type === 'impound' ? 'bg-red-500/10 border border-red-500/30' : 'bg-blue-500/10 border border-blue-500/20')}>
                                {f.service_type === 'impound' ? <Lock size={18} className="text-red-400" /> : <DollarSign size={18} className="text-blue-400" />}
                              </div>
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="text-white font-semibold">{f.service_name}</span>
                                  <Badge variant={f.service_type === 'impound' ? 'danger' : 'info'}>{f.service_type === 'impound' ? 'ยึด' : 'ปกติ'}</Badge>
                                </div>
                                <div className="text-gray-500 text-xs mt-0.5">
                                  {formatDate(f.service_date)} · เจ้าหน้าที่: {f.officer_name}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className={'text-sm font-bold ' + (f.status === 'paid' ? 'text-emerald-400' : 'text-red-400')}>{formatMoney(Number(f.amount))}</span>
                              {canEdit ? (
                                <button onClick={() => toggleFeeStatus(f)} title="สลับสถานะการชำระ">
                                  <Badge variant={f.status === 'paid' ? 'success' : 'danger'}>{f.status === 'paid' ? 'ชำระแล้ว' : 'ค้างชำระ'}</Badge>
                                </button>
                              ) : (
                                <Badge variant={f.status === 'paid' ? 'success' : 'danger'}>{f.status === 'paid' ? 'ชำระแล้ว' : 'ค้างชำระ'}</Badge>
                              )}
                              {f.evidence_url && (
                                <button onClick={() => setViewFeeImage(f.evidence_url)} className="bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 p-1.5 rounded-lg" title="ดูหลักฐาน"><Eye size={14} /></button>
                              )}
                              {canEdit ? (
                                <button onClick={() => openEditFee(f)} className="bg-navy-700 text-gray-400 hover:text-white p-1.5 rounded-lg" title="แก้ไข"><Edit2 size={14} /></button>
                              ) : (
                                <span className="text-gray-600 text-xs px-1" title="ไม่สามารถแก้ไขได้ เฉพาะผู้ที่สร้างรายการนี้เท่านั้น">—</span>
                              )}
                              {canEdit && isCommissioner && (
                                <button onClick={() => setConfirmDelete({ type: 'fee', id: f.id, name: f.service_name })} className="bg-red-500/10 text-red-400 hover:bg-red-500/20 p-1.5 rounded-lg" title="ลบ"><Trash2 size={14} /></button>
                              )}
                            </div>
                          </div>
                          {f.notes && <div className="mt-2 pt-2 border-t border-blue-900/30 text-xs text-gray-500">{f.notes}</div>}
                        </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                );
              })()}

              {/* Vehicles Tab */}
              {tab === 'vehicles' && (
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-semibold text-gray-400">ยานพาหนะในครอบครอง ({vehicles.length})</h3>
                    <button onClick={openAddVehicle} className="btn-primary px-4 py-1.5 text-sm flex items-center gap-1.5">
                      <Plus size={14} /> เพิ่มยานพาหนะ
                    </button>
                  </div>
                  {vehicles.length === 0 ? (
                    <div className="card p-8 text-center">
                      <Car size={28} className="text-gray-600 mx-auto mb-2" />
                      <p className="text-gray-400 text-sm">ยังไม่มียานพาหนะในครอบครอง</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {vehicles.map((v) => (
                        <div key={v.id} className={'card p-4 ' + (v.is_impounded ? 'border-red-500/30' : 'border-emerald-500/20')}>
                          <div className="flex items-start justify-between">
                            <div className="flex items-center gap-3">
                              <div className={'w-10 h-10 rounded-lg flex items-center justify-center ' + (v.is_impounded ? 'bg-red-500/10 border border-red-500/30' : 'bg-emerald-500/10 border border-emerald-500/20')}>
                                {v.is_impounded ? <Lock size={18} className="text-red-400" /> : vehicleIcon(v.vehicle_type)}
                              </div>
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="text-white font-semibold">{v.license_plate}</span>
                                  {v.is_impounded && <Badge variant="danger">ถูกยึด</Badge>}
                                </div>
                                <div className="text-gray-500 text-xs mt-0.5">
                                  {VEHICLE_TYPE_LABELS[v.vehicle_type]} · {v.brand_model || '-'} · {v.color || '-'}
                                </div>
                                <div className="text-gray-500 text-xs">
                                  หมวด: {VEHICLE_CATEGORY_LABELS[v.vehicle_category || 'personal'] || v.vehicle_category}
                                </div>
                              </div>
                            </div>
                            <div className="flex gap-1.5">
                              <button onClick={() => openEditVehicle(v)} className="bg-navy-700 text-gray-400 hover:text-white p-1.5 rounded-lg"><Edit2 size={14} /></button>
                              <button onClick={() => setConfirmDelete({ type: 'vehicle', id: v.id, name: v.license_plate })} className="bg-red-500/10 text-red-400 hover:bg-red-500/20 p-1.5 rounded-lg"><Trash2 size={14} /></button>
                            </div>
                          </div>
                          {v.is_impounded && v.impound_reason && (
                            <div className="mt-2 pt-2 border-t border-blue-900/30 text-xs text-red-400">
                              เหตุผลที่ยึด: {v.impound_reason} · สถานที่: {v.impound_location || '-'}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Licenses Tab */}
              {tab === 'licenses' && (
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-semibold text-gray-400">ใบอนุญาต ({licenses.length})</h3>
                    <button onClick={openAddLicense} className="btn-primary px-4 py-1.5 text-sm flex items-center gap-1.5">
                      <Plus size={14} /> เพิ่มใบอนุญาต
                    </button>
                  </div>
                  {licenses.length === 0 ? (
                    <div className="card p-8 text-center">
                      <CreditCard size={28} className="text-gray-600 mx-auto mb-2" />
                      <p className="text-gray-400 text-sm">ยังไม่มีใบอนุญาต</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {licenses.map((l) => (
                        <div key={l.id} className={'card p-4 ' + (l.status === 'active' ? 'border-emerald-500/20' : l.status === 'expired' ? 'border-red-500/30' : 'border-amber-500/30')}>
                          <div className="flex items-start justify-between">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-blue-500/10 border border-blue-500/20">
                                <CreditCard size={18} className="text-blue-400" />
                              </div>
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="text-white font-semibold">{l.license_type === 'driver' ? 'ใบขับขี่' : l.license_type}</span>
                                  {l.license_number && <span className="text-gray-500 text-xs">#{l.license_number}</span>}
                                </div>
                                <div className="text-gray-500 text-xs mt-0.5">
                                  ออก: {formatDate(l.issue_date)} · หมดอายุ: {formatDate(l.expiry_date)}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <LicenseStatusBadge status={l.status} />
                              <button onClick={() => openEditLicense(l)} className="bg-navy-700 text-gray-400 hover:text-white p-1.5 rounded-lg"><Edit2 size={14} /></button>
                              <button onClick={() => setConfirmDelete({ type: 'license', id: l.id, name: l.license_type })} className="bg-red-500/10 text-red-400 hover:bg-red-500/20 p-1.5 rounded-lg"><Trash2 size={14} /></button>
                            </div>
                          </div>
                          {l.notes && <div className="mt-2 pt-2 border-t border-blue-900/30 text-xs text-gray-500">{l.notes}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Citizen Form Modal */}
      {showCitizenForm && (
        <Modal title={editingCitizen ? 'แก้ไขข้อมูลประชาชน' : 'เพิ่มประชาชนใหม่'} onClose={() => setShowCitizenForm(false)}>
          <form onSubmit={handleCitizenSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Roblox Username <span className="text-red-400">*</span></label>
              <input className="input-field" placeholder="ระบุ Roblox Username" value={citizenForm.roblox_username} onChange={(e) => setCitizenForm({ ...citizenForm, roblox_username: e.target.value })} autoFocus />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Discord Username</label>
              <input className="input-field" placeholder="ระบุ Discord Username (ถ้ามี)" value={citizenForm.discord_username} onChange={(e) => setCitizenForm({ ...citizenForm, discord_username: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">สถานะบุคคล</label>
              <div className="flex gap-2">
                {(['normal', 'watched', 'suspended'] as CitizenStatus[]).map((s) => (
                  <button key={s} type="button" onClick={() => setCitizenForm({ ...citizenForm, status: s })}
                    className={'flex-1 py-2 rounded-lg text-sm font-medium transition-all ' + (citizenForm.status === s ? 'bg-amber-500 text-navy-900' : 'bg-navy-700 text-gray-400 hover:text-white')}>
                    {CITIZEN_STATUS_LABELS[s]}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">หมายเหตุส่วนตัว</label>
              <textarea className="input-field resize-none" rows={3} placeholder="บันทึกหมายเหตุเกี่ยวกับบุคคลนี้..." value={citizenForm.notes} onChange={(e) => setCitizenForm({ ...citizenForm, notes: e.target.value })} />
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setShowCitizenForm(false)} className="btn-secondary flex-1">ยกเลิก</button>
              <button type="submit" className="btn-primary flex-1 flex items-center justify-center gap-2"><Save size={16} /> บันทึก</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Vehicle Form Modal */}
      {showVehicleForm && (
        <Modal title={editingVehicle ? 'แก้ไขยานพาหนะ' : 'เพิ่มยานพาหนะ'} onClose={() => setShowVehicleForm(false)} size="lg">
          <form onSubmit={handleVehicleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">ทะเบียนรถ <span className="text-red-400">*</span></label>
                <input className="input-field uppercase" placeholder="กข1234" value={vehicleForm.license_plate} onChange={(e) => setVehicleForm({ ...vehicleForm, license_plate: e.target.value })} autoFocus />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">ยี่ห้อรถ</label>
                <select className="input-field" value={vehicleForm.brand} onChange={(e) => setVehicleForm({ ...vehicleForm, brand: e.target.value, model: '' })}>
                  <option value="">-- เลือกยี่ห้อ --</option>
                  {Object.keys(VEHICLE_BRAND_MODELS).map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">รุ่น</label>
                {vehicleForm.brand === 'อื่นๆ' ? (
                  <input className="input-field" placeholder="กรอกรุ่นรถ" value={vehicleForm.model} onChange={(e) => setVehicleForm({ ...vehicleForm, model: e.target.value })} />
                ) : (
                  <select className="input-field" value={vehicleForm.model} onChange={(e) => setVehicleForm({ ...vehicleForm, model: e.target.value })}>
                    <option value="">-- เลือกรุ่น --</option>
                    {(vehicleForm.brand ? VEHICLE_BRAND_MODELS[vehicleForm.brand] || [] : []).map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">ประเภทรถ</label>
                <select className="input-field" value={vehicleForm.vehicle_type} onChange={(e) => setVehicleForm({ ...vehicleForm, vehicle_type: e.target.value as VehicleType })}>
                  {Object.entries(VEHICLE_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">หมวดหมู่รถ</label>
                <select className="input-field" value={vehicleForm.vehicle_category} onChange={(e) => setVehicleForm({ ...vehicleForm, vehicle_category: e.target.value })}>
                  {Object.entries(VEHICLE_CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">สี</label>
                <select className="input-field" value={vehicleForm.color} onChange={(e) => setVehicleForm({ ...vehicleForm, color: e.target.value })}>
                  <option value="">-- เลือกสี --</option>
                  {VEHICLE_COLORS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">ชื่อเจ้าของ</label>
                <input className="input-field" placeholder="ชื่อเจ้าของ" value={vehicleForm.owner_name} onChange={(e) => setVehicleForm({ ...vehicleForm, owner_name: e.target.value })} />
              </div>
            </div>

            <div className="pt-3 border-t border-blue-900/30">
              <label className="flex items-center gap-2 cursor-pointer mb-3">
                <input type="checkbox" checked={vehicleForm.is_impounded} onChange={(e) => setVehicleForm({ ...vehicleForm, is_impounded: e.target.checked })} className="w-4 h-4 rounded accent-amber-500" />
                <span className="text-sm text-white">ยานพาหนะถูกยึด</span>
              </label>
              {vehicleForm.is_impounded && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1.5">เหตุผลที่ยึด</label>
                    <input className="input-field" placeholder="เช่น ไม่ต่อทะเบียน, ฝ่าฝืนจราจร" value={vehicleForm.impound_reason} onChange={(e) => setVehicleForm({ ...vehicleForm, impound_reason: e.target.value })} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-400 mb-1.5">สถานที่เก็บ</label>
                    <input className="input-field" placeholder="เช่น สายตรวจกรมขนส่ง" value={vehicleForm.impound_location} onChange={(e) => setVehicleForm({ ...vehicleForm, impound_location: e.target.value })} />
                  </div>
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">หมายเหตุ</label>
              <textarea className="input-field resize-none" rows={2} placeholder="หมายเหตุเพิ่มเติม..." value={vehicleForm.notes} onChange={(e) => setVehicleForm({ ...vehicleForm, notes: e.target.value })} />
            </div>

            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setShowVehicleForm(false)} className="btn-secondary flex-1">ยกเลิก</button>
              <button type="submit" className="btn-primary flex-1 flex items-center justify-center gap-2"><Save size={16} /> บันทึก</button>
            </div>
          </form>
        </Modal>
      )}

      {/* License Form Modal */}
      {showLicenseForm && (
        <Modal title={editingLicense ? 'แก้ไขใบอนุญาต' : 'เพิ่มใบอนุญาต'} onClose={() => setShowLicenseForm(false)}>
          <form onSubmit={handleLicenseSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">ประเภทใบอนุญาต</label>
              <select className="input-field" value={licenseForm.license_type} onChange={(e) => setLicenseForm({ ...licenseForm, license_type: e.target.value })}>
                <option value="driver">ใบขับขี่</option>
                <option value="commercial">ใบขับขี่พาณิชย์</option>
                <option value="motorcycle">ใบขับขี่รถจักรยานยนต์</option>
                <option value="transport">ใบอนุญาตขนส่ง</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">เลขที่ใบอนุญาต</label>
              <input className="input-field" placeholder="เลขที่ใบอนุญาต" value={licenseForm.license_number} onChange={(e) => setLicenseForm({ ...licenseForm, license_number: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">วันออกใบอนุญาต</label>
                <input type="date" className="input-field" value={licenseForm.issue_date} onChange={(e) => setLicenseForm({ ...licenseForm, issue_date: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">วันหมดอายุ</label>
                <input type="date" className="input-field" value={licenseForm.expiry_date} onChange={(e) => setLicenseForm({ ...licenseForm, expiry_date: e.target.value })} />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">สถานะใบอนุญาต</label>
              <select className="input-field" value={licenseForm.status} onChange={(e) => setLicenseForm({ ...licenseForm, status: e.target.value })}>
                <option value="active">ใช้งานได้</option>
                <option value="expired">หมดอายุ</option>
                <option value="suspended">ถูกพักใช้</option>
                <option value="revoked">ถูกยกเลิก</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">หมายเหตุ</label>
              <textarea className="input-field resize-none" rows={2} placeholder="หมายเหตุ..." value={licenseForm.notes} onChange={(e) => setLicenseForm({ ...licenseForm, notes: e.target.value })} />
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => setShowLicenseForm(false)} className="btn-secondary flex-1">ยกเลิก</button>
              <button type="submit" className="btn-primary flex-1 flex items-center justify-center gap-2"><Save size={16} /> บันทึก</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Fee Form Modal */}
      {showFeeForm && (
        <Modal title={editingFee ? 'แก้ไขค่าบริการ' : 'เพิ่มค่าบริการ'} onClose={() => setShowFeeForm(false)} size="lg">
          <form onSubmit={handleFeeSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">ประเภทบริการ (เลือกจากรายการ)</label>
              <select className="input-field" value={feeForm.service_rate_id} onChange={(e) => handleRateSelect(e.target.value)}>
                <option value="">-- เลือกประเภทบริการ (หรือพิมพ์ชื่อบริการเอง) --</option>
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
                <label className="block text-xs font-medium text-gray-400 mb-1.5">ชื่อบริการ <span className="text-red-400">*</span></label>
                <input className="input-field" required placeholder="ชื่อบริการ" value={feeForm.service_name} onChange={(e) => setFeeForm({ ...feeForm, service_name: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">ราคา (BC) <span className="text-red-400">*</span></label>
                <input type="number" className="input-field" required placeholder="0" value={feeForm.amount} onChange={(e) => setFeeForm({ ...feeForm, amount: e.target.value })} />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">ประเภทการบริการ</label>
              <div className="grid grid-cols-2 gap-3">
                <button type="button" onClick={() => setFeeForm({ ...feeForm, service_type: 'normal' })} className={'flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border-2 text-sm font-medium transition-all ' + (feeForm.service_type === 'normal' ? 'bg-blue-500/15 border-blue-500/40 text-blue-400' : 'bg-navy-900 border-blue-900/40 text-gray-500 hover:border-blue-700/50')}>
                  <Car size={16} /> ปกติ
                </button>
                <button type="button" onClick={() => setFeeForm({ ...feeForm, service_type: 'impound' })} className={'flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border-2 text-sm font-medium transition-all ' + (feeForm.service_type === 'impound' ? 'bg-red-500/15 border-red-500/40 text-red-400' : 'bg-navy-900 border-blue-900/40 text-gray-500 hover:border-red-700/50')}>
                  <Lock size={16} /> ยึด
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">วันที่ให้บริการ</label>
                <input type="datetime-local" className="input-field" value={feeForm.service_date} onChange={(e) => setFeeForm({ ...feeForm, service_date: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">สถานะ</label>
                <select className="input-field" value={feeForm.status} onChange={(e) => setFeeForm({ ...feeForm, status: e.target.value as 'paid' | 'unpaid' })}>
                  <option value="unpaid">ค้างชำระ</option>
                  <option value="paid">ชำระแล้ว</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">หมายเหตุ</label>
              <textarea className="input-field resize-none" rows={2} placeholder="หมายเหตุ..." value={feeForm.notes} onChange={(e) => setFeeForm({ ...feeForm, notes: e.target.value })} />
            </div>

            {/* Evidence Image Upload */}
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">รูปภาพหลักฐานการใช้บริการ</label>
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
              <button type="button" onClick={() => setShowFeeForm(false)} className="btn-secondary flex-1">ยกเลิก</button>
              <button type="submit" disabled={uploading} className="btn-primary flex-1 flex items-center justify-center gap-2 disabled:opacity-50">
                {uploading ? 'กำลังอัปโหลด...' : <><Save size={16} /> บันทึก</>}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Fee Evidence Image Viewer */}
      {viewFeeImage && (
        <Modal title="รูปภาพหลักฐาน" onClose={() => setViewFeeImage(null)} size="lg">
          <div className="flex justify-center">
            <img src={viewFeeImage} alt="evidence" className="max-w-full max-h-[60vh] rounded-lg object-contain" />
          </div>
        </Modal>
      )}

      {/* Delete Confirmation */}
      {confirmDelete && (
        <ConfirmDialog
          title={'ลบ' + (confirmDelete.type === 'citizen' ? 'ประชาชน' : confirmDelete.type === 'vehicle' ? 'ยานพาหนะ' : confirmDelete.type === 'license' ? 'ใบอนุญาต' : 'ค่าบริการ')}
          message={'ต้องการลบ' + (confirmDelete.type === 'citizen' ? 'ประชาชน' : confirmDelete.type === 'vehicle' ? 'ยานพาหนะ' : confirmDelete.type === 'license' ? 'ใบอนุญาต' : 'ค่าบริการ') + ' "' + confirmDelete.name + '" ใช่หรือไม่? ไม่สามารถย้อนกลับได้'}
          confirmLabel="ลบ"
          onConfirm={async () => {
            if (confirmDelete.type === 'citizen') await deleteCitizen(confirmDelete.id);
            else if (confirmDelete.type === 'vehicle') await deleteVehicle(confirmDelete.id);
            else if (confirmDelete.type === 'license') await deleteLicense(confirmDelete.id);
            else await deleteFee(confirmDelete.id);
            setConfirmDelete(null);
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

function CitizenStatusBadge({ status }: { status: CitizenStatus }) {
  if (status === 'normal') return <Badge variant="success">ปกติ</Badge>;
  if (status === 'watched') return <Badge variant="warning">เฝ้าระวัง</Badge>;
  return <Badge variant="danger">ระงับสิทธิ์</Badge>;
}

function LicenseStatusBadge({ status }: { status: string }) {
  if (status === 'active') return <Badge variant="success">ใช้งานได้</Badge>;
  if (status === 'expired') return <Badge variant="danger">หมดอายุ</Badge>;
  if (status === 'suspended') return <Badge variant="warning">ถูกพักใช้</Badge>;
  if (status === 'revoked') return <Badge variant="danger">ถูกยกเลิก</Badge>;
  return <Badge variant="neutral">{status}</Badge>;
}

function DetailItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-gray-500 mb-1 flex items-center gap-1"><span className="text-amber-400">{icon}</span>{label}</div>
      <div className="text-white text-sm">{value}</div>
    </div>
  );
}
