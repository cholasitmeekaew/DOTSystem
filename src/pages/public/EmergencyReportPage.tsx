import { useState } from 'react';
import {
  Siren, AlertTriangle, CarFront, Wrench, Truck as TowTruck,
  Upload, X, Send, CheckCircle2, MapPin, MessageSquare, User,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { uploadImage } from '../../lib/storage';
import { EmergencyReportType, EMERGENCY_TYPE_LABELS } from '../../lib/types';
import { FadeIn, Stagger, StaggerItem } from '../../components/animations';
import { MapPicker, type MapPickerValue } from '../../components/MapPicker';

const REPORT_TYPES: { type: EmergencyReportType; icon: React.ReactNode; desc: string }[] = [
  { type: 'accident', icon: <AlertTriangle size={22} />, desc: 'อุบัติเหตุ ชนกัน พลิกคว่ำ' },
  { type: 'breakdown', icon: <CarFront size={22} />, desc: 'รถเสีย เครื่องดับ ยางแตก' },
  { type: 'towing', icon: <TowTruck size={22} />, desc: 'ต้องการรถยก ลากจูง' },
  { type: 'other', icon: <Wrench size={22} />, desc: 'เหตุอื่นๆ ที่ต้องการความช่วยเหลือ' },
];

export function EmergencyReportPage() {
  const [form, setForm] = useState({
    discord_username: '',
    report_type: 'accident' as EmergencyReportType,
    details: '',
  });
  const [pin, setPin] = useState<MapPickerValue | null>(null);
  const [locationLabel, setLocationLabel] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setImagePreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!pin && !locationLabel.trim()) return;
    setSubmitting(true);

    let imageUrl: string | null = null;
    if (imageFile) {
      imageUrl = await uploadImage(imageFile, 'evidence');
    }

    const locationValue = pin
      ? JSON.stringify({ map: pin, label: locationLabel.trim() || null })
      : locationLabel.trim();

    await supabase.from('emergency_reports').insert({
      discord_username: form.discord_username || 'ไม่ระบุตัวตน',
      report_type: form.report_type,
      details: form.details,
      location: locationValue,
      image_url: imageUrl,
      status: 'pending',
    });

    setSubmitting(false);
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <FadeIn className="max-w-2xl mx-auto px-6 py-20">
        <div className="card p-10 text-center hover-lift">
          <div className="inline-flex w-16 h-16 bg-emerald-500/10 border-2 border-emerald-500/30 rounded-2xl items-center justify-center mx-auto mb-5 anim-scaleIn">
            <CheckCircle2 size={32} className="text-emerald-400" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">ส่งเรื่องแจ้งเหตุเรียบร้อยแล้ว</h2>
          <p className="text-gray-400 text-sm mb-6 max-w-md mx-auto">
            ระบบได้ส่งข้อมูลไปยังเจ้าหน้าที่ DOT เรียบร้อยแล้ว เจ้าหน้าที่จะดำเนินการให้โดยเร็วที่สุด
          </p>
          <div className="flex gap-3 justify-center">
            <button onClick={() => window.history.back()} className="btn-secondary btn-ripple">กลับ</button>
            <button
              onClick={() => {
                setSubmitted(false);
                setForm({ discord_username: '', report_type: 'accident', details: '' });
                setPin(null);
                setLocationLabel('');
                setImageFile(null);
                setImagePreview(null);
              }}
              className="btn-primary btn-ripple"
            >
              แจ้งเหตุเพิ่ม
            </button>
          </div>
        </div>
      </FadeIn>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <FadeIn className="text-center mb-8">
        <div className="inline-flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-full px-4 py-1 mb-4 anim-float">
          <Siren size={16} className="text-red-400" />
          <span className="text-red-400 text-xs font-semibold tracking-wider">EMERGENCY REPORT</span>
        </div>
        <h1 className="text-3xl font-bold text-white mb-2">แจ้งเหตุฉุกเฉิน / ขอความช่วยเหลือ</h1>
        <p className="text-gray-400 text-sm">กรอกข้อมูลให้ครบถ้วนเพื่อให้เจ้าหน้าที่เข้าช่วยเหลือได้รวดเร็ว</p>
      </FadeIn>

      <Stagger className="card p-6 space-y-6">
        <StaggerItem>
          <div>
            <label className="block text-sm font-semibold text-white mb-3">ประเภทเหตุการณ์ *</label>
            <div className="grid grid-cols-2 gap-3">
              {REPORT_TYPES.map(({ type, icon, desc }) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setForm({ ...form, report_type: type })}
                  className={`flex items-start gap-3 p-4 rounded-xl border-2 text-left transition-all hover-lift ${
                    form.report_type === type
                      ? 'bg-amber-500/10 border-amber-500/40 text-white'
                      : 'bg-navy-700 border-blue-900/40 text-gray-400 hover:border-blue-700/50'
                  }`}
                >
                  <div className={`flex-shrink-0 ${form.report_type === type ? 'text-amber-400' : 'text-gray-500'}`}>
                    {icon}
                  </div>
                  <div>
                    <div className={`font-semibold text-sm ${form.report_type === type ? 'text-white' : 'text-gray-300'}`}>
                      {EMERGENCY_TYPE_LABELS[type]}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">{desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </StaggerItem>

        <StaggerItem>
          <div>
            <label className="block text-sm font-semibold text-white mb-2">
              <User size={14} className="inline mr-1.5 text-amber-400" />
              ชื่อ Discord ผู้แจ้ง
            </label>
            <input
              className="input-field"
              placeholder="discord username (ไม่ระบุก็ได้)"
              value={form.discord_username}
              onChange={(e) => setForm({ ...form, discord_username: e.target.value })}
            />
          </div>
        </StaggerItem>

        <StaggerItem>
          <div>
            <label className="block text-sm font-semibold text-white mb-2">
              <MapPin size={14} className="inline mr-1.5 text-amber-400" />
              พิกัด / สถานที่เกิดเหตุ *
            </label>
            <MapPicker
              value={pin}
              onChange={setPin}
              height={360}
            />
            <div className="mt-2">
              <input
                className="input-field"
                placeholder="ระบุชื่อสถานที่เพิ่มเติม (ไม่บังคับ)"
                value={locationLabel}
                onChange={(e) => setLocationLabel(e.target.value)}
              />
            </div>
            <p className="text-[10px] text-gray-500 mt-1.5">
              * ต้องปักหมุดบนแผนที่ หรือระบุชื่อสถานที่อย่างใดอย่างหนึ่ง
            </p>
          </div>
        </StaggerItem>

        <StaggerItem>
          <div>
            <label className="block text-sm font-semibold text-white mb-2">
              <MessageSquare size={14} className="inline mr-1.5 text-amber-400" />
              รายละเอียดเหตุการณ์ *
            </label>
            <textarea
              required
              className="input-field"
              rows={4}
              placeholder="อธิบายเหตุการณ์ที่เกิดขึ้นโดยละเอียด..."
              value={form.details}
              onChange={(e) => setForm({ ...form, details: e.target.value })}
            />
          </div>
        </StaggerItem>

        <StaggerItem>
          <div>
            <label className="block text-sm font-semibold text-white mb-2">
              <Upload size={14} className="inline mr-1.5 text-amber-400" />
              รูปภาพหลักฐานจากที่เกิดเหตุ
            </label>
            {imagePreview ? (
              <div className="relative group">
                <img src={imagePreview} alt="evidence" className="w-full max-h-56 object-contain rounded-lg border border-blue-900/50 bg-navy-900" />
                <button
                  type="button"
                  onClick={() => { setImagePreview(null); setImageFile(null); }}
                  className="absolute top-2 right-2 w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center"
                >
                  <X size={16} className="text-white" />
                </button>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center gap-2 py-8 border-2 border-dashed border-blue-900/50 rounded-lg cursor-pointer hover:border-amber-500/40 hover:bg-navy-700/30 transition-all hover-lift">
                <Upload size={28} className="text-gray-600" />
                <span className="text-xs text-gray-500">คลิกเพื่อแนบรูปภาพเหตุการณ์ (ไม่บังคับ)</span>
                <input type="file" accept="image/*" className="hidden" onChange={handleImageSelect} />
              </label>
            )}
          </div>
        </StaggerItem>

        <StaggerItem>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => window.history.back()} className="btn-secondary flex-1 btn-ripple">ยกเลิก</button>
            <button
              type="submit"
              disabled={submitting}
              onClick={handleSubmit}
              className="flex-1 bg-red-600 hover:bg-red-500 text-white font-semibold px-4 py-2.5 rounded-lg transition-all text-sm flex items-center justify-center gap-2 disabled:opacity-50 btn-ripple"
            >
              <Send size={16} />
              {submitting ? 'กำลังส่ง...' : 'ส่งเรื่องแจ้งเหตุ'}
            </button>
          </div>
        </StaggerItem>
      </Stagger>

      <FadeIn delay={0.3} className="mt-6 flex items-start gap-2.5 text-xs text-gray-500">
        <AlertTriangle size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />
        <p>กรุณาแจ้งเฉพาะเหตุการณ์จริง การแจ้งเท็จอาจมีการดำเนินการตามกฎของระบบ</p>
      </FadeIn>
    </div>
  );
}
