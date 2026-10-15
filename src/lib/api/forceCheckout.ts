/**
 * บังคับให้เจ้าหน้าที่ออกเวร — จุดเดียวของระบบ
 *
 * เดิมมี 3 จุดที่ทำหน้าที่นี้ซ้ำกัน และ 2 ใน 3 ลืมหักคะแนน −15
 * (DashboardPage กับ AdminSettingsPage) ทำให้กฎ "ถูกบังคับออกเวร"
 * แสดงอยู่ในคำอธิบาย PPS แต่ไม่เคยทำงานจริงใน 2 ทางนั้น
 *
 * ฟังก์ชันนี้รับประกันลำดับงานเดียวกันทุกทาง:
 *   1. ปิด duty log ที่ยังค้าง (คำนวณระยะเวร + บันทึกผู้บังคับ)
 *   2. หักคะแนน −15 ผ่าน applyCheckoutPoints (กันให้ซ้ำด้วย markKey)
 *   3. เคลียร์ธง is_on_duty
 *   4. เขียน audit log
 */

import { supabase } from '../supabase';
import { applyCheckoutPoints } from './autoPoints';
import type { DutyLog } from '../types';

export interface ForceCheckoutActor {
  id: string;
  name: string;
}

/** ผลลัพธ์ที่คืนกลับไปให้ UI แสดงผล */
export interface ForceCheckoutResult {
  ok: boolean;
  /** บังคับออกเวรได้กี่รายการ */
  closed: number;
  /** ล้มเหลวกี่รายการ */
  failed: number;
  /** รวมนาทีที่บังคับออกเวร */
  minutes: number;
  /** เคสไหนล้มเหลว (ข้อความ error) */
  errors: string[];
}

/**
 * ปิด duty log ที่ยังค้างอยู่ 1 รายการ
 * เรียก applyCheckoutPoints ให้เอง — ห้ามย้ายไปที่ผู้เรียก
 */
async function closeOne(
  log: DutyLog,
  actor: ForceCheckoutActor,
  forcedByName: string,
  errors: string[],
): Promise<number> {
  const now = new Date();
  const minutes = Math.max(
    0,
    Math.round((now.getTime() - new Date(log.clock_in).getTime()) / 60000),
  );
  const clockOut = now.toISOString();

  const { error } = await supabase.from('duty_logs').update({
    clock_out: clockOut,
    duration_minutes: minutes,
    forced_by: actor.id,
    forced_by_name: forcedByName,
    checkout_method: 'forced',
  }).eq('id', log.id);

  if (error) {
    errors.push(error.message);
    return 0;
  }

  // เคลียร์ธงให้ตรงกับฐานข้อมูล ไม่ให้หน้าจอค้างว่า "กำลังเข้าเวร"
  if (log.officer_id) {
    await supabase.from('officers')
      .update({ is_on_duty: false, updated_at: clockOut })
      .eq('id', log.officer_id);
  }

  // −15 คะแนน — ระบบจะข้ามเองถ้าปิดสวิตช์ PPS หรือหักไปแล้ว
  await applyCheckoutPoints({
    ...log,
    clock_out: clockOut,
    duration_minutes: minutes,
    forced_by: actor.id,
    forced_by_name: forcedByName,
    checkout_method: 'forced',
  } as DutyLog);

  return minutes;
}

/** บังคับออกเวรเจ้าหน้าที่ 1 คน (ปุ่ม "บังคับออกเวร" บน Dashboard / หน้าปฏิบัติการ) */
export async function forceCheckoutOfficer(
  officerId: string,
  officerName: string,
  actor: ForceCheckoutActor,
): Promise<ForceCheckoutResult> {
  const errors: string[] = [];

  const { data: activeLog } = await supabase
    .from('duty_logs')
    .select('*')
    .eq('officer_id', officerId)
    .is('clock_out', null)
    .is('deleted_at', null)
    .maybeSingle();

  if (!activeLog) {
    // ยังเคลียร์ธงให้ตรงกับฐานข้อมูล เผื่อข้อมูลเคย desync
    await supabase.from('officers')
      .update({ is_on_duty: false, updated_at: new Date().toISOString() })
      .eq('id', officerId);
    return { ok: true, closed: 0, failed: 0, minutes: 0, errors };
  }

  const minutes = await closeOne(activeLog as DutyLog, actor, actor.name, errors);

  await supabase.from('audit_logs').insert({
    action: 'FORCE_CHECKOUT',
    target_type: 'officer',
    target_id: officerId,
    performed_by: actor.id,
    performed_by_name: actor.name,
    details: { target_name: officerName, method: 'force_checkout' },
  });

  return {
    ok: errors.length === 0,
    closed: minutes > 0 || errors.length === 0 ? 1 : 0,
    failed: errors.length,
    minutes,
    errors,
  };
}

/**
 * บังคับออกเวรทุกคนที่ยังเข้าเวรค้างอยู่
 * ใช้ตอนหัวหน้ากรมปิดระบบเวร
 */
export async function forceCheckoutAllOpenLogs(
  actor: ForceCheckoutActor,
  label = `${actor.name} (ปิดระบบเวร)`,
): Promise<ForceCheckoutResult> {
  const errors: string[] = [];

  // อ่านจาก duty_logs ที่ยังไม่มี clock_out ไม่ใช่จากธง officers.is_on_duty
  // เพราะสองอย่าง desync กันได้ ถ้าเชื่อธงจะพลาดเวรที่ค้างจริง
  const { data: openLogs, error: readErr } = await supabase
    .from('duty_logs')
    .select('*')
    .is('clock_out', null)
    .is('deleted_at', null);

  if (readErr) {
    return { ok: false, closed: 0, failed: 0, minutes: 0, errors: [readErr.message] };
  }

  let minutes = 0;
  for (const log of openLogs ?? []) {
    minutes += await closeOne(log as DutyLog, actor, label, errors);
  }

  if ((openLogs ?? []).length > 0) {
    await supabase.from('audit_logs').insert({
      action: 'FORCE_CHECKOUT_ALL',
      target_type: 'duty_system',
      performed_by: actor.id,
      performed_by_name: actor.name,
      details: {
        method: 'force_checkout_all',
        closed_count: (openLogs ?? []).length,
        total_minutes: minutes,
      },
    });
  }

  return {
    ok: errors.length === 0,
    closed: (openLogs ?? []).length - errors.length,
    failed: errors.length,
    minutes,
    errors,
  };
}
