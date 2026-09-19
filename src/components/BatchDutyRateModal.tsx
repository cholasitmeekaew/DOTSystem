import { useState } from 'react';
import { Check, Clock } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Modal } from './Modal';

export type TimeUnit = 'second' | 'minute' | 'hour';

interface BatchDutyRateModalProps {
  onClose: () => void;
  onSaved: () => void;
}

export function BatchDutyRateModal({ onClose, onSaved }: BatchDutyRateModalProps) {
  const [unit, setUnit] = useState<TimeUnit>('hour');
  const [inputValue, setInputValue] = useState<string>('500');
  const [saving, setSaving] = useState(false);

  // คำนวณค่า BC ต่อชั่วโมงตามหน่วยที่เลือก เพื่อบันทึกลงคอลัมน์ duty_rate (ฐานข้อมูลเก็บเป็น BC ต่อชั่วโมง)
  const numericInput = parseFloat(inputValue) || 0;
  const ratePerHour =
    unit === 'second'
      ? Math.round(numericInput * 3600 * 100) / 100
      : unit === 'minute'
      ? Math.round(numericInput * 60 * 100) / 100
      : numericInput;

  const ratePerMinute = Math.round((ratePerHour / 60) * 1000) / 1000;
  const ratePerSecond = Math.round((ratePerHour / 3600) * 10000) / 10000;

  // Preset recommendations by unit
  const presets: Record<TimeUnit, number[]> = {
    second: [0.05, 0.1, 0.15, 0.2, 0.25, 0.5],
    minute: [3, 5, 8, 10, 15, 20],
    hour: [100, 200, 300, 400, 500, 800, 1000],
  };

  async function handleSave() {
    if (isNaN(numericInput) || numericInput < 0) {
      alert('กรุณาระบุอัตราค่าขึ้นเวรที่ถูกต้อง (ต้องมากกว่าหรือเท่ากับ 0)');
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from('officers')
        .update({ duty_rate: ratePerHour, updated_at: new Date().toISOString() })
        .neq('status', 'deleted');
      if (error) throw error;
      alert(
        `ตั้งค่าขึ้นเวรให้เจ้าหน้าที่ทุกคนเรียบร้อยแล้ว!\n\n` +
          `• ${numericInput.toLocaleString('th-TH')} BC / ${unit === 'second' ? 'วินาที' : unit === 'minute' ? 'นาที' : 'ชั่วโมง'}\n` +
          `• เทียบเท่า: ${ratePerHour.toLocaleString('th-TH')} BC / ชั่วโมง (${ratePerMinute.toLocaleString('th-TH')} BC / นาที)`
      );
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
          ตั้งค่าเรทค่าขึ้นเวร (BC) ให้เจ้าหน้าที่ทุกคนในระบบพร้อมกัน สามารถเลือกหน่วยเวลาเป็น <strong>วินาที, นาที หรือ ชั่วโมง</strong> ได้อย่างอิสระ
        </p>

        {/* Tab เลือกหน่วยเวลา: ต่อวิ / ต่อนาที / ต่อ ช.ม. */}
        <div>
          <label className="block text-xs font-medium text-gray-300 mb-1.5 flex items-center gap-1">
            <Clock size={13} className="text-amber-400" /> เลือกหน่วยเวลาที่ต้องการตั้งเรท:
          </label>
          <div className="grid grid-cols-3 gap-2 p-1 bg-navy-950/80 rounded-xl border border-blue-900/60">
            <button
              type="button"
              onClick={() => {
                setUnit('second');
                setInputValue('0.15');
              }}
              className={`py-2 px-3 rounded-lg text-xs font-bold transition-all ${
                unit === 'second'
                  ? 'bg-amber-500 text-black shadow-lg shadow-amber-500/30'
                  : 'text-gray-400 hover:text-white hover:bg-navy-800'
              }`}
            >
              ⏱️ ต่อวินาที (BC/วิ)
            </button>
            <button
              type="button"
              onClick={() => {
                setUnit('minute');
                setInputValue('10');
              }}
              className={`py-2 px-3 rounded-lg text-xs font-bold transition-all ${
                unit === 'minute'
                  ? 'bg-amber-500 text-black shadow-lg shadow-amber-500/30'
                  : 'text-gray-400 hover:text-white hover:bg-navy-800'
              }`}
            >
              ⏳ ต่อนาที (BC/นาที)
            </button>
            <button
              type="button"
              onClick={() => {
                setUnit('hour');
                setInputValue('500');
              }}
              className={`py-2 px-3 rounded-lg text-xs font-bold transition-all ${
                unit === 'hour'
                  ? 'bg-amber-500 text-black shadow-lg shadow-amber-500/30'
                  : 'text-gray-400 hover:text-white hover:bg-navy-800'
              }`}
            >
              🕒 ต่อชั่วโมง (BC/ชม.)
            </button>
          </div>
        </div>

        {/* ปุ่มเลือกเรทด่วนตามหน่วยเวลา */}
        <div>
          <label className="block text-xs text-gray-400 mb-1.5">
            เลือกเรทด่วน ({unit === 'second' ? 'BC ต่อวินาที' : unit === 'minute' ? 'BC ต่อนาที' : 'BC ต่อชั่วโมง'}):
          </label>
          <div className="flex flex-wrap gap-1.5">
            {presets[unit].map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setInputValue(p.toString())}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold font-mono border transition-all ${
                  inputValue === p.toString()
                    ? 'bg-amber-500 text-black border-amber-400 font-bold shadow-md shadow-amber-500/20'
                    : 'bg-navy-800 text-gray-300 border-blue-900/60 hover:border-amber-500/40 hover:text-white'
                }`}
              >
                {p.toLocaleString('th-TH')} BC/{unit === 'second' ? 'วิ' : unit === 'minute' ? 'น.' : 'ชม.'}
              </button>
            ))}
          </div>
        </div>

        {/* ช่องระบุตัวเลขเอง */}
        <div>
          <label className="block text-xs text-gray-400 mb-1">
            หรือระบุตัวเลขเอง ({unit === 'second' ? 'BC ต่อวินาที' : unit === 'minute' ? 'BC ต่อนาที' : 'BC ต่อชั่วโมง'}):
          </label>
          <div className="relative">
            <input
              type="number"
              min={0}
              step={unit === 'second' ? '0.001' : unit === 'minute' ? '0.1' : '10'}
              className="input-field font-mono text-lg font-bold text-amber-400 pr-20"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="0"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-gray-400 pointer-events-none">
              BC / {unit === 'second' ? 'วินาที' : unit === 'minute' ? 'นาที' : 'ชม.'}
            </span>
          </div>
        </div>

        {/* กล่องสรุปการแปลงหน่วยเวลาให้เข้าใจง่าย */}
        <div className="card p-3 bg-navy-900/80 border border-blue-900/60 space-y-1.5 text-xs">
          <div className="text-gray-400 font-medium">สรุปอัตราที่จะนำไปคำนวณเงินเดือน:</div>
          <div className="grid grid-cols-3 gap-2 text-center pt-1 border-t border-blue-900/40 font-mono">
            <div className="bg-navy-950/60 p-2 rounded-lg border border-blue-900/30">
              <div className="text-gray-400 text-[10px]">ต่อวินาที</div>
              <div className="text-amber-400 font-bold text-sm mt-0.5">{ratePerSecond.toLocaleString('th-TH')} BC</div>
            </div>
            <div className="bg-navy-950/60 p-2 rounded-lg border border-blue-900/30">
              <div className="text-gray-400 text-[10px]">ต่อนาที</div>
              <div className="text-amber-400 font-bold text-sm mt-0.5">{ratePerMinute.toLocaleString('th-TH')} BC</div>
            </div>
            <div className="bg-navy-950/60 p-2 rounded-lg border border-amber-500/30">
              <div className="text-amber-300 text-[10px]">ต่อชั่วโมง (รวม)</div>
              <div className="text-amber-400 font-bold text-sm mt-0.5">{ratePerHour.toLocaleString('th-TH')} BC</div>
            </div>
          </div>
        </div>

        {/* ปุ่มบันทึก */}
        <div className="flex gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">
            ยกเลิก
          </button>
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
