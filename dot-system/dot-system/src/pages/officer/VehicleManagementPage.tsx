import { useEffect, useState } from 'react';
import {
  Car, Search, Plus, Trash2, AlertTriangle, CheckCircle2,
  MapPin, Clock, User, FileText, CarFront, Truck as TowTruck, Bike,
  Lock, Unlock, Eye, Upload, X,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { uploadImage, deleteImage } from '../../lib/storage';
import { Vehicle, VehicleType, VEHICLE_TYPE_LABELS } from '../../lib/types';
import { useAuth } from '../../lib/AuthContext';
import { Badge } from '../../components/Badge';
import { Modal, ConfirmDialog } from '../../components/Modal';
import { PageHeader } from '../../components/PageHeader';

const VEHICLE_TYPES: VehicleType[] = ['sedan', 'suv', 'pickup', 'motorcycle', 'truck', 'van', 'other'];

function vehicleIcon(type: VehicleType) {
  switch (type) {
    case 'motorcycle': return <Bike size={16} />;
    case 'pickup': return <TowTruck size={16} />;
    case 'truck': return <TowTruck size={16} />;
    case 'van': return <CarFront size={16} />;
    default: return <Car size={16} />;
  }
}

export function VehicleManagementPage() {
  const { officer, isCommissioner } = useAuth();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'impounded' | 'clear'>('all');

  const [showAdd, setShowAdd] = useState(false);
  const [viewVehicle, setViewVehicle] = useState<Vehicle | null>(null);
  const [impoundVehicle, setImpoundVehicle] = useState<Vehicle | null>(null);
  const [deleteVehicle, setDeleteVehicle] = useState<Vehicle | null>(null);

  // Add form
  const [newVehicle, setNewVehicle] = useState({
    license_plate: '',
    owner_name: '',
    vehicle_type: 'sedan' as VehicleType,
    color: '',
    notes: '',
  });

  // Impound form
  const [impoundForm, setImpoundForm] = useState({ reason: '', location: '' });
  const [impoundImage, setImpoundImage] = useState<File | null>(null);
  const [impoundImagePreview, setImpoundImagePreview] = useState<string | null>(null);
  const [impoundUploading, setImpoundUploading] = useState(false);

  useEffect(() => { fetchVehicles(); }, []);

  async function fetchVehicles() {
    setLoading(true);
    const { data } = await supabase
      .from('vehicles')
      .select('*')
      .order('created_at', { ascending: false });
    setVehicles(data ?? []);
    setLoading(false);
  }

  async function handleAdd() {
    if (!newVehicle.license_plate.trim()) return;
    const plate = newVehicle.license_plate.trim().toUpperCase().replace(/\s+/g, '');
    await supabase.from('vehicles').insert({
      license_plate: plate,
      owner_name: newVehicle.owner_name || null,
      vehicle_type: newVehicle.vehicle_type,
      color: newVehicle.color || null,
      notes: newVehicle.notes || null,
    });
    setShowAdd(false);
    setNewVehicle({ license_plate: '', owner_name: '', vehicle_type: 'sedan', color: '', notes: '' });
    await fetchVehicles();
  }

  async function handleImpound() {
    if (!impoundVehicle || !officer) return;
    setImpoundUploading(true);

    let imageUrl = impoundVehicle.image_url ?? null;
    if (impoundImage) {
      const uploaded = await uploadImage(impoundImage, 'vehicles');
      if (uploaded) imageUrl = uploaded;
    }

    await supabase.from('vehicles').update({
      is_impounded: true,
      impound_reason: impoundForm.reason,
      impound_location: impoundForm.location,
      impounded_at: new Date().toISOString(),
      impounded_by: officer.id,
      impounded_by_name: officer.name,
      image_url: imageUrl,
      updated_at: new Date().toISOString(),
    }).eq('id', impoundVehicle.id);

    await supabase.from('audit_logs').insert({
      action: 'IMPOUND_VEHICLE',
      target_type: 'vehicle',
      target_id: impoundVehicle.id,
      performed_by: officer.id,
      performed_by_name: officer.name,
      details: { plate: impoundVehicle.license_plate, reason: impoundForm.reason },
    });

    setImpoundVehicle(null);
    setImpoundForm({ reason: '', location: '' });
    setImpoundImage(null);
    setImpoundImagePreview(null);
    setImpoundUploading(false);
    await fetchVehicles();
  }

  async function handleRelease(v: Vehicle) {
    if (!officer) return;
    await supabase.from('vehicles').update({
      is_impounded: false,
      released_at: new Date().toISOString(),
      released_by: officer.id,
      released_by_name: officer.name,
      updated_at: new Date().toISOString(),
    }).eq('id', v.id);

    await supabase.from('audit_logs').insert({
      action: 'RELEASE_VEHICLE',
      target_type: 'vehicle',
      target_id: v.id,
      performed_by: officer.id,
      performed_by_name: officer.name,
      details: { plate: v.license_plate },
    });

    setViewVehicle(null);
    await fetchVehicles();
  }

  async function handleDelete() {
    if (!deleteVehicle || !officer) return;
    if (deleteVehicle.image_url) deleteImage(deleteVehicle.image_url);
    await supabase.from('vehicles').delete().eq('id', deleteVehicle.id);
    await supabase.from('audit_logs').insert({
      action: 'DELETE_VEHICLE',
      target_type: 'vehicle',
      target_id: deleteVehicle.id,
      performed_by: officer.id,
      performed_by_name: officer.name,
      details: { plate: deleteVehicle.license_plate },
    });
    setDeleteVehicle(null);
    await fetchVehicles();
  }

  function handleImpoundImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImpoundImage(file);
    const reader = new FileReader();
    reader.onload = (ev) => setImpoundImagePreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  }

  const filtered = vehicles.filter((v) => {
    const matchSearch = !search || v.license_plate.toLowerCase().includes(search.toLowerCase()) ||
      (v.owner_name?.toLowerCase().includes(search.toLowerCase()) ?? false);
    const matchFilter = filter === 'all' || (filter === 'impounded' && v.is_impounded) || (filter === 'clear' && !v.is_impounded);
    return matchSearch && matchFilter;
  });

  const formatDate = (iso: string | null) => {
    if (!iso) return '-';
    return new Date(iso).toLocaleString('th-TH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div>
      <PageHeader
        icon={<Car size={26} />}
        title="ระบบยานพาหนะ"
        subtitle="ลงทะเบียน ตรวจสอบ และจัดการการยึดยานพาหนะ"
        actions={
          <button onClick={() => setShowAdd(true)} className="btn-primary flex items-center gap-2">
            <Plus size={16} /> เพิ่มยานพาหนะ
          </button>
        }
      />

      {/* Search + Filter */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <span className="ph-corner ph-corner-tl" aria-hidden />
        <span className="ph-corner ph-corner-br" aria-hidden />
        <div className="relative flex-1">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            className="input-field pl-10"
            placeholder="ค้นหาด้วยทะเบียนหรือชื่อเจ้าของ..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          {(['all', 'impounded', 'clear'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                filter === f ? 'bg-amber-500 text-navy-900' : 'btn-secondary'
              }`}
            >
              {f === 'all' ? 'ทั้งหมด' : f === 'impounded' ? 'ถูกยึด' : 'ปกติ'}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => <div key={i} className="card p-5 animate-pulse h-40" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card p-16 text-center">
          <Car size={40} className="text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400">ไม่พบยานพาหนะ</p>
        </div>
      ) : (
        <div className="table-panel">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((v) => (
            <div key={v.id} className={`card p-4 ${v.is_impounded ? 'border-red-500/30' : ''}`}>
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                    v.is_impounded ? 'bg-red-500/15 text-red-400' : 'bg-blue-900/40 text-blue-400'
                  }`}>
                    {vehicleIcon(v.vehicle_type)}
                  </div>
                  <div>
                    <div className="text-white font-bold text-sm">{v.license_plate}</div>
                    <div className="text-gray-500 text-xs">{VEHICLE_TYPE_LABELS[v.vehicle_type]}</div>
                  </div>
                </div>
                {v.is_impounded ? (
                  <Badge variant="danger">
                    <span className="flex items-center gap-1">
                      <Lock size={10} /> ถูกยึด
                    </span>
                  </Badge>
                ) : (
                  <Badge variant="success">
                    <span className="flex items-center gap-1">
                      <CheckCircle2 size={10} /> ปกติ
                    </span>
                  </Badge>
                )}
              </div>

              <div className="space-y-1 mb-3">
                {v.owner_name && (
                  <div className="flex items-center gap-1.5 text-xs text-gray-400">
                    <User size={12} className="text-gray-500" /> {v.owner_name}
                  </div>
                )}
                {v.color && (
                  <div className="flex items-center gap-1.5 text-xs text-gray-400">
                    <Car size={12} className="text-gray-500" /> {v.color}
                  </div>
                )}
                {v.is_impounded && v.image_url && (
                  <div className="w-full h-28 overflow-hidden rounded-lg mb-2 bg-navy-900">
                    <img src={v.image_url} alt={v.license_plate} className="w-full h-full object-cover" />
                  </div>
                )}
                {v.is_impounded && v.impound_location && (
                  <div className="flex items-center gap-1.5 text-xs text-red-400">
                    <MapPin size={12} /> {v.impound_location}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setViewVehicle(v)}
                  className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-blue-500/15 text-blue-400 border border-blue-500/20 hover:bg-blue-500/25 transition-colors text-xs font-medium"
                >
                  <Eye size={13} /> ดู
                </button>
                {!v.is_impounded ? (
                  <button
                    onClick={() => { setImpoundVehicle(v); setImpoundForm({ reason: '', location: '' }); }}
                    className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-red-500/15 text-red-400 border border-red-500/20 hover:bg-red-500/25 transition-colors text-xs font-medium"
                  >
                    <Lock size={13} /> ยึด
                  </button>
                ) : (
                  <button
                    onClick={() => handleRelease(v)}
                    className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/25 transition-colors text-xs font-medium"
                  >
                    <Unlock size={13} /> ปล่อย
                  </button>
                )}
                {isCommissioner && (
                  <button
                    onClick={() => setDeleteVehicle(v)}
                    className="px-2 py-1.5 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors text-xs"
                    title="ลบ"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        </div>
      )}

      {/* Add Modal */}
      {showAdd && (
        <Modal title="เพิ่มยานพาหนะใหม่" onClose={() => setShowAdd(false)} size="lg">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-white mb-2">ทะเบียนรถ *</label>
                <input
                  className="input-field uppercase"
                  placeholder="กข1234"
                  value={newVehicle.license_plate}
                  onChange={(e) => setNewVehicle({ ...newVehicle, license_plate: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-white mb-2">ประเภท</label>
                <select
                  className="input-field"
                  value={newVehicle.vehicle_type}
                  onChange={(e) => setNewVehicle({ ...newVehicle, vehicle_type: e.target.value as VehicleType })}
                >
                  {VEHICLE_TYPES.map((t) => (
                    <option key={t} value={t}>{VEHICLE_TYPE_LABELS[t]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-white mb-2">ชื่อเจ้าของ</label>
                <input
                  className="input-field"
                  placeholder="ชื่อเจ้าของรถ"
                  value={newVehicle.owner_name}
                  onChange={(e) => setNewVehicle({ ...newVehicle, owner_name: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-white mb-2">สีรถ</label>
                <input
                  className="input-field"
                  placeholder="สี"
                  value={newVehicle.color}
                  onChange={(e) => setNewVehicle({ ...newVehicle, color: e.target.value })}
                />
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-semibold text-white mb-2">หมายเหตุ</label>
                <textarea
                  className="input-field"
                  rows={2}
                  placeholder="หมายเหตุเพิ่มเติม..."
                  value={newVehicle.notes}
                  onChange={(e) => setNewVehicle({ ...newVehicle, notes: e.target.value })}
                />
              </div>
            </div>
            <div className="flex gap-3 justify-end pt-2">
              <button onClick={() => setShowAdd(false)} className="btn-secondary">ยกเลิก</button>
              <button onClick={handleAdd} className="btn-primary flex items-center gap-2">
                <Plus size={16} /> เพิ่ม
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Impound Modal */}
      {impoundVehicle && (
        <Modal title={`ยึดยานพาหนะ: ${impoundVehicle.license_plate}`} onClose={() => setImpoundVehicle(null)} size="md">
          <div className="space-y-4">
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
              <AlertTriangle size={18} className="text-red-400 flex-shrink-0" />
              <span className="text-red-400 text-sm">การยึดจะทำให้ยานพาหนะคันนี้แสดงสถานะ "ถูกยึด" ทันที</span>
            </div>
            <div>
              <label className="block text-sm font-semibold text-white mb-2">เหตุผลที่ยึด *</label>
              <input
                className="input-field"
                placeholder="เช่น จอดผิดกฎจราจร รถชนแล้วหนี..."
                value={impoundForm.reason}
                onChange={(e) => setImpoundForm({ ...impoundForm, reason: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-white mb-2">สถานที่เก็บ *</label>
              <input
                className="input-field"
                placeholder="เช่น สถานี DOT สาขากลาง ลานจอด A"
                value={impoundForm.location}
                onChange={(e) => setImpoundForm({ ...impoundForm, location: e.target.value })}
              />
            </div>

            {/* Image Upload */}
            <div>
              <label className="block text-sm font-semibold text-white mb-2">รูปภาพยานพาหนะที่ถูกยึด</label>
              {impoundImagePreview ? (
                <div className="relative group">
                  <img src={impoundImagePreview} alt="vehicle" className="w-full max-h-48 object-contain rounded-lg border border-blue-900/50 bg-navy-900" />
                  <button
                    type="button"
                    onClick={() => { setImpoundImagePreview(null); setImpoundImage(null); }}
                    className="absolute top-2 right-2 w-7 h-7 bg-red-600 rounded-lg flex items-center justify-center"
                  >
                    <X size={16} className="text-white" />
                  </button>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center gap-2 py-6 border-2 border-dashed border-blue-900/50 rounded-lg cursor-pointer hover:border-amber-500/40 hover:bg-navy-700/30 transition-all">
                  <Upload size={24} className="text-gray-600" />
                  <span className="text-xs text-gray-500">คลิกเพื่ออัปโหลดรูปยานพาหนะ</span>
                  <input type="file" accept="image/*" className="hidden" onChange={handleImpoundImageSelect} />
                </label>
              )}
            </div>

            <div className="flex gap-3 justify-end pt-2">
              <button onClick={() => setImpoundVehicle(null)} className="btn-secondary">ยกเลิก</button>
              <button
                onClick={handleImpound}
                disabled={!impoundForm.reason.trim() || !impoundForm.location.trim() || impoundUploading}
                className="bg-red-600 hover:bg-red-500 text-white font-semibold px-4 py-2 rounded-lg transition-colors text-sm flex items-center gap-2 disabled:opacity-50"
              >
                <Lock size={16} /> {impoundUploading ? 'กำลังอัปโหลด...' : 'ยืนยันการยึด'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Detail Modal */}
      {viewVehicle && (
        <Modal title={`ยานพาหนะ: ${viewVehicle.license_plate}`} onClose={() => setViewVehicle(null)} size="lg">
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              {viewVehicle.is_impounded ? (
                <Badge variant="danger"><span className="flex items-center gap-1"><Lock size={10} /> ถูกยึด</span></Badge>
              ) : (
                <Badge variant="success"><span className="flex items-center gap-1"><CheckCircle2 size={10} /> ปกติ</span></Badge>
              )}
              <span className="text-gray-500 text-xs">ลงทะเบียนเมื่อ {formatDate(viewVehicle.created_at)}</span>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <DetailItem icon={vehicleIcon(viewVehicle.vehicle_type)} label="ประเภท" value={VEHICLE_TYPE_LABELS[viewVehicle.vehicle_type]} />
              <DetailItem icon={<Car size={14} />} label="สี" value={viewVehicle.color || '-'} />
              <DetailItem icon={<User size={14} />} label="เจ้าของ" value={viewVehicle.owner_name || '-'} />
              <DetailItem icon={<FileText size={14} />} label="หมายเหตุ" value={viewVehicle.notes || '-'} />
            </div>

            {viewVehicle.is_impounded && (
              <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-4 space-y-3">
                <h4 className="text-red-400 text-sm font-semibold flex items-center gap-1.5">
                  <AlertTriangle size={14} /> ข้อมูลการยึด
                </h4>
                {viewVehicle.image_url && (
                  <div className="rounded-lg overflow-hidden border border-red-500/20 bg-navy-900">
                    <img src={viewVehicle.image_url} alt="impounded vehicle" className="w-full max-h-64 object-contain" />
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <DetailItem icon={<FileText size={14} />} label="เหตุผล" value={viewVehicle.impound_reason || '-'} />
                  <DetailItem icon={<MapPin size={14} />} label="สถานที่เก็บ" value={viewVehicle.impound_location || '-'} />
                  <DetailItem icon={<Clock size={14} />} label="เวลาที่ยึด" value={formatDate(viewVehicle.impounded_at)} />
                  <DetailItem icon={<User size={14} />} label="เจ้าหน้าที่" value={viewVehicle.impounded_by_name || '-'} />
                </div>
              </div>
            )}

            {viewVehicle.released_at && (
              <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-4 space-y-2">
                <h4 className="text-emerald-400 text-sm font-semibold flex items-center gap-1.5">
                  <Unlock size={14} /> ข้อมูลการปล่อย
                </h4>
                <div className="grid grid-cols-2 gap-3">
                  <DetailItem icon={<Clock size={14} />} label="เวลาที่ปล่อย" value={formatDate(viewVehicle.released_at)} />
                  <DetailItem icon={<User size={14} />} label="เจ้าหน้าที่" value={viewVehicle.released_by_name || '-'} />
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2 pt-3 border-t border-amber-500/15">
              {viewVehicle.is_impounded && (
                <button onClick={() => handleRelease(viewVehicle)} className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
                  <Unlock size={15} /> ปล่อยยานพาหนะ
                </button>
              )}
              {!viewVehicle.is_impounded && (
                <button
                  onClick={() => { setImpoundVehicle(viewVehicle); setViewVehicle(null); setImpoundForm({ reason: '', location: '' }); }}
                  className="flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                >
                  <Lock size={15} /> ยึดยานพาหนะ
                </button>
              )}
              {isCommissioner && (
                <button
                  onClick={() => { setDeleteVehicle(viewVehicle); setViewVehicle(null); }}
                  className="btn-danger flex items-center gap-2 ml-auto"
                >
                  <Trash2 size={15} /> ลบ
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* Delete Confirm */}
      {deleteVehicle && (
        <ConfirmDialog
          title="ลบข้อมูลยานพาหนะ"
          message={`ต้องการลบยานพาหนะทะเบียน "${deleteVehicle.license_plate}" ออกจากระบบใช่หรือไม่?`}
          confirmLabel="ลบ"
          danger
          onConfirm={handleDelete}
          onCancel={() => setDeleteVehicle(null)}
        />
      )}
    </div>
  );
}

function DetailItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-gray-500 mb-1 flex items-center gap-1">
        <span className="text-amber-400">{icon}</span>
        {label}
      </div>
      <div className="text-white text-sm">{value}</div>
    </div>
  );
}
