import { useEffect, useState, ReactNode } from 'react';
import {
  Plus, Edit2, Trash2, Users, Shield, ShieldOff, Key, Search, Upload, X,
  Tag, History, Zap, Check,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { hashPassword } from '../../lib/crypto';
import { uploadImage } from '../../lib/storage';
import {
  Officer, OfficerRank, OfficerRankRecord, Department,
  RANK_LABELS, DEPARTMENT_LABELS, DEPARTMENTS, COMMISSIONER_RANK,
  SERVICE_CATEGORIES,
} from '../../lib/types';
import { useAuth } from '../../lib/AuthContext';
import { Badge } from '../../components/Badge';
import { Modal, ConfirmDialog } from '../../components/Modal';
import { OfficerHistoryModal } from '../../components/OfficerHistoryModal';
import { PageHeader } from '../../components/PageHeader';

type ActionType = 'suspend' | 'activate' | 'delete' | 'reset';

export function OfficerManagementPage() {
  const { officer: currentOfficer } = useAuth();
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQ, setSearchQ] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<Officer | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ type: ActionType; target: Officer } | null>(null);
  const [resetPw, setResetPw] = useState('');
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [historyOfficer, setHistoryOfficer] = useState<Officer | null>(null);
  const [showBatchDutyModal, setShowBatchDutyModal] = useState(false);

  // Rank management state
  const [ranks, setRanks] = useState<OfficerRankRecord[]>([]);
  const [showRankForm, setShowRankForm] = useState(false);
  const [rankForm, setRankForm] = useState({ label: '', rank_key: '', sort_order: 0 });
  const [editingRank, setEditingRank] = useState<OfficerRankRecord | null>(null);

  // Wizard state (เพิ่มเจ้าหน้าที่แบบ step-by-step)
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1);
  const [wizardTemplate, setWizardTemplate] = useState<Officer | null>(null);
  const [wizardForm, setWizardForm] = useState({
    name: '',
    username: '',
    password: '',
    rank: 'officer' as OfficerRank,
    department: 'traffic_management' as Department,
    duty_rate: 0,
    service_category: '' as string,
  });
  const [wizardPhotoPreview, setWizardPhotoPreview] = useState<string | null>(null);
  const [wizardPhotoFile, setWizardPhotoFile] = useState<File | null>(null);
  const [wizardUploading, setWizardUploading] = useState(false);
  const [wizardError, setWizardError] = useState<string | null>(null);

  function openWizard() {
    setWizardStep(1);
    setWizardTemplate(null);
    setWizardForm({
      name: '',
      username: '',
      password: '',
      rank: 'officer',
      department: 'traffic_management',
      duty_rate: 0,
      service_category: '',
    });
    setWizardPhotoPreview(null);
    setWizardPhotoFile(null);
    setWizardError(null);
    setWizardOpen(true);
  }

  function applyTemplate(t: Officer) {
    setWizardTemplate(t);
    setWizardForm((f) => ({
      ...f,
      rank: t.rank,
      department: t.department,
      duty_rate: t.duty_rate ?? 0,
      service_category: t.service_category ?? '',
    }));
  }

  async function handleWizardPhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setWizardPhotoFile(f);
    const reader = new FileReader();
    reader.onload = (ev) => setWizardPhotoPreview(ev.target?.result as string);
    reader.readAsDataURL(f);
  }

  async function submitWizard() {
    setWizardUploading(true);
    setWizardError(null);
    try {
      let photo_url: string | null = null;
      if (wizardPhotoFile) {
        const up = await uploadImage(wizardPhotoFile, 'officers');
        if (!up) throw new Error('อัปโหลดรูปไม่สำเร็จ');
        photo_url = up;
      }
      const password_hash = await hashPassword(wizardForm.password);
      const insertData: Record<string, unknown> = {
        username: wizardForm.username,
        password_hash,
        name: wizardForm.name,
        rank: wizardForm.rank,
        department: wizardForm.department,
        duty_rate: wizardForm.duty_rate,
        service_category: wizardForm.service_category || null,
        status: 'active',
        is_on_duty: false,
        photo_url,
      };
      const { error } = await supabase.from('officers').insert(insertData);
      if (error) {
        if (error.code === '23505') {
          setWizardError('Username นี้ถูกใช้แล้ว');
        } else if (error.code === '23514') {
          setWizardError('ข้อมูลไม่ตรงเงื่อนไข (เช่น ตำแหน่ง/แผนกไม่ถูกต้อง)');
        } else if (error.code === '42501') {
          setWizardError('สิทธิ์ไม่เพียงพอ (ต้องเป็นหัวหน้ากรม)');
        } else {
          setWizardError(`บันทึกไม่สำเร็จ: ${error.message}`);
        }
        return;
      }
      setWizardOpen(false);
      await fetchAll();
    } catch (e) {
      setWizardError((e as Error).message);
    } finally {
      setWizardUploading(false);
    }
  }

  const [form, setForm] = useState({
    username: '',
    password: '',
    name: '',
    rank: 'officer' as OfficerRank,
    department: 'traffic_management' as Department,
    duty_rate: 0,
  });

  useEffect(() => { fetchAll(); fetchRanks(); }, []);

  async function fetchAll() {
    setLoading(true);
    const { data } = await supabase
      .from('officers')
      .select('*')
      .neq('status', 'deleted')
      .order('name');
    setOfficers(data ?? []);
    setLoading(false);
  }

  async function fetchRanks() {
    const { data } = await supabase
      .from('officer_ranks')
      .select('*')
      .order('sort_order');
    setRanks(data ?? []);
  }

  async function handleRankSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!rankForm.label.trim()) return;
    const key = rankForm.rank_key.trim() || rankForm.label.trim().toLowerCase().replace(/\s+/g, '_');
    if (editingRank) {
      const { error } = await supabase.from('officer_ranks').update({
        label: rankForm.label.trim(),
        rank_key: key,
        sort_order: rankForm.sort_order,
        updated_at: new Date().toISOString(),
      }).eq('id', editingRank.id);
      if (error) { alert('ไม่สามารถแก้ไขตำแหน่งได้'); return; }
    } else {
      const { error } = await supabase.from('officer_ranks').insert({
        label: rankForm.label.trim(),
        rank_key: key,
        sort_order: rankForm.sort_order,
      });
      if (error) {
        alert('ไม่สามารถเพิ่มตำแหน่งได้ อาจมีชื่อซ้ำ');
        return;
      }
    }
    setShowRankForm(false);
    setEditingRank(null);
    setRankForm({ label: '', rank_key: '', sort_order: 0 });
    await fetchRanks();
  }

  async function deleteRank(rank: OfficerRankRecord) {
    if (rank.rank_key === COMMISSIONER_RANK || rank.sort_order === 1) {
      alert('ไม่สามารถลบตำแหน่งหัวหน้ากรมขนส่งได้');
      return;
    }
    if (!confirm(`ต้องการลบตำแหน่ง "${rank.label}" ใช่หรือไม่?`)) return;
    await supabase.from('officer_ranks').delete().eq('id', rank.id);
    await fetchRanks();
  }

  function openAddRank() {
    setEditingRank(null);
    setRankForm({ label: '', rank_key: '', sort_order: ranks.length + 1 });
    setShowRankForm(true);
  }

  function openEditRank(rank: OfficerRankRecord) {
    setEditingRank(rank);
    setRankForm({ label: rank.label, rank_key: rank.rank_key ?? '', sort_order: rank.sort_order });
    setShowRankForm(true);
  }

  function openAdd() {
    setEditItem(null);
    const defaultRank = ranks[0]?.rank_key ?? 'officer';
    setForm({ username: '', password: '', name: '', rank: defaultRank, department: 'traffic_management', duty_rate: 0 });
    setPhotoPreview(null);
    setPhotoFile(null);
    setShowForm(true);
  }

  function openEdit(item: Officer) {
    setEditItem(item);
    setForm({
      username: item.username,
      password: '',
      name: item.name,
      rank: item.rank,
      department: item.department,
      duty_rate: item.duty_rate ?? 0,
    });
    setPhotoPreview(item.photo_url ?? null);
    setPhotoFile(null);
    setShowForm(true);
  }

  function handlePhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setPhotoPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    let photoUrl = editItem?.photo_url ?? null;

    if (photoFile) {
      setUploadingPhoto(true);
      const uploaded = await uploadImage(photoFile, 'officers');
      if (uploaded) photoUrl = uploaded;
      setUploadingPhoto(false);
    }

    const dutyRateVal = Number(form.duty_rate) || 0;

    if (editItem) {
      const update: Partial<Officer> & { updated_at: string } = {
        name: form.name,
        rank: form.rank,
        department: form.department,
        duty_rate: dutyRateVal,
        photo_url: photoUrl,
        updated_at: new Date().toISOString(),
      };
      if (form.password) {
        update.password_hash = await hashPassword(form.password);
      }
      const { error } = await supabase.from('officers').update(update).eq('id', editItem.id);
      if (error) {
        if (error.code === '42501' || error.message?.includes('permission')) {
          alert('คุณไม่มีสิทธิ์แก้ไขเจ้าหน้าที่');
        } else if (error.code === '23514') {
          alert('ข้อมูลไม่ถูกต้อง: ตำแหน่งหรือแผนกอาจไม่ตรงกับที่ระบบรองรับ');
        } else {
          alert(`ไม่สามารถแก้ไขเจ้าหน้าที่ได้: ${error.message || 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ'}`);
        }
        return;
      }
    } else {
      if (!form.password) return;
      const hash = await hashPassword(form.password);
      const { error } = await supabase.from('officers').insert({
        username: form.username,
        password_hash: hash,
        name: form.name,
        rank: form.rank,
        department: form.department,
        duty_rate: dutyRateVal,
        photo_url: photoUrl,
        status: 'active',
        is_on_duty: false,
      });
      if (error) {
        if (error.code === '23505') {
          alert('Username นี้ถูกใช้แล้ว กรุณาใช้ชื่ออื่น');
        } else if (error.code === '23514') {
          alert('ข้อมูลไม่ถูกต้อง: ตำแหน่งหรือแผนกอาจไม่ตรงกับที่ระบบรองรับ');
        } else if (error.code === '42501' || error.message?.includes('permission')) {
          alert('คุณไม่มีสิทธิ์เพิ่มเจ้าหน้าที่');
        } else {
          alert(`ไม่สามารถเพิ่มเจ้าหน้าที่ได้: ${error.message || 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ'}`);
        }
        return;
      }
    }
    setShowForm(false);
    setEditItem(null);
    setPhotoPreview(null);
    setPhotoFile(null);
    await fetchAll();
  }

  async function executeAction() {
    if (!confirmAction || !currentOfficer) return;
    const { type, target } = confirmAction;

    if (type === 'suspend') {
      await supabase.from('officers').update({ status: 'suspended', is_on_duty: false, updated_at: new Date().toISOString() }).eq('id', target.id);
    } else if (type === 'activate') {
      await supabase.from('officers').update({ status: 'active', updated_at: new Date().toISOString() }).eq('id', target.id);
    } else if (type === 'delete') {
      await supabase.from('officers').update({ status: 'deleted', is_on_duty: false, updated_at: new Date().toISOString() }).eq('id', target.id);
      await supabase.from('audit_logs').insert({
        action: 'DELETE_OFFICER',
        target_type: 'officer',
        target_id: target.id,
        performed_by: currentOfficer.id,
        performed_by_name: currentOfficer.name,
        details: { deleted_name: target.name, deleted_username: target.username },
      });
    } else if (type === 'reset') {
      if (!resetPw) return;
      const hash = await hashPassword(resetPw);
      await supabase.from('officers').update({ password_hash: hash, updated_at: new Date().toISOString() }).eq('id', target.id);
      setResetPw('');
    }

    setConfirmAction(null);
    await fetchAll();
  }

  const filtered = officers.filter((o) => {
    const q = searchQ.toLowerCase();
    return !q || o.name.toLowerCase().includes(q) || o.username.toLowerCase().includes(q);
  });

  const rankBadge = (rank: OfficerRank) => {
    const rankRecord = ranks.find(r => r.rank_key === rank || r.label === rank);
    const label = rankRecord?.label ?? RANK_LABELS[rank] ?? rank;
    if (rank === COMMISSIONER_RANK || rankRecord?.sort_order === 1) {
      return <Badge variant="warning">{label}</Badge>;
    }
    if (rankRecord?.sort_order === 2) return <Badge variant="info">{label}</Badge>;
    return <Badge variant="neutral">{label}</Badge>;
  };

  const statusBadge = (status: string) => {
    if (status === 'active') return <Badge variant="success">ปกติ</Badge>;
    if (status === 'suspended') return <Badge variant="danger">ระงับ</Badge>;
    return <Badge variant="neutral">{status}</Badge>;
  };

  const confirmMessages: Record<ActionType, { title: string; msg: string; label: string }> = {
    suspend: { title: 'ระงับการใช้งาน', msg: 'เจ้าหน้าที่จะไม่สามารถเข้าสู่ระบบได้', label: 'ระงับ' },
    activate: { title: 'เปิดใช้งานอีกครั้ง', msg: 'เจ้าหน้าที่จะสามารถเข้าสู่ระบบได้', label: 'เปิดใช้งาน' },
    delete: { title: 'ลบเจ้าหน้าที่', msg: 'บัญชีจะถูกลบและไม่สามารถเข้าสู่ระบบได้อีก (ประวัติจะยังคงเก็บไว้)', label: 'ลบ' },
    reset: { title: 'รีเซ็ตรหัสผ่าน', msg: 'ระบุรหัสผ่านใหม่สำหรับเจ้าหน้าที่', label: 'รีเซ็ต' },
  };

  return (
    <div>
      <PageHeader
        icon={<Users size={26} />}
        title="จัดการเจ้าหน้าที่"
        subtitle="เพิ่ม แก้ไข และจัดการบัญชีเจ้าหน้าที่"
        actions={
          <>
            <button
              onClick={() => setShowBatchDutyModal(true)}
              className="btn-secondary flex items-center gap-1.5 text-amber-400 hover:text-amber-300 border-amber-500/30"
              title="กำหนดอัตราค่าขึ้นเวร (BC ต่อชั่วโมง) ให้เจ้าหน้าที่ทุกคนพร้อมกัน"
            >
              <Zap size={15} /> กำหนดเรทขึ้นเวรทุกคน
            </button>
            <button onClick={openAddRank} className="btn-secondary flex items-center gap-2">
              <Tag size={16} /> จัดการตำแหน่ง
            </button>
            <button onClick={openWizard} className="btn-secondary flex items-center gap-2">
              <Plus size={16} /> เพิ่มด้วย Wizard
            </button>
            <button onClick={openAdd} className="btn-primary flex items-center gap-2">
              <Plus size={16} /> เพิ่มเจ้าหน้าที่
            </button>
          </>
        }
      />

      {/* Rank Management Panel */}
      {showRankForm && (
        <div className="card p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white">{editingRank ? 'แก้ไขตำแหน่ง' : 'เพิ่มตำแหน่งใหม่'}</h2>
            <button onClick={() => { setShowRankForm(false); setEditingRank(null); }} className="text-gray-500 hover:text-white">
              <X size={16} />
            </button>
          </div>
          <form onSubmit={handleRankSubmit} className="flex gap-3 items-end">
            <div className="flex-1">
              <label className="block text-xs text-gray-400 mb-1">ชื่อตำแหน่ง</label>
              <input
                className="input-field"
                placeholder="เช่น หัวหน้ากองบัญชาการ"
                value={rankForm.label}
                onChange={(e) => setRankForm({ ...rankForm, label: e.target.value })}
                autoFocus
              />
            </div>
            <div className="w-28">
              <label className="block text-xs text-gray-400 mb-1">ลำดับ (น้อย = สูง)</label>
              <input
                type="number"
                className="input-field"
                value={rankForm.sort_order}
                onChange={(e) => setRankForm({ ...rankForm, sort_order: parseInt(e.target.value) || 0 })}
              />
            </div>
            <div className="w-40">
              <label className="block text-xs text-gray-400 mb-1">รหัสตำแหน่ง (อังกฤษ)</label>
              <input
                className="input-field"
                placeholder="เช่น officer, inspector"
                value={rankForm.rank_key}
                onChange={(e) => setRankForm({ ...rankForm, rank_key: e.target.value })}
              />
            </div>
            <button type="submit" className="btn-primary px-5">
              {editingRank ? 'บันทึก' : 'เพิ่ม'}
            </button>
          </form>
        </div>
      )}

      {/* Existing Ranks List */}
      {ranks.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          {ranks.map((r) => (
            <div key={r.id} className="flex items-center gap-2 bg-navy-800 border border-amber-500/15 rounded-lg px-3 py-1.5">
              <span className="text-xs text-gray-500">#{r.sort_order}</span>
              <span className="text-sm text-white font-medium">{r.label}</span>
              <button onClick={() => openEditRank(r)} className="text-blue-400 hover:bg-blue-500/10 p-1 rounded">
                <Edit2 size={11} />
              </button>
              {r.rank_key !== COMMISSIONER_RANK && r.sort_order !== 1 && (
                <button onClick={() => deleteRank(r)} className="text-red-400 hover:bg-red-500/10 p-1 rounded">
                  <Trash2 size={11} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Search */}
      <div className="card relative mb-6 max-w-sm overflow-hidden">
        <span className="ph-corner ph-corner-tl" aria-hidden />
        <span className="ph-corner ph-corner-br" aria-hidden />
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input className="input-field pl-9" placeholder="ค้นหาชื่อหรือ Username..." value={searchQ} onChange={(e) => setSearchQ(e.target.value)} />
      </div>

      {/* Table */}
      <div className="table-panel">
        <div className="overflow-x-auto">
          {loading ? (
            <div className="p-8 text-center text-gray-500 text-sm">กำลังโหลด...</div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center">
              <Users size={36} className="text-gray-600 mx-auto mb-2" />
              <p className="text-gray-400 text-sm">ไม่พบเจ้าหน้าที่</p>
            </div>
          ) : (
            <table className="w-full">
              <thead className="table-header-gold">
                <tr className="border-b border-amber-500/15">
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase">ชื่อ / Username</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase">ตำแหน่ง</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-gray-500 uppercase">แผนก</th>
                  <th className="text-center px-5 py-3 text-xs font-medium text-gray-500 uppercase">สถานะ</th>
                  <th className="text-center px-5 py-3 text-xs font-medium text-gray-500 uppercase">เวร</th>
                  <th className="px-5 py-3 text-xs font-medium text-gray-500 uppercase text-right">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((o) => (
                  <tr key={o.id} className={`table-row ${o.id === currentOfficer?.id ? 'bg-amber-500/5' : ''}`}>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full overflow-hidden bg-blue-900 flex items-center justify-center flex-shrink-0">
                          {o.photo_url ? (
                            <img src={o.photo_url} alt={o.name} className="w-full h-full object-cover" />
                          ) : (
                            <span className="text-amber-400 font-bold text-sm">{o.name.charAt(0).toUpperCase()}</span>
                          )}
                        </div>
                        <div>
                          <div className="text-white text-sm font-medium">{o.name}</div>
                          <div className="text-gray-500 text-xs font-mono">@{o.username}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4">{rankBadge(o.rank)}</td>
                    <td className="px-5 py-4 text-sm text-gray-400">
                      <div className="text-white">{DEPARTMENT_LABELS[o.department]}</div>
                      <div className="text-[11px] text-amber-400/80 font-mono">{(o.duty_rate ?? 0).toLocaleString('th-TH')} BC/ชม.</div>
                    </td>
                    <td className="px-5 py-4 text-center">{statusBadge(o.status)}</td>
                    <td className="px-5 py-4 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${o.is_on_duty ? 'text-emerald-400 bg-emerald-500/10' : 'text-gray-600 bg-gray-600/10'}`}>
                        {o.is_on_duty ? '● ปฏิบัติ' : '○ ว่าง'}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-1 justify-end">
                        <ActionBtn icon={<History size={13} />} label="ประวัติ" color="green" onClick={() => setHistoryOfficer(o)} />
                        <ActionBtn icon={<Edit2 size={13} />} label="แก้ไข" color="blue" onClick={() => openEdit(o)} />
                        <ActionBtn icon={<Key size={13} />} label="รีเซ็ต PW" color="amber" onClick={() => setConfirmAction({ type: 'reset', target: o })} />
                        {o.status === 'active'
                          ? <ActionBtn icon={<ShieldOff size={13} />} label="ระงับ" color="red" onClick={() => setConfirmAction({ type: 'suspend', target: o })} />
                          : <ActionBtn icon={<Shield size={13} />} label="เปิด" color="green" onClick={() => setConfirmAction({ type: 'activate', target: o })} />
                        }
                        {o.id !== currentOfficer?.id && (
                          <ActionBtn icon={<Trash2 size={13} />} label="ลบ" color="darkred" onClick={() => setConfirmAction({ type: 'delete', target: o })} />
                        )}
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
      {showForm && (
        <Modal title={editItem ? 'แก้ไขข้อมูลเจ้าหน้าที่' : 'เพิ่มเจ้าหน้าที่ใหม่'} onClose={() => { setShowForm(false); setEditItem(null); setPhotoPreview(null); setPhotoFile(null); }} size="md">
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Photo Upload */}
            <div className="flex flex-col items-center gap-3">
              <div className="relative w-24 h-24 rounded-xl overflow-hidden border-2 border-amber-500/30 bg-navy-700 flex items-center justify-center group">
                {photoPreview ? (
                  <img src={photoPreview} alt="preview" className="w-full h-full object-cover" />
                ) : (
                  <Upload size={24} className="text-gray-600" />
                )}
                {photoPreview && (
                  <button
                    type="button"
                    onClick={() => { setPhotoPreview(null); setPhotoFile(null); }}
                    className="absolute top-1 right-1 w-6 h-6 bg-red-600 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X size={14} className="text-white" />
                  </button>
                )}
              </div>
              <label className="cursor-pointer text-xs text-amber-400 hover:text-amber-300 font-medium">
                {photoPreview ? 'เปลี่ยนรูปภาพ' : 'อัปโหลดรูปถ่ายเจ้าหน้าที่'}
                <input type="file" accept="image/*" className="hidden" onChange={handlePhotoSelect} />
              </label>
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">ชื่อ-นามสกุล *</label>
              <input required className="input-field" placeholder="ชื่อเจ้าหน้าที่" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            {!editItem && (
              <div>
                <label className="block text-xs text-gray-400 mb-1">Username *</label>
                <input required className="input-field font-mono" placeholder="username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
              </div>
            )}
            <div>
              <label className="block text-xs text-gray-400 mb-1">{editItem ? 'รหัสผ่านใหม่ (เว้นว่างถ้าไม่เปลี่ยน)' : 'รหัสผ่าน *'}</label>
              <input
                type="password"
                required={!editItem}
                className="input-field"
                placeholder="รหัสผ่าน"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">ตำแหน่ง</label>
              <select className="input-field" value={form.rank} onChange={(e) => setForm({ ...form, rank: e.target.value as OfficerRank })}>
                {ranks.length > 0 ? (
                  ranks.map((r) => <option key={r.id} value={r.rank_key ?? r.label}>{r.label}</option>)
                ) : (
                  (Object.entries(RANK_LABELS) as [string, string][]).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))
                )}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">แผนก</label>
              <select className="input-field" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value as Department })}>
                {DEPARTMENTS.map((d) => <option key={d} value={d}>{DEPARTMENT_LABELS[d]}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">อัตราค่าขึ้นเวร (Duty Rate / BC ต่อชั่วโมง)</label>
              <input
                type="number"
                min={0}
                step="10"
                className="input-field font-mono"
                placeholder="เช่น 500"
                value={form.duty_rate}
                onChange={(e) => setForm({ ...form, duty_rate: parseFloat(e.target.value) || 0 })}
              />
              {/* Quick rate preset chips */}
              <div className="flex flex-wrap gap-1 mt-1.5">
                {[100, 200, 300, 400, 500, 800, 1000].map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setForm({ ...form, duty_rate: p })}
                    className={`px-2 py-0.5 rounded text-[11px] font-mono border transition-all ${
                      form.duty_rate === p
                        ? 'bg-amber-500 text-black border-amber-400 font-bold'
                        : 'bg-navy-800 text-gray-400 border-blue-900/60 hover:text-white hover:border-amber-500/40'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-gray-500 mt-1">ระบบจะนำไปคูณกับจำนวนชั่วโมงที่เข้าเวรจริง (Clock-in ถึง Clock-out) ในการตัดยอดเงินเดือนรายเดือน</p>
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => { setShowForm(false); setEditItem(null); setPhotoPreview(null); setPhotoFile(null); }} className="btn-secondary flex-1">ยกเลิก</button>
              <button type="submit" disabled={uploadingPhoto} className="btn-primary flex-1 disabled:opacity-50">
                {uploadingPhoto ? 'กำลังอัปโหลด...' : editItem ? 'บันทึก' : 'เพิ่มเจ้าหน้าที่'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Add Officer Wizard */}
      {wizardOpen && (
        <Modal
          title={`เพิ่มเจ้าหน้าที่ด้วย Wizard (ขั้น ${wizardStep}/3)`}
          onClose={() => setWizardOpen(false)}
          size="lg"
        >
          {/* Stepper */}
          <div className="flex items-center gap-2 mb-6">
            {[1, 2, 3].map((n) => (
              <div key={n} className="flex-1 flex items-center gap-2">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold ${wizardStep >= n ? 'bg-amber-500 text-navy-900' : 'bg-navy-700 text-gray-500'}`}>
                  {n}
                </div>
                {n < 3 && <div className={`flex-1 h-0.5 ${wizardStep > n ? 'bg-amber-500' : 'bg-navy-700'}`} />}
              </div>
            ))}
          </div>

          {/* Step 1 — เลือก template */}
          {wizardStep === 1 && (
            <div className="space-y-4">
              <p className="text-sm text-gray-400">เลือกเจ้าหน้าที่ template (ไม่บังคับ) — ระบบจะ auto-fill ตำแหน่ง, แผนก, ค่าขึ้นเวร, หมวดบริการ</p>
              <select
                className="input-field"
                value={wizardTemplate?.id ?? ''}
                onChange={(e) => {
                  const t = officers.find((o) => o.id === e.target.value);
                  if (t) applyTemplate(t);
                  else { setWizardTemplate(null); }
                }}
              >
                <option value="">— ข้าม (ใช้ค่า default) —</option>
                {officers.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name} — {DEPARTMENT_LABELS[o.department]}
                  </option>
                ))}
              </select>
              {wizardTemplate && (
                <div className="card p-3 text-xs text-gray-400 space-y-1">
                  <div>ตำแหน่ง: <span className="text-white">{wizardTemplate.rank}</span></div>
                  <div>แผนก: <span className="text-white">{DEPARTMENT_LABELS[wizardTemplate.department]}</span></div>
                  <div>ค่าขึ้นเวร: <span className="text-white">{wizardTemplate.duty_rate ?? 0} BC/ชม.</span></div>
                  <div>หมวดบริการ: <span className="text-white">{wizardTemplate.service_category || '—'}</span></div>
                </div>
              )}
            </div>
          )}

          {/* Step 2 — ข้อมูลส่วนตัว */}
          {wizardStep === 2 && (
            <div className="space-y-4">
              <div className="flex flex-col items-center gap-3">
                <div className="relative w-24 h-24 rounded-xl overflow-hidden border-2 border-amber-500/30 bg-navy-700 flex items-center justify-center">
                  {wizardPhotoPreview ? (
                    <img src={wizardPhotoPreview} alt="preview" className="w-full h-full object-cover" />
                  ) : (
                    <Upload size={24} className="text-gray-600" />
                  )}
                </div>
                <label className="cursor-pointer text-xs text-amber-400 hover:text-amber-300 font-medium">
                  {wizardPhotoPreview ? 'เปลี่ยนรูปภาพ' : 'อัปโหลดรูปถ่าย'}
                  <input type="file" accept="image/*" className="hidden" onChange={handleWizardPhotoSelect} />
                </label>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">ชื่อ-นามสกุล *</label>
                <input required className="input-field" value={wizardForm.name} onChange={(e) => setWizardForm({ ...wizardForm, name: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Username *</label>
                <input required className="input-field font-mono" value={wizardForm.username} onChange={(e) => setWizardForm({ ...wizardForm, username: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">รหัสผ่าน *</label>
                <input required type="password" className="input-field" value={wizardForm.password} onChange={(e) => setWizardForm({ ...wizardForm, password: e.target.value })} />
              </div>
            </div>
          )}

          {/* Step 3 — ตรวจสอบ + แก้ไข */}
          {wizardStep === 3 && (
            <div className="space-y-3">
              <p className="text-xs text-gray-400">ตรวจสอบข้อมูล — สามารถแก้ไขได้ก่อนบันทึก</p>
              <div>
                <label className="block text-xs text-gray-400 mb-1">ชื่อ</label>
                <input className="input-field" value={wizardForm.name} onChange={(e) => setWizardForm({ ...wizardForm, name: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Username</label>
                <input className="input-field font-mono" value={wizardForm.username} onChange={(e) => setWizardForm({ ...wizardForm, username: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">ตำแหน่ง</label>
                  <select className="input-field" value={wizardForm.rank} onChange={(e) => setWizardForm({ ...wizardForm, rank: e.target.value as OfficerRank })}>
                    {ranks.length > 0
                      ? ranks.map((r) => <option key={r.id} value={r.rank_key ?? r.label}>{r.label}</option>)
                      : (Object.entries(RANK_LABELS) as [string, string][]).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">แผนก</label>
                  <select className="input-field" value={wizardForm.department} onChange={(e) => setWizardForm({ ...wizardForm, department: e.target.value as Department })}>
                    {DEPARTMENTS.map((d) => <option key={d} value={d}>{DEPARTMENT_LABELS[d]}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">ค่าขึ้นเวร (BC/ชม.)</label>
                  <input type="number" min={0} step="0.01" className="input-field" value={wizardForm.duty_rate} onChange={(e) => setWizardForm({ ...wizardForm, duty_rate: parseFloat(e.target.value) || 0 })} />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">หมวดบริการ</label>
                  <select className="input-field" value={wizardForm.service_category} onChange={(e) => setWizardForm({ ...wizardForm, service_category: e.target.value })}>
                    <option value="">— ไม่ระบุ —</option>
                    {SERVICE_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="card p-3 text-xs text-amber-300 bg-amber-500/10 border-amber-500/30">
                90% ของค่าบริการที่เจ้าหน้าที่คนนี้บันทึก จะเข้าแผนก <strong>{DEPARTMENT_LABELS[wizardForm.department]}</strong>
              </div>
              {wizardError && <div className="text-xs text-red-400">{wizardError}</div>}
            </div>
          )}

          {/* Navigation */}
          <div className="flex gap-3 pt-4 mt-4 border-t border-blue-900/40">
            <button type="button" onClick={() => setWizardOpen(false)} className="btn-secondary">ยกเลิก</button>
            <div className="flex-1" />
            {wizardStep > 1 && (
              <button type="button" onClick={() => setWizardStep((s) => (s - 1) as 1 | 2 | 3)} className="btn-secondary">ย้อนกลับ</button>
            )}
            {wizardStep < 3 && (
              <button
                type="button"
                onClick={() => setWizardStep((s) => (s + 1) as 1 | 2 | 3)}
                className="btn-primary"
                disabled={wizardStep === 2 && (!wizardForm.name || !wizardForm.username || !wizardForm.password)}
              >
                ถัดไป
              </button>
            )}
            {wizardStep === 3 && (
              <button type="button" onClick={submitWizard} disabled={wizardUploading} className="btn-primary disabled:opacity-50">
                {wizardUploading ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
            )}
          </div>
        </Modal>
      )}

      {/* Confirm Action Dialog */}
      {confirmAction && (
        <ConfirmDialog
          title={`${confirmMessages[confirmAction.type].title} — ${confirmAction.target.name}`}
          message={confirmMessages[confirmAction.type].msg}
          confirmLabel={confirmMessages[confirmAction.type].label}
          danger={confirmAction.type === 'delete' || confirmAction.type === 'suspend'}
          onConfirm={executeAction}
          onCancel={() => { setConfirmAction(null); setResetPw(''); }}
          extraField={
            confirmAction.type === 'reset'
              ? { label: 'รหัสผ่านใหม่', value: resetPw, onChange: setResetPw, placeholder: 'กรอกรหัสผ่านใหม่...' }
              : undefined
          }
        />
      )}

      {/* Officer History Modal */}
      <OfficerHistoryModal officer={historyOfficer} onClose={() => setHistoryOfficer(null)} />

      {/* Batch Duty Rate Modal (กำหนดเรทขึ้นเวรทุกคน) */}
      {showBatchDutyModal && (
        <BatchDutyRateModal
          onClose={() => setShowBatchDutyModal(false)}
          onSaved={async () => {
            setShowBatchDutyModal(false);
            await fetchAll();
          }}
        />
      )}
    </div>
  );
}

/* =========================================================================
 * Subcomponent: BatchDutyRateModal (ตั้งเรทขึ้นเวรทุกคนพร้อมกัน)
 * ========================================================================= */
function BatchDutyRateModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [rateInput, setRateInput] = useState<string>('500');
  const [saving, setSaving] = useState(false);

  const presets = [100, 200, 300, 400, 500, 800, 1000];

  async function handleSave() {
    const num = parseFloat(rateInput);
    if (isNaN(num) || num < 0) {
      alert('กรุณาระบุอัตราค่าขึ้นเวรที่ถูกต้อง (ต้อง >= 0)');
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from('officers')
        .update({ duty_rate: num, updated_at: new Date().toISOString() })
        .neq('status', 'deleted');
      if (error) throw error;
      alert(`ตั้งค่าขึ้นเวรให้เจ้าหน้าที่ทุกคนเป็น ${num.toLocaleString('th-TH')} BC/ชม. เรียบร้อยแล้ว`);
      onSaved();
    } catch (e) {
      alert(`เกิดข้อผิดพลาด: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="⚡ กำหนดอัตราค่าขึ้นเวรให้เจ้าหน้าที่ทุกคน" onClose={onClose} size="md">
      <div className="space-y-4">
        <p className="text-xs text-gray-400">
          ตั้งค่าเรทค่าขึ้นเวร (BC ต่อชั่วโมง) ให้เจ้าหน้าที่ทุกคนในระบบพร้อมกัน โดยระบบจะนำไปคูณกับชั่วโมงทำงานจริงในแต่ละเดือน
        </p>

        <div>
          <label className="block text-xs text-gray-400 mb-1.5">เลือกเรทด่วน:</label>
          <div className="flex flex-wrap gap-1.5">
            {presets.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setRateInput(p.toString())}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold font-mono border transition-all ${
                  rateInput === p.toString()
                    ? 'bg-amber-500 text-black border-amber-400 font-bold'
                    : 'bg-navy-800 text-gray-300 border-blue-900/60 hover:border-amber-500/40'
                }`}
              >
                {p.toLocaleString('th-TH')} BC/ชม.
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">หรือระบุตัวเลขเอง (BC ต่อชั่วโมง):</label>
          <input
            type="number"
            min={0}
            step="10"
            className="input-field font-mono text-lg font-bold text-amber-400"
            value={rateInput}
            onChange={(e) => setRateInput(e.target.value)}
            placeholder="เช่น 500"
          />
        </div>

        <div className="flex gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">ยกเลิก</button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="btn-primary flex-1 flex items-center justify-center gap-1.5 shadow-lg shadow-amber-500/20 disabled:opacity-50"
          >
            <Check size={14} /> {saving ? 'กำลังบันทึก...' : 'บันทึกทุกคนทันที'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ActionBtn({ icon, label, color, onClick }: { icon: ReactNode; label: string; color: string; onClick: () => void }) {
  const colors: Record<string, string> = {
    blue: 'text-blue-400 hover:bg-blue-500/10',
    amber: 'text-amber-400 hover:bg-amber-500/10',
    red: 'text-orange-400 hover:bg-orange-500/10',
    green: 'text-emerald-400 hover:bg-emerald-500/10',
    darkred: 'text-red-400 hover:bg-red-500/10',
  };
  return (
    <button
      title={label}
      onClick={onClick}
      className={`p-1.5 rounded transition-colors text-gray-500 ${colors[color]}`}
    >
      {icon}
    </button>
  );
}
