/**
 * สรุปสถานะเซิร์ฟเวอร์รายวันจาก BIT NEWS API (ล้วน ๆ ไม่พึ่งฐานข้อมูล)
 *
 * แยกไฟล์ไว้เพื่อให้ทดสอบตรรกะได้โดยไม่ต้องต่อ Supabase
 */

/** รูปแบบจุดในประวัติจาก API */
export interface HistoryPoint {
  at: number;          // epoch ms
  players: number;
  queue: number;
  staff: number;
  maxPlayers: number | null;
  status: string;
}

/** แปลงสถานะจาก API เป็นคำเดียว */
export function normalizeStatus(raw: unknown): 'online' | 'offline' | 'unknown' {
  const s = String(raw ?? '').toLowerCase().trim();
  if (['online', 'up', 'ok', 'operational'].includes(s)) return 'online';
  if (['offline', 'down', 'error', 'outage'].includes(s)) return 'offline';
  if (s.includes('ปิด') || s.includes('off')) return 'offline';
  if (s.includes('เปิด') || s.includes('on')) return 'online';
  return 'unknown';
}

/** 'YYYY-MM-DD' ตามเวลาไทย — API คืนเวลา UTC ถ้าใช้ UTC จะเพี้ยนวัน */
export function thaiDayKey(epochMs: number): string {
  const d = new Date(epochMs);
  // บวก 7 ชม. เพื่อให้เป็นเวลาไทยก่อนอ่านส่วนวันที่
  const thai = new Date(d.getTime() + 7 * 3600 * 1000);
  const y = thai.getUTCFullYear();
  const m = String(thai.getUTCMonth() + 1).padStart(2, '0');
  const day = String(thai.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** สรุปแต่ละวันจากจุดประวัติ: เปิดกี่ครั้ง / ทั้งหมดกี่จุด */
export interface DaySummary {
  day: string;
  isOpen: boolean;
  openSamples: number;
  totalSamples: number;
  playersMax: number | null;
}

/**
 * สรุปสถานะรายวันจากประวัติ API
 *
 * วันที่ไม่มีจุดเลย (เซิร์ฟเวอร์ปิดนานจน API ไม่เก็บ) → ไม่คืนวันนั้น
 * เพื่อไม่ให้ถูกนับว่า "ปิด" โดยไม่มีหลักฐาน
 */
export function summarizeHistory(points: HistoryPoint[]): DaySummary[] {
  const byDay = new Map<string, { open: number; total: number; playersMax: number }>();

  for (const p of points) {
    if (!p || typeof p.at !== 'number') continue;
    const day = thaiDayKey(p.at);

    let entry = byDay.get(day);
    if (!entry) {
      entry = { open: 0, total: 0, playersMax: 0 };
      byDay.set(day, entry);
    }

    entry.total += 1;
    if (normalizeStatus(p.status) === 'online') {
      entry.open += 1;
    }
    if (typeof p.players === 'number' && p.players > entry.playersMax) {
      entry.playersMax = p.players;
    }
  }

  return [...byDay.entries()]
    .map(([day, v]) => ({
      day,
      isOpen: v.open > 0,
      openSamples: v.open,
      totalSamples: v.total,
      playersMax: v.playersMax > 0 ? v.playersMax : null,
    }))
    .sort((a, b) => a.day.localeCompare(b.day));
}
