/**
 * username ของเจ้าหน้าที่
 *
 * หลังย้าย credentials ไป schema `private` (migration 0043) คอลัมน์
 * `officers.username` ก็ถูกลบไปด้วย เพราะตาราง officers อ่านได้จาก anon
 *
 * ตอนนี้ต้องดึงผ่าน `list_officer_usernames()` แทน
 */

import { supabase } from '../supabase';

export interface OfficerUsernameRow {
  officer_id: string;
  username: string;
}

let cache: { at: number; map: Map<string, string> } | null = null;
const TTL_MS = 60_000;

/** officerId → username (โหลดครั้งเดียวแล้ว cache ไว้ 1 นาที) */
export async function getOfficerUsernameMap(force = false): Promise<Map<string, string>> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.map;

  const { data, error } = await supabase.rpc('list_officer_usernames');
  const map = new Map<string, string>();
  if (!error) {
    for (const r of (data ?? []) as OfficerUsernameRow[]) {
      map.set(r.officer_id, r.username);
    }
  }
  cache = { at: Date.now(), map };
  return map;
}

/** username ของคนเดียว (คืน '' ถ้าไม่ทราบ) */
export async function getOfficerUsername(officerId?: string | null): Promise<string> {
  if (!officerId) return '';
  const map = await getOfficerUsernameMap();
  return map.get(officerId) ?? '';
}

/** ใส่ username ลงในรายการเจ้าหน้าที่ (ไม่แก้ต้นฉบับ) */
export async function withUsernames<T extends { id: string }>(
  rows: T[],
): Promise<(T & { username?: string })[]> {
  const map = await getOfficerUsernameMap();
  return rows.map((r) => ({ ...r, username: map.get(r.id) }));
}

/** ล้าง cache — ใช้หลังสร้าง/ลบเจ้าหน้าที่หรือเปลี่ยนรหัสผ่าน */
export function clearOfficerUsernameCache(): void {
  cache = null;
}
