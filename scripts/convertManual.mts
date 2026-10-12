/* =============================================================
 * convertManual.mjs
 * -------------------------------------------------------------
 * แปลงเนื้อหาคู่มือเดิม (ReactNode ใน .tsx) ให้เป็น ContentBlock[]
 * แล้วพิมพ์เป็น SQL seed สำหรับตาราง manual_* ของ migration 0032
 *
 * วิธีทำงาน
 *   1. เรนเดอร์ body ของแต่ละหมวดย่อยเป็น HTML (react-dom/server)
 *      → คลาส Tailwind ทั้งหมดยังอยู่ใน HTML ไม่หาย
 *   2. ตัด HTML เป็น element ระดับบนสุดทีละชิ้น
 *   3. จับคู่ชนิด:
 *        table  → type 'table'   (meta.html)
 *        img    → type 'image'   (content = src, caption = alt)
 *        div    → type 'callout' (meta.html เก็บ class เดิม)
 *        อื่น ๆ → type 'text'     (เก็บเป็น HTML เพื่อให้ ul/ol/h3 ทำงานเหมือนเดิม)
 *      ไม่มีอะไรตกหล่น เพราะทุก element ระดับบนสุดกลายเป็นบล็อกเสมอ
 *
 * การใช้:
 *   npx tsx scripts/convertManual.mts            → พิมพ์ SQL ลง console
 *   npx tsx scripts/convertManual.mts --out=FILE → เขียนไฟล์
 *   npx tsx scripts/convertManual.mts --verify   → เช็คว่าไม่มีเนื้อหาหาย
 * ============================================================= */

import { renderToStaticMarkup } from 'react-dom/server';
import { writeFileSync } from 'node:fs';

/* ---------- ตัวช่วยแยก element ระดับบนสุด ---------- */

const VOID_TAGS = new Set([
  'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr',
]);

/**
 * แยก HTML string เป็นชิ้นระดับบนสุด
 * คืน array ของ { html, tag }
 */
function splitTopLevel(html) {
  const out = [];
  let i = 0;
  const n = html.length;

  while (i < n) {
    // ข้ามช่องว่างระหว่าง element
    while (i < n && /\s/.test(html[i])) i++;
    if (i >= n) break;

    // ข้อความดิบที่ไม่ได้อยู่ใน tag (เช่น ข้อความหลุด fragment)
    if (html[i] !== '<') {
      let j = i;
      while (j < n && html[j] !== '<') j++;
      const text = html.slice(i, j).trim();
      if (text) out.push({ html: html.slice(i, j), tag: '#text' });
      i = j;
      continue;
    }

    // เจอ tag — หา tag name
    const m = /^<([a-zA-Z][a-zA-Z0-9]*)/.exec(html.slice(i));
    if (!m) { out.push({ html: html[i], tag: '#text' }); i++; continue; }

    const tag = m[1].toLowerCase();

    // tag ว่าง เช่น <br/> <img ... />
    if (VOID_TAGS.has(tag)) {
      const end = html.indexOf('>', i);
      const stop = end === -1 ? n : end + 1;
      out.push({ html: html.slice(i, stop), tag });
      i = stop;
      continue;
    }

    // tag ทั่วไป — ไล่จนกว่าจะปิดตรงระดับเดียวกัน
    let depth = 0;
    let j = i;
    while (j < n) {
      if (html[j] !== '<') { j++; continue; }

      // ข้าม comment
      if (html.startsWith('<!--', j)) {
        const c = html.indexOf('-->', j);
        j = c === -1 ? n : c + 3;
        continue;
      }

      const tm = /^<(\/?)([a-zA-Z][a-zA-Z0-9]*)/.exec(html.slice(j));
      if (!tm) { j++; continue; }

      const closing = tm[1] === '/';
      const tname = tm[2].toLowerCase();

      // หาปลาย tag เดียว
      const gt = findTagEnd(html, j);
      const selfClosing = html[gt - 1] === '/';

      if (!closing) {
        if (!selfClosing && !VOID_TAGS.has(tname)) depth++;
      } else {
        depth--;
        if (depth === 0) {
          j = gt + 1;
          break;
        }
      }
      j = gt + 1;
    }

    out.push({ html: html.slice(i, j), tag });
    i = j;
  }

  return out;
}

/** หาตำแหน่ง '>' ที่สิ้นสุด tag โดยข้ามเครื่องหมายคำพูดใน attribute */
function findTagEnd(s, start) {
  let quote = null;
  for (let k = start + 1; k < s.length; k++) {
    const ch = s[k];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '>') return k;
  }
  return s.length;
}

/** ดึง attribute จาก tag เดียว */
function attr(tagHtml, name) {
  const re = new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i');
  const m = re.exec(tagHtml);
  return m ? m[1] : null;
}

/* ---------- แปลงเป็นบล็อก ---------- */

function classify(chunk) {
  const { html, tag } = chunk;

  if (tag === 'table') {
    return { type: 'table', content: '', meta: { html } };
  }

  if (tag === 'img') {
    return {
      type: 'image',
      content: attr(html, 'src') ?? '',
      caption: attr(html, 'alt') ?? null,
      meta: { html },
    };
  }

  if (tag === 'div') {
    return { type: 'callout', content: '', meta: { html } };
  }

  // <p> <ul> <ol> <h1>–<h6> <strong> <span> <blockquote> ฯลฯ → เก็บเป็น HTML
  return { type: 'text', content: html, meta: {} };
}

function htmlToBlocks(bodyHtml) {
  return splitTopLevel(bodyHtml).map((chunk, i) => {
    const c = classify(chunk);
    return {
      order: i,
      type: c.type,
      content: c.content,
      caption: c.caption ?? null,
      meta: c.meta ?? {},
    };
  });
}

/* ---------- SQL ---------- */

const esc = (s) =>
  String(s ?? '')
    .replace(/'/g, "''")
    .replace(/\\/g, '\\\\');

const sqlStr = (s) => (s == null ? 'null' : `'${esc(s)}'`);
const sqlNum = (n) => (n == null ? 'null' : String(n));
const sqlJson = (o) => `'${esc(JSON.stringify(o ?? {}))}'::jsonb`;

function toSql(variants) {
  const lines = [];
  lines.push('-- =============================================================');
  lines.push('-- SEED: ย้ายเนื้อหาคู่มือเดิมเข้าตาราง (สร้างโดย scripts/convertManual.mts)');
  lines.push('-- รันหลัง migration 0032 · ปลอดภัยถ้ารันซ้ำ');
  lines.push('-- =============================================================');
  lines.push('');
  lines.push('begin;');
  lines.push('');

  let nCh = 0, nSec = 0, nBlk = 0;

  for (const v of variants) {
    const { variant, chapters } = v;
    lines.push(`-- ---------- ${variant} ----------`);
    lines.push(`delete from manual_blocks   where variant = ${sqlStr(variant)};`);
    lines.push(`delete from manual_sections where variant = ${sqlStr(variant)};`);
    lines.push(`delete from manual_chapters where variant = ${sqlStr(variant)};`);
    lines.push('');

    chapters.forEach((ch, ci) => {
      lines.push(
        `insert into manual_chapters (variant, id, title, number, sort_order)`
        + ` values (${sqlStr(variant)}, ${sqlStr(ch.id)}, ${sqlStr(ch.title)}, ${sqlStr(ch.number)}, ${ci});`
      );
      nCh++;

      ch.sections.forEach((s, si) => {
        lines.push(
          `insert into manual_sections (variant, id, chapter_id, title, sort_order, uses_blocks)` +
          ` values (${sqlStr(variant)}, ${sqlStr(s.id)}, ${sqlStr(ch.id)}, ${sqlStr(s.title)}, ${si}, true);`
        );
        nSec++;

        if (s.blocks.length === 0) return;
        const rows = s.blocks.map((b) =>
          `  (${sqlStr(variant)}, ${sqlStr(s.id)}, ${sqlStr(b.type)}, ${sqlStr(b.content)}, ` +
          `${sqlStr(b.caption)}, ${b.order}, ${sqlJson(b.meta)})`
        );
        lines.push(
          `insert into manual_blocks (variant, section_id, type, content, caption, order_index, meta) values`
        );
        lines.push(rows.join(',\n') + ';');
        nBlk += s.blocks.length;
      });
      lines.push('');
    });
  }

  lines.push('commit;');
  lines.push('');
  lines.push(`-- สรุป: ${nCh} บท · ${nSec} หมวดย่อย · ${nBlk} บล็อก`);

  return lines.join('\n');
}

/* ---------- main ---------- */

const argv = process.argv.slice(2);
const outFlag = argv.find((a) => a.startsWith('--out='));
const verifyOnly = argv.includes('--verify');

async function loadVariant(modPath, exportName, variant) {
  const mod = await import(modPath);
  const chapters = mod[exportName];
  if (!Array.isArray(chapters)) {
    throw new Error(`ไม่พบ export "${exportName}" ใน ${modPath}`);
  }
  const out = [];
  for (const ch of chapters) {
    const sections = [];
    for (const s of ch.sections) {
      const bodyHtml = s.body == null ? '' : renderToStaticMarkup(s.body);
      sections.push({
        id: s.id,
        title: s.title || null,
        blocks: htmlToBlocks(bodyHtml),
        rawHtml: bodyHtml,
      });
    }
    out.push({ id: ch.id, title: ch.title, number: ch.number ?? '', sections });
  }
  return { variant, chapters: out };
}

const React = await import('react');
globalThis.React = React.default ?? React;

const variants = [
  await loadVariant('../src/data/manualContent', 'manualChapters', 'officer'),
  await loadVariant('../src/data/citizenManualContent', 'citizenManualChapters', 'citizen'),
];

/* ---------- ตรวจว่าไม่มีเนื้อหาหาย ---------- */

if (verifyOnly) {
  let bad = 0;
  for (const v of variants) {
    let blocks = 0, chars = 0;
    for (const ch of v.chapters) {
      for (const s of ch.sections) {
        blocks += s.blocks.length;
        chars += s.rawHtml.length;
        const joined = s.blocks.map((b) => b.meta?.html ?? b.content).join('');
        if (s.rawHtml.replace(/\s+/g, '') !== joined.replace(/\s+/g, '')) {
          console.error(`✘ ${v.variant}/${s.id}: HTML ที่คืนกลับไม่เท่าเดิม`);
          bad++;
        }
      }
    }
    console.log(`✓ ${v.variant}: ${blocks} บล็อก · ${chars.toLocaleString('th-TH')} ตัวอักษร`);
  }
  console.log(bad === 0 ? '\nผ่าน: เนื้อหาครบทุกหมวดย่อย ไม่มีอะไรหาย' : `\nมี ${bad} หมวดที่ไม่ตรง`);
  process.exit(bad === 0 ? 0 : 1);
}

const sql = toSql(variants);

if (outFlag) {
  const file = outFlag.slice('--out='.length);
  writeFileSync(file, sql, 'utf8');
  console.log(`เขียนแล้ว: ${file} (${sql.split('\n').length} บรรทัด)`);
} else {
  console.log(sql);
}
