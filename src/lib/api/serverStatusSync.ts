/**
 * เก็บสถานะเซิร์ฟเวอร์รายวันจาก BIT NEWS API
 *
 * ทำไมต้องมี
 * ──────────
 * กฎ "ขาดเวร 7 วัน" นับเฉพาะวันที่เซิร์ฟเวอร์เปิดให้บริการจริง
 * วันไหนปิดทั้งวัน ไม่ถือว่าเจ้าหน้าที่ขาดเวร
 *
 * ทำไมให้ฝั่งแอปเป็นคนเก็บ ไม่ใช่ cron
 * ────────────────────────────────
 * cron รันใน PostgreSQL ซึ่งเรียก HTTPS ไม่ได้โดยตรง
 * (ต้องเพิ่ม extension อย่าง pg_net) — แอปเรียก API ได้อยู่แล้ว
 * จึงให้แอปดึงแล้วเขียนลงตาราง แล้ว cron อ่านจากตาราง
 *
 * ข้อสำคัญ
 * ────────
 * ถ้าวันไหนไม่มีข้อมูลเลย ระบบจะ "ไม่หักคะแนน" ในรอบที่ครอบคลุมวันนั้น
 * เพราะไม่รู้ว่าเซิร์ฟเวอร์เปิดหรือปิด — ไม่หักคนทั้งที่ไม่ได้ทำผิด
 */

import { supabase } from '../supabase';
import { summarizeHistory, thaiDayKey, normalizeStatus, type HistoryPoint, type DaySummary } from './serverStatusCore';

const API_BASE = 'https://bitnewsth.qd.je/api/public/server-status';

/**
 * ดึงสถานะเซิร์ฟเวอร์แล้วบันทึกลงฐานข้อมูล
 *
 * ดึง 2 จุด:
 *   1. สถานะปัจจุบัน → บันทึกวันนี้ว่าเปิดหรือปิด
 *   2. ประวัติ 7 วัน → บันทึกย้อนหลังให้ครบ (กันกรณีแอปไม่ได้เปิดหลายวัน)
 *
 * @param range ช่วงย้อนหลังที่ดึงประวัติ ('7d' | '30d')
 * @returns จำนวนวันที่บันทึกสำเร็จ
 */
export async function syncServerStatusDays(range: '7d' | '30d' = '7d'): Promise<number> {
  try {
    const [currentRes, historyRes] = await Promise.all([
      fetch(`${API_BASE}`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))),
      fetch(`${API_BASE}/history?range=${range}`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))),
    ]);

    const rows = new Map<string, DaySummary>();

    // 1) สถานะปัจจุบัน → วันนี้
    const st = normalizeStatus(currentRes?.server?.status);
    if (st !== 'unknown') {
      const today = thaiDayKey(Date.now());
      rows.set(today, {
        day: today,
        isOpen: st === 'online',
        openSamples: st === 'online' ? 1 : 0,
        totalSamples: 1,
        playersMax: typeof currentRes?.server?.playerCount === 'number' ? currentRes.server.playerCount : null,
      });
    }

    // 2) ประวัติ → รวมกับวันนี้ (open_samples ใช้ค่ามากสุดเพื่อไม่ให้ทับ)
    const points = (historyRes?.points ?? []) as HistoryPoint[];
    for (const s of summarizeHistory(points)) {
      const existing = rows.get(s.day);
      if (existing) {
        rows.set(s.day, {
          day: s.day,
          isOpen: existing.isOpen || s.isOpen,
          openSamples: Math.max(existing.openSamples, s.openSamples),
          totalSamples: Math.max(existing.totalSamples, s.totalSamples),
          playersMax: Math.max(existing.playersMax ?? 0, s.playersMax ?? 0) || null,
        });
      } else {
        rows.set(s.day, s);
      }
    }

    // 3) บันทึกทีละวัน
    let saved = 0;
    for (const r of rows.values()) {
      const { error } = await supabase.rpc('record_server_status_day', {
        p_day: r.day,
        p_is_open: r.isOpen,
        p_open_samples: r.openSamples,
        p_total_samples: r.totalSamples,
        p_players_max: r.playersMax,
        p_source: 'bit-news-api',
      });
      if (!error) saved += 1;
      else console.warn('[serverStatus] บันทึกวันที่', r.day, 'ไม่สำเร็จ:', error.message);
    }

    return saved;
  } catch (e) {
    // ดึงไม่ได้ = ไม่บันทึก ปล่อยให้ cron ข้ามรอบนั้น (ปลอดภัยกว่าหักผิด)
    console.warn('[serverStatus] ดึงข้อมูลไม่สำเร็จ:', (e as Error).message);
    return 0;
  }
}