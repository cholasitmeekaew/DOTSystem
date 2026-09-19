import { useState } from 'react';
import {
  Search, Car, AlertTriangle, CheckCircle2, MapPin, Clock,
  User, FileText, CarFront, Truck as TowTruck, Bike, DollarSign, Lock,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { Vehicle, ServiceRecord, VEHICLE_TYPE_LABELS } from '../../lib/types';

type SearchType = 'plate' | 'roblox' | 'discord';

export function VehicleCheckPage() {
  const [searchType, setSearchType] = useState<SearchType>('plate');
  const [query, setQuery] = useState('');
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [feeRecords, setFeeRecords] = useState<ServiceRecord[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setSearched(false);
    setVehicles([]);
    setFeeRecords([]);

    const q = query.trim();

    if (searchType === 'plate') {
      const normalized = q.toUpperCase().replace(/\s+/g, '');
      const { data } = await supabase
        .from('vehicles')
        .select('*')
        .eq('license_plate', normalized)
        .order('created_at', { ascending: false });
      setVehicles(data ?? []);
      if (data && data.length > 0 && data[0].owner_name) {
        await fetchFees(data[0].owner_name);
      }
    } else {
      const field = searchType === 'roblox' ? 'roblox_username' : 'discord_username';
      const { data: vData } = await supabase
        .from('vehicles')
        .select('*')
        .ilike('owner_name', `%${q}%`)
        .order('created_at', { ascending: false });
      setVehicles(vData ?? []);
      await fetchFees(q, field);
    }

    setSearched(true);
    setSearching(false);
  }

  async function fetchFees(username: string, field?: string) {
    const fieldKey = field ?? (searchType === 'roblox' ? 'roblox_username' : 'discord_username');
    const { data: fees } = await supabase
      .from('service_records')
      .select('*')
      .ilike(fieldKey, `%${username}%`)
      .order('created_at', { ascending: false })
      .limit(20);
    setFeeRecords(fees ?? []);
  }

  const formatDate = (iso: string | null) => {
    if (!iso) return '-';
    return new Date(iso).toLocaleString('th-TH', {
      year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  };

  const formatMoney = (n: number) => Number(n).toLocaleString('th-TH') + ' BC';

  const vehicleIcon = (type: string) => {
    switch (type) {
      case 'motorcycle': return <Bike size={18} />;
      case 'pickup': return <TowTruck size={18} />;
      case 'truck': return <TowTruck size={18} />;
      case 'van': return <CarFront size={18} />;
      default: return <Car size={18} />;
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 rounded-full px-4 py-1 mb-4">
          <Car size={16} className="text-amber-400" />
          <span className="text-amber-400 text-xs font-semibold tracking-wider">VEHICLE CHECK</span>
        </div>
        <h1 className="text-3xl font-bold text-white mb-2">ตรวจสอบยานพาหนะ</h1>
        <p className="text-gray-400 text-sm">กรอกทะเบียนรถ Discord Username หรือ Roblox Username เพื่อตรวจสอบสถานะการถูกยึดและค่าบริการ</p>
      </div>

      {/* Search Type Tabs */}
      <div className="flex gap-1.5 mb-4 p-1 bg-navy-900 rounded-lg">
        {(['plate', 'roblox', 'discord'] as SearchType[]).map((st) => (
          <button
            key={st}
            onClick={() => { setSearchType(st); setSearched(false); setQuery(''); }}
            className={`flex-1 py-2 rounded-md text-sm font-medium transition-all ${
              searchType === st ? 'bg-amber-500 text-navy-900' : 'text-gray-400 hover:text-white'
            }`}
          >
            {st === 'plate' ? 'ทะเบียนรถ' : st === 'roblox' ? 'Roblox' : 'Discord'}
          </button>
        ))}
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="card p-6 mb-6">
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              className={`input-field pl-10 ${searchType === 'plate' ? 'uppercase' : ''}`}
              placeholder={
                searchType === 'plate' ? 'เช่น กข1234 หรือ 1กข1234' :
                searchType === 'roblox' ? 'ระบุ Roblox Username' :
                'ระบุ Discord Username'
              }
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
          </div>
          <button type="submit" disabled={searching} className="btn-primary flex items-center gap-2 px-6">
            <Search size={16} />
            {searching ? 'กำลังค้นหา...' : 'ค้นหา'}
          </button>
        </div>
        {searchType === 'plate' && <p className="text-xs text-gray-500 mt-2">* ไม่ต้องใส่เว้นวรรค ระบบจะค้นหาอัตโนมัติ</p>}
      </form>

      {/* Not Found */}
      {searched && vehicles.length === 0 && (
        <div className="card p-10 text-center">
          <div className="w-14 h-14 bg-gray-500/10 border-2 border-gray-500/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Search size={28} className="text-gray-500" />
          </div>
          <h3 className="text-white font-semibold mb-1">ไม่พบข้อมูลยานพาหนะ</h3>
          <p className="text-gray-400 text-sm">ไม่พบข้อมูลสำหรับ "{query}" ในระบบ อาจไม่ได้ถูกยึดหรือยังไม่ได้ลงทะเบียน</p>
        </div>
      )}

      {/* Results */}
      {vehicles.length > 0 && (
        <div className="space-y-4">
          {vehicles.map((vehicle) => (
            <div key={vehicle.id} className={`card p-6 ${vehicle.is_impounded ? 'border-red-500/30' : 'border-emerald-500/30'}`}>
              <div className="flex items-start gap-4">
                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 ${
                  vehicle.is_impounded
                    ? 'bg-red-500/10 border-2 border-red-500/30'
                    : 'bg-emerald-500/10 border-2 border-emerald-500/30'
                }`}>
                  {vehicle.is_impounded
                    ? <AlertTriangle size={28} className="text-red-400 animate-pulse" />
                    : <CheckCircle2 size={28} className="text-emerald-400" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h3 className="text-xl font-bold text-white">{vehicle.license_plate}</h3>
                    {vehicle.is_impounded ? (
                      <span className="inline-flex items-center gap-1 bg-red-500/20 text-red-400 border border-red-500/30 px-2 py-0.5 rounded-full text-xs font-medium">
                        <div className="w-1.5 h-1.5 bg-red-400 rounded-full animate-pulse" /> ถูกยึด
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full text-xs font-medium">
                        <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full" /> ปกติ
                      </span>
                    )}
                  </div>
                  <p className={`text-sm mb-4 ${vehicle.is_impounded ? 'text-red-400' : 'text-emerald-400'}`}>
                    {vehicle.is_impounded
                      ? 'ยานพาหนะคันนี้ถูกยึดอยู่ในขณะนี้ กรุณาติดต่อเจ้าหน้าที่ DOT'
                      : 'ยานพาหนะคันนี้ไม่ได้ถูกยึด สามารถใช้งานได้ปกติ'}
                  </p>

                  {/* Impound Image */}
                  {vehicle.is_impounded && vehicle.image_url && (
                    <div className="rounded-lg overflow-hidden border border-red-500/20 bg-navy-900 mb-4">
                      <img src={vehicle.image_url} alt="ยานพาหนะที่ถูกยึด" className="w-full max-h-56 object-contain" />
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-4 pt-4 border-t border-blue-900/30">
                    <DetailItem icon={vehicleIcon(vehicle.vehicle_type)} label="ประเภท" value={VEHICLE_TYPE_LABELS[vehicle.vehicle_type]} />
                    <DetailItem icon={<User size={14} />} label="เจ้าของ" value={vehicle.owner_name || '-'} />
                    <DetailItem icon={<Car size={14} />} label="สี" value={vehicle.color || '-'} />
                    {vehicle.is_impounded && (
                      <>
                        <DetailItem icon={<MapPin size={14} />} label="สถานที่เก็บ" value={vehicle.impound_location || '-'} />
                        <DetailItem icon={<FileText size={14} />} label="เหตุผลที่ยึด" value={vehicle.impound_reason || '-'} />
                        <DetailItem icon={<Clock size={14} />} label="เวลาที่ยึด" value={formatDate(vehicle.impounded_at)} />
                        <DetailItem icon={<User size={14} />} label="เจ้าหน้าที่ที่ยึด" value={vehicle.impounded_by_name || '-'} />
                      </>
                    )}
                    {!vehicle.is_impounded && <DetailItem icon={<FileText size={14} />} label="หมายเหตุ" value={vehicle.notes || '-'} />}
                  </div>

                  {vehicle.released_at && (
                    <div className="mt-4 pt-3 border-t border-blue-900/30">
                      <div className="text-emerald-400 text-xs font-semibold mb-2 flex items-center gap-1.5">
                        <CheckCircle2 size={12} /> ประวัติการปล่อย
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <DetailItem icon={<Clock size={14} />} label="เวลาที่ปล่อย" value={formatDate(vehicle.released_at)} />
                        <DetailItem icon={<User size={14} />} label="เจ้าหน้าที่ที่ปล่อย" value={vehicle.released_by_name || '-'} />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}

          {/* Service Fee Records */}
          {feeRecords.length > 0 && (
            <div className="mt-2">
              <div className="flex items-center gap-2 mb-4">
                <DollarSign size={18} className="text-amber-400" />
                <h3 className="text-lg font-bold text-white">ประวัติค่าบริการ</h3>
                <span className="text-sm text-gray-500">({feeRecords.length} รายการ)</span>
              </div>
              <div className="space-y-3">
                {feeRecords.map((fee) => (
                  <div key={fee.id} className={`card p-4 ${fee.service_type === 'impound' ? 'border-red-500/20' : ''}`}>
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        {fee.service_type === 'impound' ? (
                          <span className="inline-flex items-center gap-1 bg-red-500/15 text-red-400 border border-red-500/20 px-2 py-0.5 rounded text-xs font-medium">
                            <Lock size={10} /> ยึด
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 bg-blue-500/15 text-blue-400 border border-blue-500/20 px-2 py-0.5 rounded text-xs font-medium">
                            <Car size={10} /> ปกติ
                          </span>
                        )}
                        <span className="text-white text-sm font-medium">{fee.service_name}</span>
                      </div>
                      <span className={`text-sm font-bold ${fee.status === 'paid' ? 'text-emerald-400' : 'text-red-400'}`}>
                        {formatMoney(Number(fee.amount))}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs text-gray-500">
                      <span>เจ้าหน้าที่: {fee.officer_name}</span>
                      <span className={`px-1.5 py-0.5 rounded ${fee.status === 'paid' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
                        {fee.status === 'paid' ? 'ชำระแล้ว' : 'ค้างชำระ'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
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
