/**
 * บันทึกภายในของประชาชน (citizen notes)
 *
 * เดิมเก็บเป็นคอลัมน์ `citizens.notes` ซึ่ง anon อ่านได้โดยไม่ต้องล็อกอิน
 * ย้ายไปไว้ใน schema `private` แล้ว (migration 0044)
 * PostgREST มองไม่เห็น schema private → อ่านตรง ๆ ไม่ได้ ต้องผ่าน RPC
 *
 * ตาราง citizens ที่เหลือมีแค่ข้อมูลที่หน้าสาธารณะจำเป็นต้องเห็น
 */

import { supabase } from '../supabase';
import type { Citizen } from '../types';

/** อ่านบันทึกภายในของประชาชน (คืน '' ถ้าไม่มี) */
export async function fetchCitizenNote(citizenId: string): Promise<string> {
  const { data, error } = await supabase.rpc('get_citizen_note', {
    p_citizen_id: citizenId,
  });
  if (error) return '';
  return (data as string | null) ?? '';
}

/** อ่านบันทึกภายในหลายคนพร้อมกัน → Map<citizenId, notes> */
export async function fetchCitizenNotes(citizenIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (citizenIds.length === 0) return map;

  const results = await Promise.all(
    citizenIds.map((id) => fetchCitizenNote(id).catch(() => '')),
  );
  citizenIds.forEach((id, i) => map.set(id, results[i]));
  return map;
}

/** เขียนบันทึกภายใน (ลบให้หมดได้ถ้าส่งค่าว่าง) */
export async function saveCitizenNote(
  citizenId: string,
  notes: string,
  actor?: { id: string; name: string } | null,
): Promise<boolean> {
  const { error } = await supabase.rpc('set_citizen_note', {
    p_citizen_id: citizenId,
    p_notes: notes,
    p_actor_id: actor?.id ?? null,
    p_actor_name: actor?.name ?? null,
  });
  if (error) throw new Error(error.message);
  return true;
}

/**
 * เติม notes ให้กับรายการประชาชนที่โหลดมา
 * เรียกหลัง select('*') เพราะคอลัมน์นี้ไม่ได้อยู่ในตารางแล้ว
 */
export async function withCitizenNotes<T extends { id: string }>(rows: T[]): Promise<(T & { notes: string | null })[]> {
  const notesMap = await fetchCitizenNotes(rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, notes: notesMap.get(r.id) || null }));
}
