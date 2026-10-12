/* =============================================================
 * ManualContentEditor.tsx
 * -------------------------------------------------------------
 * 1) ManualBlockView    — แสดงผลบล็อกหนึ่งชิ้น (ใช้ทั้งโหมดอ่านและโหมดแก้ไข)
 * 2) ManualBlockList   — โหมดแก้ไข: เพิ่ม/ลบ/เลื่อนลำดับบล็อก
 * ============================================================= */

import { useRef, useState } from 'react';
import {
  ArrowUp, ArrowDown, Trash2, Plus, Image as ImageIcon, Type as TypeIcon,
  Loader2, Save, X, Table2, MessageSquareWarning,
} from 'lucide-react';
import type { ContentBlock, BlockType } from '../lib/manualContentApi';
import { makeBlock, moveBlock } from '../lib/manualContentApi';
import { sanitizeManualHtml, TABLE_TAGS, TEXT_TAGS, CALLOUT_TAGS } from '../lib/manualHtml';
import { uploadImage } from '../lib/storage';

/* ============================ แสดงผลบล็อก ============================ */

export function ManualBlockView({ block }: { block: ContentBlock }) {
  if (block.type === 'image') {
    const src = String(block.content ?? '').trim();
    if (!src) return null;
    return (
      <figure className="my-4">
        <img
          src={src}
          alt={block.caption ?? ''}
          loading="lazy"
          decoding="async"
          className="max-w-full rounded-xl border border-blue-900/50 mx-auto block"
        />
        {block.caption && (
          <figcaption className="text-center text-[11px] text-gray-500 mt-2">
            {block.caption}
          </figcaption>
        )}
      </figure>
    );
  }

  if (block.type === 'table') {
    const html = String(block.meta?.html ?? '');
    return <div dangerouslySetInnerHTML={{ __html: sanitizeManualHtml(html, TABLE_TAGS) }} />;
  }

  if (block.type === 'callout') {
    const html = String(block.meta?.html ?? '');
    return <div dangerouslySetInnerHTML={{ __html: sanitizeManualHtml(html, CALLOUT_TAGS) }} />;
  }

  const html = block.type === 'html'
    ? String(block.content ?? '')
    : String(block.content ?? '');
  return <div dangerouslySetInnerHTML={{ __html: sanitizeManualHtml(html, TEXT_TAGS) }} />;
}

/* ============================ โหมดแก้ไข ============================ */

const TYPE_LABEL: Record<BlockType, string> = {
  text: 'ข้อความ',
  image: 'รูปภาพ',
  table: 'ตาราง',
  callout: 'กล่องเน้น',
  html: 'HTML',
};

const TYPE_ICON: Record<BlockType, typeof TypeIcon> = {
  text: TypeIcon,
  image: ImageIcon,
  table: Table2,
  callout: MessageSquareWarning,
  html: TypeIcon,
};

/** สีป้ายชนิดบล็อก */
const TYPE_CHIP: Record<BlockType, string> = {
  text: 'bg-blue-500/15 text-blue-300 border-blue-500/40',
  image: 'bg-purple-500/15 text-purple-300 border-purple-500/40',
  table: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40',
  callout: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  html: 'bg-gray-500/15 text-gray-300 border-gray-500/40',
};

export function ManualBlockEditor({
  blocks, onChange, onSave, onCancel, saving,
}: {
  blocks: ContentBlock[];
  onChange: (b: ContentBlock[]) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [adding, setAdding] = useState<BlockType | null>(null);
  const [imageUrl, setImageUrl] = useState('');
  const [imageCaption, setImageCaption] = useState('');
  const [imageBusy, setImageBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function addText() {
    onChange([...blocks, makeBlock('text', '<p>ข้อความใหม่</p>')]);
    setAdding(null);
  }

  function addImageFromUrl() {
    const url = imageUrl.trim();
    if (!url) return;
    const b = makeBlock('image', url);
    b.caption = imageCaption.trim() || null;
    onChange([...blocks, b]);
    setImageUrl('');
    setImageCaption('');
    setAdding(null);
  }

  async function addImageFromFile(file: File) {
    setImageBusy(true);
    try {
      const url = await uploadImage(file, 'manual');
      if (url) {
        const b = makeBlock('image', url);
        b.caption = imageCaption.trim() || null;
        onChange([...blocks, b]);
        setImageCaption('');
        setAdding(null);
      }
    } finally {
      setImageBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function patch(i: number, next: Partial<ContentBlock>) {
    onChange(blocks.map((b, idx) => (idx === i ? { ...b, ...next } : b)));
  }

  return (
    <div className="space-y-2.5">
      {/* แถบเครื่องมือ */}
      <div className="flex flex-wrap items-center gap-1.5 pb-2 border-b border-blue-900/40">
        <span className="text-[11px] text-gray-400 mr-1">เพิ่มบล็อก:</span>

        <button
          onClick={addText}
          className="btn-secondary px-2 py-1 text-[11px] flex items-center gap-1"
        >
          <Plus size={11} /> ข้อความ
        </button>

        <button
          onClick={() => setAdding(adding === 'image' ? null : 'image')}
          className={`btn-secondary px-2 py-1 text-[11px] flex items-center gap-1 ${
            adding === 'image' ? 'border-purple-500/60 text-purple-300' : ''
          }`}
        >
          <Plus size={11} /> รูปภาพ
        </button>

        <div className="flex-1" />

        <button
          onClick={onCancel}
          disabled={saving}
          className="btn-secondary px-2 py-1 text-[11px] flex items-center gap-1"
        >
          <X size={11} /> ยกเลิก
        </button>
        <button
          onClick={onSave}
          disabled={saving}
          className="btn-primary px-2.5 py-1 text-[11px] flex items-center gap-1 disabled:opacity-40"
        >
          {saving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
          บันทึกการแก้ไข
        </button>
      </div>

      {/* ฟอร์มเพิ่มรูปภาพ */}
      {adding === 'image' && (
        <div className="rounded-lg border border-purple-500/40 bg-purple-500/5 p-2.5 space-y-2">
          <div className="text-[11px] text-purple-200 font-semibold">เพิ่มรูปภาพ</div>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="วาง URL รูปภาพ หรือกดอัปโหลดไฟล์"
              className="input flex-1 text-xs"
            />
            <div className="flex gap-1.5">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void addImageFromFile(f);
                }}
              />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={imageBusy}
                className="btn-secondary px-2 py-1 text-[11px] flex items-center gap-1"
              >
                {imageBusy ? <Loader2 size={11} className="animate-spin" /> : <ImageIcon size={11} />}
                อัปโหลด
              </button>
              <button
                onClick={addImageFromUrl}
                disabled={!imageUrl.trim()}
                className="btn-primary px-2 py-1 text-[11px] disabled:opacity-40"
              >
                ใช้ URL
              </button>
            </div>
          </div>
          <input
            value={imageCaption}
            onChange={(e) => setImageCaption(e.target.value)}
            placeholder="คำอธิบายใต้ภาพ (ไม่บังคับ)"
            className="input w-full text-xs"
          />
        </div>
      )}

      {/* รายการบล็อก */}
      {blocks.length === 0 ? (
        <div className="text-center text-[11px] text-gray-500 py-6 border border-dashed border-blue-900/40 rounded-lg">
          ยังไม่มีบล็อกในหมวดย่อยนี้ — กด "ข้อความ" หรือ "รูปภาพ" เพื่อเริ่ม
        </div>
      ) : (
        blocks.map((b, i) => {
          const Icon = TYPE_ICON[b.type];
          return (
            <div
              key={b.id}
              className="rounded-lg border border-blue-900/40 bg-navy-900/40 overflow-hidden"
            >
              {/* แถบควบคุม */}
              <div className="flex items-center gap-1.5 px-2 py-1.5 bg-navy-800/60 border-b border-blue-900/40">
                <span className="text-[10px] text-gray-500 font-mono w-5 text-center">
                  {i + 1}
                </span>
                <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-semibold ${TYPE_CHIP[b.type]}`}>
                  <Icon size={9} /> {TYPE_LABEL[b.type]}
                </span>
                <div className="flex-1" />
                <button
                  onClick={() => onChange(moveBlock(blocks, i, -1))}
                  disabled={i === 0}
                  className="p-1 rounded text-gray-400 hover:text-amber-400 hover:bg-amber-500/10 disabled:opacity-25 disabled:hover:bg-transparent disabled:hover:text-gray-400"
                  title="ย้ายขึ้น"
                  aria-label="ย้ายบล็อกขึ้น"
                >
                  <ArrowUp size={13} />
                </button>
                <button
                  onClick={() => onChange(moveBlock(blocks, i, 1))}
                  disabled={i === blocks.length - 1}
                  className="p-1 rounded text-gray-400 hover:text-amber-400 hover:bg-amber-500/10 disabled:opacity-25 disabled:hover:bg-transparent disabled:hover:text-gray-400"
                  title="ย้ายลง"
                  aria-label="ย้ายบล็อกลง"
                >
                  <ArrowDown size={13} />
                </button>
                <button
                  onClick={() => onChange(blocks.filter((_, idx) => idx !== i))}
                  className="p-1 rounded text-gray-400 hover:text-red-400 hover:bg-red-500/10"
                  title="ลบบล็อกนี้"
                  aria-label="ลบบล็อก"
                >
                  <Trash2 size={13} />
                </button>
              </div>

              {/* เนื้อหา */}
              <div className="p-2.5">
                {b.type === 'image' ? (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <input
                        value={b.content}
                        onChange={(e) => patch(i, { content: e.target.value })}
                        placeholder="URL รูปภาพ"
                        className="input flex-1 text-xs"
                      />
                      <input
                        value={b.caption ?? ''}
                        onChange={(e) => patch(i, { caption: e.target.value })}
                        placeholder="คำอธิบาย"
                        className="input flex-1 text-xs"
                      />
                    </div>
                    {b.content && (
                      <img
                        src={b.content}
                        alt=""
                        className="max-w-full max-h-40 object-contain rounded border border-blue-900/50 mx-auto"
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                      />
                    )}
                  </div>
                ) : (
                  <>
                    <textarea
                      value={b.type === 'table' || b.type === 'callout'
                        ? String(b.meta?.html ?? '')
                        : b.content}
                      onChange={(e) => patch(
                        i,
                        b.type === 'table' || b.type === 'callout'
                          ? { meta: { html: e.target.value } }
                          : { content: e.target.value },
                      )}
                      rows={b.type === 'table' ? 8 : b.type === 'callout' ? 5 : 4}
                      placeholder={
                        b.type === 'table' ? '<table>…</table> (HTML)'
                          : b.type === 'callout' ? '<div class="callout-warning">…</div> (HTML)'
                            : '<p>…</p> (HTML หรือข้อความธรรมดา)'
                      }
                      className="input w-full text-xs font-mono leading-relaxed"
                    />
                    <div className="mt-1.5 rounded border border-blue-900/40 overflow-hidden">
                      <div className="px-2 py-1 text-[10px] text-gray-500 bg-navy-800/60">ตัวอย่าง</div>
                      <div className="p-2 manual-prose text-xs">
                        <ManualBlockView block={b} />
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

