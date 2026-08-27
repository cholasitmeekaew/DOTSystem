import { useEffect, useState, ReactNode } from 'react';
import {
  Plus, Edit2, Trash2, Users, Shield, ShieldOff, Key, Search, Upload, X,
  Tag, History,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { hashPassword } from '../../lib/crypto';
import { uploadImage } from '../../lib/storage';
import {
  Officer, OfficerRank, OfficerRankRecord, Department,
  RANK_LABELS, DEPARTMENT_LABELS, DEPARTMENTS, COMMISSIONER_RANK,
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

  // Rank management state
  const [ranks, setRanks] = useState<OfficerRankRecord[]>([]);
  const [showRankForm, setShowRankForm] = useState(false);
  const [rankForm, setRankForm] = useState({ label: '', rank_key: '', sort_order: 0 });
  const [editingRank, setEditingRank] = useState<OfficerRankRecord | null>(null);

  const [form, setForm] = useState({
    username: '',
    password: '',
    name: '',
    rank: 'officer' as OfficerRank,
    department: 'traffic_management' as Department,
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
    setForm({ username: '', password: '', name: '', rank: defaultRank, department: 'traffic_management' });
    setPhotoPreview(null);
    setPhotoFile(null);
    setShowForm(true);
  }

  function openEdit(item: Officer) {
    setEditItem(item);
    setForm({ username: item.username, password: '', name: item.name, rank: item.rank, department: item.department });
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

    if (editItem) {
      const update: Partial<Officer> & { updated_at: string } = {
        name: form.name,
        rank: form.rank,
        department: form.department,
        photo_url: photoUrl,
        updated_at: new Date().toISOString(),
      };
      if (form.password) {
        update.password_hash = await hashPassword(form.password);
      }
      await supabase.from('officers').update(update).eq('id', editItem.id);
    } else {
      if (!form.password) return;
      const hash = await hashPassword(form.password);
      const { error } = await supabase.from('officers').insert({
        username: form.username,
        password_hash: hash,
        name: form.name,
        rank: form.rank,
        department: form.department,
        photo_url: photoUrl,
        status: 'active',
        is_on_duty: false,
      });
      if (error) {
        alert('ไม่สามารถเพิ่มเจ้าหน้าที่ได้ อาจมี Username ซ้ำ');
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
            <button onClick={openAddRank} className="btn-secondary flex items-center gap-2">
              <Tag size={16} /> จัดการตำแหน่ง
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
                    <td className="px-5 py-4 text-sm text-gray-400">{DEPARTMENT_LABELS[o.department]}</td>
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
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => { setShowForm(false); setEditItem(null); setPhotoPreview(null); setPhotoFile(null); }} className="btn-secondary flex-1">ยกเลิก</button>
              <button type="submit" disabled={uploadingPhoto} className="btn-primary flex-1 disabled:opacity-50">
                {uploadingPhoto ? 'กำลังอัปโหลด...' : editItem ? 'บันทึก' : 'เพิ่มเจ้าหน้าที่'}
              </button>
            </div>
          </form>
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
    </div>
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
