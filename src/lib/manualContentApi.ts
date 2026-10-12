/* =============================================================
 * manualContentApi.ts
 * -------------------------------------------------------------
 * ชั้นเชื่อม "เนื้อหาคู่มือแบบแก้ไขได้" กับของเดิม
 *
 * หลักการ: เนื้อหาเดิมจาก .tsx เป็นฐานเสมอ
 *   - บท/หมวดย่อยที่ไม่มีแถวใน DB          → ใช้ชื่อ/เนื้อหาจากโค้ด
 *   - มี title ใน DB                       → ใช้ชื่อจาก DB
 *   - uses_blocks = false (ค่าเริ่มต้น)     → เนื้อหาจากโค้ด
 *   - uses_blocks = true                    → เนื้อหาจาก manual_blocks
 * ทำให้ย้ายทีละหมวดได้ ไม่ต้องแตะทั้ง 95 หมวดในครั้งเดียว
 * ============================================================= */

import { supabase } from './supabase';
import type { ReactNode } from 'react';

export type ManualVariant = 'officer' | 'citizen';

export type BlockType = 'text' | 'image' | 'table' | 'callout' | 'html';

export interface ContentBlock {
  id: string;
  type: BlockType;
  content: string;
  caption?: string | null;
  order: number;
  meta?: Record<string, unknown>;
}

export interface ManualChapterRow {
  variant: string;
  id: string;
  title: string | null;
  number: string | null;
  sort_order: number | null;
  is_hidden: boolean;
}

export interface ManualSectionRow {
  variant: string;
  id: string;
  chapter_id: string;
  title: string | null;
  sort_order: number | null;
  is_hidden: boolean;
  uses_blocks: boolean;
}

export interface ManualBlockRow {
  id: string;
  section_id: string;
  type: BlockType;
  content: string;
  caption: string | null;
  order_index: number;
  meta: Record<string, unknown>;
}

/* ---------- โครงสร้างที่ผสมแล้ว (สำหรับแสดงผล) ---------- */

export interface ResolvedSection {
  id: string;
  chapterId: string;
  title: string;
  /** เนื้อหาจากโค้ดเดิม — ใช้เมื่อยังไม่แปลงเป็นบล็อก */
  legacyBody: ReactNode | null;
  /** บล็อกที่บันทึกไว้ — ใช้เมื่อ uses_blocks = true */
  blocks: ContentBlock[];
  usesBlocks: boolean;
  isHidden: boolean;
  /** ชื่อ/ลำดับถูกแก้ในระบบแล้วหรือยัง */
  isOverridden: boolean;
}

export interface ResolvedChapter {
  id: string;
  number: string;
  title: string;
  sections: ResolvedSection[];
  isHidden: boolean;
  isOverridden: boolean;
}

export interface ManualSnapshot {
  chapters: ResolvedChapter[];
  /** true = ยังไม่ได้ต่อ DB เลย (อ่านจากโค้ดล้วน) */
  dbUnavailable: boolean;
}

const BLOCK_TYPES: BlockType[] = ['text', 'image', 'table', 'callout', 'html'];

function toBlock(row: ManualBlockRow, i: number): ContentBlock {
  return {
    id: row.id,
    type: BLOCK_TYPES.includes(row.type) ? row.type : 'html',
    content: row.content ?? '',
    caption: row.caption ?? null,
    order: typeof row.order_index === 'number' ? row.order_index : i,
    meta: (row.meta ?? {}) as Record<string, unknown>,
  };
}

/**
 * ดึงภาพรวมจาก DB
 * @param staticChapters โครงสร้างเดิมจาก .tsx (ฐาน)
 */
export async function fetchManualSnapshot(
  variant: ManualVariant,
  staticChapters: Array<{ id: string; number: string; title: string; sections: Array<{ id: string; title: string; body: ReactNode }> }>,
): Promise<ManualSnapshot> {
  const [chRes, secRes, blkRes] = await Promise.all([
    supabase.from('manual_chapters').select('*').eq('variant', variant),
    supabase.from('manual_sections').select('*').eq('variant', variant),
    supabase.from('manual_blocks').select('*').eq('variant', variant)
      .order('order_index', { ascending: true }),
  ]);

  // ยังไม่ได้รัน migration 0032 → ใช้ของเดิมจากโค้ด ไม่ทำให้หน้าเว็บพัง
  if (chRes.error && /does not exist|schema cache/i.test(chRes.error.message)) {
    return { chapters: toResolved(staticChapters, new Map(), new Map(), new Map()), dbUnavailable: true };
  }

  const chRows = (chRes.data ?? []) as ManualChapterRow[];
  const secRows = (secRes.data ?? []) as ManualSectionRow[];
  const blkRows = (blkRes.data ?? []) as ManualBlockRow[];

  const chMap = new Map(chRows.map((r) => [r.id, r]));
  const secMap = new Map(secRows.map((r) => [r.id, r]));

  const blkMap = new Map<string, ContentBlock[]>();
  for (const r of blkRows) {
    const arr = blkMap.get(r.section_id) ?? [];
    arr.push(toBlock(r, arr.length));
    blkMap.set(r.section_id, arr);
  }

  return { chapters: toResolved(staticChapters, chMap, secMap, blkMap), dbUnavailable: false };
}

function toResolved(
  staticChapters: Array<{ id: string; number: string; title: string; sections: Array<{ id: string; title: string; body: ReactNode }> }>,
  chMap: Map<string, ManualChapterRow>,
  secMap: Map<string, ManualSectionRow>,
  blkMap: Map<string, ContentBlock[]>,
): ResolvedChapter[] {
  const chapters = staticChapters.map((ch) => {
    const row = chMap.get(ch.id);
    return {
      id: ch.id,
      number: row?.number ?? ch.number ?? '',
      title: row?.title ?? ch.title,
      isHidden: row?.is_hidden ?? false,
      isOverridden: Boolean(row),
      sections: ch.sections.map((s) => {
        const sRow = secMap.get(s.id);
        const usesBlocks = sRow?.uses_blocks ?? false;
        return {
          id: s.id,
          chapterId: ch.id,
          title: sRow?.title ?? s.title,
          legacyBody: usesBlocks ? null : s.body,
          blocks: usesBlocks ? (blkMap.get(s.id) ?? []) : [],
          usesBlocks,
          isHidden: sRow?.is_hidden ?? false,
          isOverridden: Boolean(sRow),
        };
      }),
    };
  });

  // เรียงตาม sort_order จาก DB ถ้ามีการกำหนดไว้
  return chapters
    .map((c, i) => ({ c, i }))
    .sort((a, b) => {
      const sa = chMap.get(a.c.id)?.sort_order;
      const sb = chMap.get(b.c.id)?.sort_order;
      if (sa != null && sb != null && sa !== sb) return sa - sb;
      if (sa != null && sb == null) return -1;
      if (sa == null && sb != null) return 1;
      return a.i - b.i;
    })
    .map((x) => x.c);
}

/* ================= การบันทึก ================= */

export interface SaveChapterInput {
  variant: ManualVariant;
  id: string;
  title?: string | null;
  number?: string | null;
  sortOrder?: number | null;
  isHidden?: boolean;
  by: { id: string; name: string };
}

export async function saveChapter(input: SaveChapterInput): Promise<void> {
  const { variant, id, by, ...rest } = input;
  const payload = {
    variant,
    id,
    ...rest,
    updated_by: by.id,
    updated_by_name: by.name,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('manual_chapters').upsert(payload, { onConflict: 'variant,id' });
  if (error) throw error;
}

export interface SaveSectionInput {
  variant: ManualVariant;
  id: string;
  chapterId: string;
  title?: string | null;
  sortOrder?: number | null;
  isHidden?: boolean;
  usesBlocks?: boolean;
  by: { id: string; name: string };
}

export async function saveSection(input: SaveSectionInput): Promise<void> {
  const { variant, id, chapterId, by, ...rest } = input;
  const payload = {
    variant,
    id,
    chapter_id: chapterId,
    ...rest,
    updated_by: by.id,
    updated_by_name: by.name,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('manual_sections').upsert(payload, { onConflict: 'variant,id' });
  if (error) throw error;
}

/**
 * บันทึกบล็อกทั้งชุดของหมวดย่อย
 * ลบของเดิมทิ้งทั้งหมดแล้วเขียนใหม่ตาม order — ชุดเล็ก (เฉลี่ย 3.5 บล็อก)
 * วิธีนี้ตรงไปตรงมากว่าการคำนวณ diff และไม่เสี่ยง index ชนกัน
 */
export async function saveBlocks(
  variant: ManualVariant,
  sectionId: string,
  blocks: ContentBlock[],
  by: { id: string; name: string },
): Promise<void> {
  const { error: delErr } = await supabase
    .from('manual_blocks').delete().eq('variant', variant).eq('section_id', sectionId);
  if (delErr) throw delErr;

  if (blocks.length === 0) return;

  const rows = blocks.map((b, i) => ({
    id: b.id,
    variant,
    section_id: sectionId,
    type: b.type,
    content: b.content ?? '',
    caption: b.caption ?? null,
    order_index: i,
    meta: b.meta ?? {},
    updated_by: by.id,
    updated_by_name: by.name,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase.from('manual_blocks').insert(rows);
  if (error) throw error;
}

/** ลบบท (ซ่อน ไม่ลบจริง เพื่อไม่ให้เนื้อหาในโค้ดหลุดทิ้ง) */
export async function hideChapter(variant: ManualVariant, id: string, by: { id: string; name: string }): Promise<void> {
  await saveChapter({ variant, id, isHidden: true, by });
}

/** คืนสถานะบท */
export async function showChapter(variant: ManualVariant, id: string, by: { id: string; name: string }): Promise<void> {
  await saveChapter({ variant, id, isHidden: false, by });
}

export async function hideSection(variant: ManualVariant, id: string, chapterId: string, by: { id: string; name: string }): Promise<void> {
  await saveSection({ variant, id, chapterId, isHidden: true, by });
}

export async function showSection(variant: ManualVariant, id: string, chapterId: string, by: { id: string; name: string }): Promise<void> {
  await saveSection({ variant, id, chapterId, isHidden: false, by });
}

/* ---------- ตัวช่วยจัดการบล็อกใน client ---------- */

let seq = 0;
export function newBlockId(): string {
  seq += 1;
  return `blk_${Date.now().toString(36)}_${seq.toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function makeBlock(type: BlockType, content = ''): ContentBlock {
  return {
    id: newBlockId(),
    type,
    content,
    caption: null,
    order: 0,
    meta: {},
  };
}

/** เลื่อนบล็อกขึ้น/ลง แล้วคำนวณ order ใหม่ทั้งชุด */
export function moveBlock(list: ContentBlock[], index: number, dir: -1 | 1): ContentBlock[] {
  const next = [...list];
  const target = index + dir;
  if (target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target], next[index]];
  return next.map((b, i) => ({ ...b, order: i }));
}
