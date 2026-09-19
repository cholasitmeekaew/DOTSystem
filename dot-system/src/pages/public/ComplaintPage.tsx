import React, { useState } from 'react';
import {
  MessageSquare, Send, CheckCircle, AlertTriangle, Paperclip, Lock, Info,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';

type Status = 'idle' | 'submitting' | 'success' | 'error';

export function ComplaintPage() {
  const [status, setStatus] = useState<Status>('idle');
  const [form, setForm] = useState({
    discord_username: '',
    officer_name: '',
    incident_datetime: '',
    details: '',
    evidence_url: '',
  });
  const [errors, setErrors] = useState<Partial<typeof form>>({});

  function validate() {
    const e: Partial<typeof form> = {};
    if (!form.discord_username.trim()) e.discord_username = 'กรุณากรอก Discord Username หรือระบุว่า "ไม่ระบุตัวตน"';
    if (!form.incident_datetime.trim()) e.incident_datetime = 'กรุณาระบุวัน เวลา และสถานที่เกิดเหตุ';
    if (!form.details.trim() || form.details.trim().length < 20) e.details = 'กรุณาให้รายละเอียดอย่างน้อย 20 ตัวอักษร';
    return e;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    setErrors({});
    setStatus('submitting');

    const { error } = await supabase.from('complaints').insert({
      discord_username: form.discord_username.trim(),
      officer_name: form.officer_name.trim(),
      incident_datetime: form.incident_datetime.trim(),
      details: form.details.trim(),
      evidence_url: form.evidence_url.trim(),
    });

    setStatus(error ? 'error' : 'success');
  }

  function handleChange(field: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }));
  }

  if (status === 'success') {
    return (
      <div className="max-w-2xl mx-auto px-6 py-20 text-center">
        <div className="w-20 h-20 bg-emerald-500/10 border-2 border-emerald-500/30 rounded-full flex items-center justify-center mx-auto mb-6">
          <CheckCircle size={36} className="text-emerald-400" />
        </div>
        <h2 className="text-2xl font-bold text-white mb-3">ส่งเรื่องร้องเรียนสำเร็จ</h2>
        <p className="text-gray-400 mb-2">ขอบคุณที่แจ้งเรื่องมายัง DOT</p>
        <p className="text-gray-500 text-sm max-w-md mx-auto mb-8">
          เรื่องร้องเรียนของท่านได้รับการบันทึกเรียบร้อยแล้ว หัวหน้ากรมจะดำเนินการตรวจสอบและติดต่อกลับหากจำเป็น
        </p>
        <button
          onClick={() => { setStatus('idle'); setForm({ discord_username: '', officer_name: '', incident_datetime: '', details: '', evidence_url: '' }); }}
          className="btn-secondary"
        >
          ส่งเรื่องใหม่
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      {/* Header */}
      <div className="text-center mb-10">
        <div className="inline-flex w-16 h-16 bg-red-900/30 border border-red-700/40 rounded-2xl items-center justify-center mb-4">
          <MessageSquare size={28} className="text-red-400" />
        </div>
        <h1 className="text-2xl font-bold text-white mb-3">
          ศูนย์รับเรื่องร้องเรียนการปฏิบัติหน้าที่ของเจ้าหน้าที่
        </h1>
        <p className="text-gray-400 text-sm leading-relaxed max-w-lg mx-auto">
          หากท่านพบพฤติกรรมไม่เหมาะสม ไม่ได้รับความสะดวก หรือพบการทุจริตของเจ้าหน้าที่ DOT
          สามารถแจ้งเรื่องได้ที่นี่
        </p>
        <div className="inline-flex items-center gap-2 mt-3 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-3 py-1">
          <Lock size={11} className="text-emerald-400" />
          <span className="text-emerald-400 text-xs font-medium">ข้อมูลของท่านจะถูกเก็บเป็นความลับสูงสุด</span>
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Discord Username */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">
            Discord Username ผู้ร้องเรียน <span className="text-red-400">*</span>
          </label>
          <input
            className={`input-field ${errors.discord_username ? 'border-red-500/60' : ''}`}
            placeholder='กรอก Discord Username หรือพิมพ์ว่า "ไม่ระบุตัวตน"'
            value={form.discord_username}
            onChange={(e) => handleChange('discord_username', e.target.value)}
          />
          {errors.discord_username && <p className="text-red-400 text-xs mt-1">{errors.discord_username}</p>}
        </div>

        {/* Officer Name */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">
            ชื่อเจ้าหน้าที่ หรือเลขรหัสประจำตัว
            <span className="text-gray-500 font-normal text-xs ml-1">(ถ้าทราบ)</span>
          </label>
          <input
            className="input-field"
            placeholder="ชื่อ หรือ ID เจ้าหน้าที่..."
            value={form.officer_name}
            onChange={(e) => handleChange('officer_name', e.target.value)}
          />
        </div>

        {/* Incident Date/Time/Location */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">
            วัน เวลา และสถานที่เกิดเหตุ <span className="text-red-400">*</span>
          </label>
          <input
            className={`input-field ${errors.incident_datetime ? 'border-red-500/60' : ''}`}
            placeholder="เช่น วันที่ 4 กรกฎาคม 2569 เวลา 14:30 น. บริเวณถนนสายหลักใกล้ธนาคาร"
            value={form.incident_datetime}
            onChange={(e) => handleChange('incident_datetime', e.target.value)}
          />
          {errors.incident_datetime && <p className="text-red-400 text-xs mt-1">{errors.incident_datetime}</p>}
        </div>

        {/* Complaint Details */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">
            รายละเอียดการร้องเรียน / พฤติกรรมที่พบเจอ <span className="text-red-400">*</span>
          </label>
          <textarea
            className={`input-field resize-none ${errors.details ? 'border-red-500/60' : ''}`}
            rows={6}
            placeholder="โปรดอธิบายเหตุการณ์ที่เกิดขึ้นอย่างละเอียด เช่น พฤติกรรม คำพูด หรือการกระทำที่ไม่เหมาะสม..."
            value={form.details}
            onChange={(e) => handleChange('details', e.target.value)}
          />
          <div className="flex items-center justify-between mt-1">
            {errors.details
              ? <p className="text-red-400 text-xs">{errors.details}</p>
              : <span className="text-gray-600 text-xs">อย่างน้อย 20 ตัวอักษร</span>
            }
            <span className="text-gray-600 text-xs">{form.details.length} ตัวอักษร</span>
          </div>
        </div>

        {/* Evidence */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">
            <span className="inline-flex items-center gap-1.5">
              <Paperclip size={14} className="text-gray-400" />
              แนบหลักฐานเพิ่มเติม
              <span className="text-gray-500 font-normal text-xs">(รูปภาพ หรือลิงก์วิดีโอคลิป)</span>
            </span>
          </label>
          <input
            className="input-field"
            placeholder="วางลิงก์รูปภาพหรือวิดีโอที่นี่ เช่น https://imgur.com/... หรือ https://youtube.com/..."
            value={form.evidence_url}
            onChange={(e) => handleChange('evidence_url', e.target.value)}
          />
          <p className="text-gray-600 text-xs mt-1">หากมีรูปภาพ ให้อัพโหลดที่ Imgur แล้วนำลิงก์มาวาง</p>
        </div>

        {/* Notice */}
        <div className="flex items-start gap-3 bg-blue-900/20 border border-blue-900/40 rounded-xl p-4">
          <Info size={16} className="text-blue-400 mt-0.5 flex-shrink-0" />
          <p className="text-blue-300 text-xs leading-relaxed">
            การร้องเรียนที่เป็นเท็จหรือมีเจตนาใส่ร้าย อาจส่งผลต่อผู้ร้องเรียน ทีม DOT จะดำเนินการตรวจสอบข้อมูลอย่างรอบคอบก่อนดำเนินการ
          </p>
        </div>

        {status === 'error' && (
          <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm">
            <AlertTriangle size={16} className="flex-shrink-0" />
            เกิดข้อผิดพลาดในการส่งข้อมูล กรุณาลองใหม่อีกครั้ง
          </div>
        )}

        <button
          type="submit"
          disabled={status === 'submitting'}
          className="btn-primary w-full py-3.5 flex items-center justify-center gap-2 text-base mt-2"
        >
          <Send size={17} />
          {status === 'submitting' ? 'กำลังส่งข้อมูล...' : 'ส่งเรื่องร้องเรียน'}
        </button>
      </form>
    </div>
  );
}
