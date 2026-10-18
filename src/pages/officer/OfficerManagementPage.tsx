import { useEffect, useMemo, useState, ReactNode } from 'react';
import {
  Plus, Edit2, Trash2, Users, Shield, ShieldOff, Key, Search, Upload, X,
  Tag, History, Zap, Check, ChevronUp, ChevronDown, GripVertical, ListOrdered,
  Layers, Wrench, Sparkles, Loader2, AlertCircle,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { hashPassword } from '../../lib/crypto';
import { clearOfficerUsernameCache, getOfficerUsername, withUsernames } from '../../lib/api/officerUsernames';
import { uploadImage } from '../../lib/storage';
import {
  Officer, OfficerRank, OfficerRankRecord, OfficerGenerationRecord, Department,
  RANK_LABELS, DEPARTMENT_LABELS, DEPARTMENTS, COMMISSIONER_RANK,
  SERVICE_CATEGORIES, GENERATION_UNSET_LABEL,
} from '../../lib/types';
import {
  buildPersonnelIndex, sortOfficers, matchesOfficerSearch,
  filterByDepartment, filterByGeneration, nextSortOrder,
  PERSONNEL_SORT_OPTIONS, UNGROUPED_KEY,
  type PersonnelSortMode,
} from '../../lib/personnelOrder';
import { useAuth } from '../../lib/AuthContext';
import { Badge } from '../../components/Badge';
import { Modal, ConfirmDialog } from '../../components/Modal';
import { OfficerHistoryModal } from '../../components/OfficerHistoryModal';
import { PageHeader } from '../../components/PageHeader';

type ActionType = 'suspend' | 'activate' | 'delete' | 'reset';

/**
 * แปลงข้อความ error จาก Supabase ให้เป็นคำแนะนำที่ actionable
 * เคสที่พบบ่อยที่สุดคือ migration ยังไม่ถูก apply
 */
function describeSchemaError(error: { code?: string; message?: string }, target: string): string {
  const code = error.code ?? '';
  const msg = error.message ?? '';

  if (code === '42P01' || /does not exist|not found in the schema|schema cache/i.test(msg)) {
    return `ยังไม่ได้สร้าง ${target} ในฐานข้อมูล — กรุณารัน migration 0027 (supabase db push) แล้วรีเฟรชหน้านี้`;
  }
  if (code === '42703' || /column .* does not exist/i.test(msg)) {
    return `ยังไม่ได้เพิ่มคอลัมน์ที่จำเป็นในตาราง officers — กรุณารัน migration 0027 (supabase db push) แล้วรีเฟรชหน้านี้`;
  }
  if (code === '42501' || /row-level security|permission denied/i.test(msg)) {
    return `ฐานข้อมูลปฏิเสธการเขียน (${target}) — ตรวจสอบ RLS policy หรือสิทธิ์ของผู้ใช้`;
  }
  return `ทำงานกับ ${target} ไม่สำเร็จ: ${msg || code || 'ไม่ทราบสาเหตุ'}`;
}

export function OfficerManagementPage() {
  const { officer: currentOfficer } = useAuth();
  const [officers, setOfficers] = useState<Officer[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQ, setSearchQ] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<Officer | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ type: ActionType; target: Officer } | null>(null);
  const [resetPw, setResetPw] = useState('');
  const [adminVerifyPw, setAdminVerifyPw] = useState('');
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [historyOfficer, setHistoryOfficer] = useState<Officer | null>(null);
  const [showBatchDutyModal, setShowBatchDutyModal] = useState(false);

  // Rank management state
  const [ranks, setRanks] = useState<OfficerRankRecord[]>([]);
  const [showRankForm, setShowRankForm] = useState(false);
  const [rankForm, setRankForm] = useState({ label: '', rank_key: '', sort_order: 0 });
  const [editingRank, setEditingRank] = useState<OfficerRankRecord | null>(null);

  // Generation (รุ่น) management state
  const [generations, setGenerations] = useState<OfficerGenerationRecord[]>([]);
  const [showGenForm, setShowGenForm] = useState(false);
  const [editingGen, setEditingGen] = useState<OfficerGenerationRecord | null>(null);
  const [genForm, setGenForm] = useState({ label: '', generation_key: '', sort_order: 0, is_trainee: false });
  const [genError, setGenError] = useState<string | null>(null);
  const [schemaIssue, setSchemaIssue] = useState<string | null>(null);

  // Sort / filter / reorder state
  const [sortMode, setSortMode] = useState<PersonnelSortMode>('manual');
  const [genFilter, setGenFilter] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; pos: 'before' | 'after' } | null>(null);
  const [savingOrder, setSavingOrder] = useState(false);

  // Wizard state (เพิ่มเจ้าหน้าที่แบบ step-by-step)
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardAdminPw, setWizardAdminPw] = useState('');
  /** รหัสผ่านของหัวหน้ากรม ใช้ยืนยันตัวตนก่อนแก้ข้อมูลเข้าระบบของคนอื่น */
  const [formAdminPw, setFormAdminPw] = useState('');
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1);
  const [wizardTemplate, setWizardTemplate] = useState<Officer | null>(null);
  const [wizardForm, setWizardForm] = useState({
    officer_code: '',
    name: '',
    username: '',
    password: '',
    rank: 'officer' as OfficerRank,
    department: 'traffic_management' as Department,
    duty_rate: 0,
    service_category: '' as string,
    generation: '' as string,
  });
  const [wizardPhotoPreview, setWizardPhotoPreview] = useState<string | null>(null);
  const [wizardPhotoFile, setWizardPhotoFile] = useState<File | null>(null);
  const [wizardUploading, setWizardUploading] = useState(false);
  const [wizardError, setWizardError] = useState<string | null>(null);

  function openWizard() {
    setWizardStep(1);
    setWizardTemplate(null);
    setWizardForm({
      name: '',
      officer_code: '',
      username: '',
      password: '',
      rank: 'officer',
      department: 'traffic_management',
      duty_rate: 0,
      service_category: '',
      generation: '',
    });
    setWizardPhotoPreview(null);
    setWizardPhotoFile(null);
    setWizardError(null);
    setWizardOpen(true);
  }

  function applyTemplate(t: Officer) {
    setWizardTemplate(t);
    setWizardForm((f) => ({
      ...f,
      rank: t.rank,
      department: t.department,
      duty_rate: t.duty_rate ?? 0,
      service_category: t.service_category ?? '',
      generation: t.generation ?? '',
    }));
  }

  async function handleWizardPhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setWizardPhotoFile(f);
    const reader = new FileReader();
    reader.onload = (ev) => setWizardPhotoPreview(ev.target?.result as string);
    reader.readAsDataURL(f);
  }

  async function submitWizard() {
    setWizardUploading(true);
    setWizardError(null);
    try {
      let photo_url: string | null = null;
      if (wizardPhotoFile) {
        const up = await uploadImage(wizardPhotoFile, 'officers');
        if (!up) throw new Error('อัปโหลดรูปไม่สำเร็จ');
        photo_url = up;
      }
      // ข้อมูลเข้าระบบ (username + hash) ไม่ได้อยู่ในตาราง officers อีกแล้ว
      // เพราะ anon อ่านตารางนี้ได้ — เก็บแยกใน schema private (migration 0043)
      const passwordHash = await hashPassword(wizardForm.password);
      const insertData: Record<string, unknown> = {
        officer_code: wizardForm.officer_code.trim().toUpperCase() || null,
        name: wizardForm.name,
        rank: wizardForm.rank,
        department: wizardForm.department,
        duty_rate: wizardForm.duty_rate,
        service_category: wizardForm.service_category || null,
        generation: wizardForm.generation || null,
        sort_order: nextSortOrder(officers),
        status: 'active',
        is_on_duty: false,
        photo_url,
      };
      const { data: created, error } = await supabase
        .from('officers').insert(insertData).select('id').single();
      if (error) {
        if (error.code === '23514') {
          setWizardError('ข้อมูลไม่ตรงเงื่อนไข (เช่น ตำแหน่ง/แผนกไม่ถูกต้อง)');
        } else if (error.code === '42501') {
          setWizardError('สิทธิ์ไม่เพียงพอ (ต้องเป็นหัวหน้ากรม)');
        } else {
          setWizardError(`บันทึกไม่สำเร็จ: ${error.message}`);
        }
        return;
      }

      // stage 2: สร้างข้อมูลเข้าระบบ (ต้องยืนยันรหัสผ่านหัวหน้ากรม)
      if (!wizardAdminPw) {
        // ถอยออก — ลบเจ้าหน้าที่ที่เพิ่งสร้างทิ้ง ไม่ให้เหลือบัญชีที่ล็อกอินไม่ได้
        if (created) await supabase.from('officers').delete().eq('id', created.id);
        setWizardError('กรุณายืนยันรหัสผ่านของหัวหน้ากรมก่อนสร้างบัญชีใหม่');
        return;
      }
      if (!currentOfficer) {
        if (created) await supabase.from('officers').delete().eq('id', created.id);
        setWizardError('ไม่พบข้อมูลผู้ดำเนินการ');
        return;
      }

      const { data: credOk, error: credErr } = await supabase.rpc('admin_create_credentials', {
        p_actor_id: currentOfficer.id,
        p_actor_hash: await hashPassword(wizardAdminPw),
        p_new_id: created.id,
        p_username: wizardForm.username,
        p_password_hash: passwordHash,
      });
      setWizardAdminPw('');
      if (credErr || !credOk) {
        if (created) await supabase.from('officers').delete().eq('id', created.id);
        setWizardError('สร้างบัญชีไม่สำเร็จ: ' + (credErr?.message ?? 'ยืนยันรหัสผ่านหัวหน้ากรมไม่ถูกต้อง'));
        return;
      }

      setWizardOpen(false);
      await fetchAll();
    } catch (e) {
      setWizardError((e as Error).message);
    } finally {
      setWizardUploading(false);
    }
  }

  const [form, setForm] = useState({
    username: '',
    password: '',
    officer_code: '',
    name: '',
    rank: 'officer' as OfficerRank,
    department: 'traffic_management' as Department,
    duty_rate: 0,
    generation: '',
    sort_order: 0,
  });

  useEffect(() => { fetchAll(); fetchRanks(); fetchGenerations(); }, []);

  /**
   * Realtime: เปลี่ยนสถานะปฏิบัติงานให้เห็นทันที
   *
   * เดิมหน้านี้ไม่ subscribe ตาราง officers เลย
   * พอมีคนกดเข้า/ออกเวร สถานะจะค้างจนกว่าจะกดรีเฟรช
   * ซึ่งทำให้หัวหน้ากรมเห็นสถานะผิดและตัดสินใจผิด
   */
  useEffect(() => {
    const ch = supabase
      .channel('officers_live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'officers' },
        (payload: { eventType: string; new: Record<string, unknown>; old: Record<string, unknown> }) => {
          // ดึงใหม่ทั้งชุด เพื่อให้ได้ username ครบด้วย
          void fetchAll();
        },
      )
      .subscribe();

    return () => { void supabase.removeChannel(ch); };
  }, []);

  async function fetchAll() {
    setLoading(true);
    const { data } = await supabase
      .from('officers')
      .select('*')
      .neq('status', 'deleted')
      .order('sort_order')
      .order('name');
    // username ไม่ได้อยู่ในตาราง officers อีกแล้ว (migration 0043)
    // ต้องดึงแยกผ่าน RPC มาเติมก่อนแสดงผล
    setOfficers(await withUsernames((data ?? []) as Officer[]));
    setLoading(false);
  }

  async function fetchRanks() {
    const { data } = await supabase
      .from('officer_ranks')
      .select('*')
      .order('sort_order');
    setRanks(data ?? []);
  }

  async function fetchGenerations() {
    const { data, error } = await supabase
      .from('officer_generations')
      .select('*')
      .order('sort_order');
    if (error) {
      setGenerations([]);
      setSchemaIssue(describeSchemaError(error, 'ตาราง officer_generations'));
      return;
    }
    setSchemaIssue(null);
    setGenerations(((data ?? []) as unknown as OfficerGenerationRecord[]) ?? []);
  }

  /* ---------- ดัชนีข้อมูลอ้างอิง (ใช้ร่วมกับหน้าทำเนียบบุคลากร) ---------- */
  const personnelIndex = useMemo(
    () => buildPersonnelIndex(ranks, generations),
    [ranks, generations],
  );

  /** ลำดับที่แสดงผลจริงในตาราง (หลังคิด sortMode ที่เลือกไว้) */
  const ordered = useMemo(
    () => sortOfficers(officers, sortMode, personnelIndex),
    [officers, sortMode, personnelIndex],
  );

  /** แถวที่แสดงหลังกรอง (คงลำดับตาม `ordered`) */
  const visibleRows = useMemo(() => {
    const list = filterByGeneration(filterByDepartment(ordered, deptFilter), genFilter);
    return list.filter((o) => matchesOfficerSearch(o, searchQ, personnelIndex));
  }, [ordered, deptFilter, genFilter, searchQ, personnelIndex]);

  const hasActiveFilter = !!(searchQ.trim() || deptFilter || genFilter);
  const activeGenerations = personnelIndex.activeGenerations;

  async function handleRankSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!rankForm.label.trim()) return;
    const key = rankForm.rank_key.trim() || rankForm.label.trim().toLowerCase().replace(/\s+/g, '_');
    if (editingRank) {
      const { error } = await supabase.from('officer_ranks').update({
        label: rankForm.label.trim(),
        rank_key: key,
        sort_order: rankForm.sort_order,
        updated_at: new Date().toISOString(),
      }).eq('id', editingRank.id);
      if (error) { alert('ไม่สามารถแก้ไขตำแหน่งได้'); return; }
    } else {
      const { error } = await supabase.from('officer_ranks').insert({
        label: rankForm.label.trim(),
        rank_key: key,
        sort_order: rankForm.sort_order,
      });
      if (error) {
        alert('ไม่สามารถเพิ่มตำแหน่งได้ อาจมีชื่อซ้ำ');
        return;
      }
    }
    setShowRankForm(false);
    setEditingRank(null);
    setRankForm({ label: '', rank_key: '', sort_order: 0 });
    await fetchRanks();
  }

  async function deleteRank(rank: OfficerRankRecord) {
    if (rank.rank_key === COMMISSIONER_RANK || rank.sort_order === 1) {
      alert('ไม่สามารถลบตำแหน่งหัวหน้ากรมขนส่งได้');
      return;
    }
    if (!confirm(`ต้องการลบตำแหน่ง "${rank.label}" ใช่หรือไม่?`)) return;
    await supabase.from('officer_ranks').delete().eq('id', rank.id);
    await fetchRanks();
  }

  function openAddRank() {
    setEditingRank(null);
    setRankForm({ label: '', rank_key: '', sort_order: ranks.length + 1 });
    setShowRankForm(true);
  }

  function openEditRank(rank: OfficerRankRecord) {
    setEditingRank(rank);
    setRankForm({ label: rank.label, rank_key: rank.rank_key ?? '', sort_order: rank.sort_order });
    setShowRankForm(true);
  }

  /* =============== จัดการ "รุ่น" (Generation) =============== */

  function openAddGen() {
    setEditingGen(null);
    setGenError(null);
    setGenForm({
      label: '',
      generation_key: '',
      sort_order: generations.length + 1,
      is_trainee: generations.length === 0,
    });
    setShowGenForm(true);
  }

  function openEditGen(g: OfficerGenerationRecord) {
    setEditingGen(g);
    setGenError(null);
    setGenForm({
      label: g.label,
      generation_key: g.generation_key ?? '',
      sort_order: g.sort_order,
      is_trainee: g.is_trainee,
    });
    setShowGenForm(true);
  }

  async function handleGenSubmit(e: React.FormEvent) {
    e.preventDefault();
    const label = genForm.label.trim();
    if (!label) { setGenError('กรุณากรอกชื่อรุ่น'); return; }
    const key = genForm.generation_key.trim() || label.replace(/\s+/g, '_');
    setGenError(null);

    if (editingGen) {
      const { error } = await supabase.from('officer_generations').update({
        label,
        generation_key: key,
        sort_order: genForm.sort_order,
        is_trainee: genForm.is_trainee,
        updated_at: new Date().toISOString(),
      }).eq('id', editingGen.id);
      if (error) { setGenError(describeSchemaError(error, 'ตาราง officer_generations')); return; }
      setSchemaIssue(null);
    } else {
      const { error } = await supabase.from('officer_generations').insert({
        label,
        generation_key: key,
        sort_order: genForm.sort_order,
        is_trainee: genForm.is_trainee,
        is_active: true,
      });
      if (error) {
        if (error.code === '23505') {
          setGenError('รหัสรุ่นนี้ถูกใช้แล้ว กรุณาใช้รหัสอื่น');
        } else {
          setGenError(describeSchemaError(error, 'ตาราง officer_generations'));
        }
        return;
      }
      setSchemaIssue(null);
    }
    setShowGenForm(false);
    setEditingGen(null);
    setGenForm({ label: '', generation_key: '', sort_order: 0, is_trainee: false });
    await fetchGenerations();
  }

  async function deleteGen(g: OfficerGenerationRecord) {
    const key = (g.generation_key ?? g.label ?? '').trim();
    const affected = officers.filter((o) => (o.generation ?? '').trim() === key).length;
    const msg = affected > 0
      ? `ต้องการลบรุ่น "${g.label}" ใช่หรือไม่?\n\nเจ้าหน้าที่ ${affected} คนจะยังคงมีรุ่นนี้อยู่ แต่จะแสดงเป็น "${g.label}" เฉย ๆ`
      : `ต้องการลบรุ่น "${g.label}" ใช่หรือไม่?`;
    if (!confirm(msg)) return;
    const { error } = await supabase.from('officer_generations').delete().eq('id', g.id);
    if (error) {
      setGenError(describeSchemaError(error, 'ตาราง officer_generations'));
      return;
    }
    setSchemaIssue(null);
    setGenError(null);
    await fetchGenerations();
  }

  /* =============== จัดลำดับรายชื่อ (sort_order) =============== */

  /**
   * บันทึกลำดับใหม่
   * - nextVisible คือลำดับใหม่ของ "แถวที่มองเห็น" (หลังกรอง)
   * - ตำแหน่งช่องของแถวที่มองเห็นจะถูกแทนที่ตามลำดับใหม่
   *   โดยแถวที่ถูกกรองออกจะยังอยู่ที่เดิม (ไม่ถูกไปเหวี่ยง)
   */
  async function commitReorder(nextVisible: Officer[]) {
    if (nextVisible.length === 0) return;

    const visibleIds = new Set(nextVisible.map((o) => o.id));
    const slots: number[] = [];
    ordered.forEach((o, i) => { if (visibleIds.has(o.id)) slots.push(i); });
    if (slots.length !== nextVisible.length) return;

    const nextFull = [...ordered];
    slots.forEach((slot, i) => { nextFull[slot] = nextVisible[i]; });

    const stamped = nextFull.map((o, i) => ({ ...o, sort_order: i + 1 }));
    const changes = stamped
      .map((o) => ({ id: o.id, sort_order: o.sort_order ?? 1 }))
      .filter((c, i) => (nextFull[i].sort_order ?? 0) !== c.sort_order);

    if (changes.length === 0) return;

    // optimistic update
    const snapshot = officers;
    setOfficers(stamped);
    setSavingOrder(true);
    try {
      const results = await Promise.all(
        changes.map((c) =>
          supabase.from('officers')
            .update({ sort_order: c.sort_order, updated_at: new Date().toISOString() })
            .eq('id', c.id),
        ),
      );
      const failed = results.find((r) => r.error);
      if (failed?.error) throw failed.error;
    } catch (err) {
      setOfficers(snapshot);
      alert(`บันทึกลำดับไม่สำเร็จ: ${(err as Error).message}`);
    } finally {
      setSavingOrder(false);
    }
  }

  function moveRow(id: string, direction: -1 | 1) {
    const list = [...visibleRows];
    const i = list.findIndex((o) => o.id === id);
    const j = i + direction;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    commitReorder(list);
  }

  /** เขียน sort_order ใหม่ทั้งหมดเป็น 1..N ตามลำดับที่แสดงอยู่ (ปรับลำดับให้ต่อเนื่อง) */
  function normalizeOrder() {
    if (!confirm('จัดลำดับใหม่ให้ต่อเนื่อง 1..N ตามลำดับที่แสดงอยู่ใช่หรือไม่?')) return;
    commitReorder([...visibleRows]);
  }

  /* ---------- Drag & Drop ---------- */

  function handleDragStart(e: React.DragEvent<HTMLButtonElement>, id: string) {
    setDragId(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
    const row = e.currentTarget.closest('tr');
    if (row) e.dataTransfer.setDragImage(row, 40, 20);
  }

  function handleDragOver(e: React.DragEvent<HTMLTableRowElement>, o: Officer) {
    if (!dragId || dragId === o.id) { setDropTarget(null); return; }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = e.currentTarget.getBoundingClientRect();
    const pos = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    setDropTarget({ id: o.id, pos });
  }

  function handleDrop(e: React.DragEvent<HTMLTableRowElement>, target: Officer) {
    e.preventDefault();
    const srcId = dragId ?? e.dataTransfer.getData('text/plain');
    const pos = dropTarget?.pos ?? 'before';
    setDragId(null);
    setDropTarget(null);
    if (!srcId || srcId === target.id) return;

    const moving = visibleRows.find((o) => o.id === srcId);
    if (!moving) return;
    const rest = visibleRows.filter((o) => o.id !== srcId);
    const at = rest.findIndex((o) => o.id === target.id);
    if (at < 0) return;

    const nextVisible = [...rest.slice(0, pos === 'before' ? at : at + 1), moving, ...rest.slice(pos === 'before' ? at : at + 1)];
    commitReorder(nextVisible);
  }

  function handleDragEnd() {
    setDragId(null);
    setDropTarget(null);
  }

  function openAdd() {
    setEditItem(null);
    const defaultRank = ranks[0]?.rank_key ?? 'officer';
    setForm({
      username: '',
      password: '',
      officer_code: '',
      name: '',
      rank: defaultRank,
      department: 'traffic_management',
      duty_rate: 0,
      generation: '',
      sort_order: nextSortOrder(officers),
    });
    setPhotoPreview(null);
    setPhotoFile(null);
    setShowForm(true);
  }

  function openEdit(item: Officer) {
    setEditItem(item);
    setForm({
      username: item.username ?? '',
      password: '',
      officer_code: item.officer_code ?? '',
      name: item.name,
      rank: item.rank,
      department: item.department,
      duty_rate: item.duty_rate ?? 0,
      generation: item.generation ?? '',
      sort_order: item.sort_order ?? 0,
    });
    setPhotoPreview(item.photo_url ?? null);
    setPhotoFile(null);
    setShowForm(true);
  }

  function handlePhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setPhotoPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    let photoUrl = editItem?.photo_url ?? null;
    /** id ของเจ้าหน้าที่ที่เพิ่งสร้าง — ใช้สร้าง credentials หลังจากนี้ */
    let created: { id: string } | null = null;

    if (photoFile) {
      setUploadingPhoto(true);
      const uploaded = await uploadImage(photoFile, 'officers');
      if (uploaded) photoUrl = uploaded;
      setUploadingPhoto(false);
    }

    const dutyRateVal = Number(form.duty_rate) || 0;
    const generationVal = form.generation.trim() || null;
    const sortOrderVal = Number.isFinite(Number(form.sort_order))
      ? Number(form.sort_order)
      : nextSortOrder(officers);

    if (editItem) {
      const update: Partial<Officer> & { updated_at: string } = {
        name: form.name,
        rank: form.rank,
        department: form.department,
        duty_rate: dutyRateVal,
        generation: generationVal,
        sort_order: sortOrderVal,
        photo_url: photoUrl,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from('officers').update(update).eq('id', editItem.id);
      if (error) {
        if (error.code === '42501' || error.message?.includes('permission')) {
          alert('คุณไม่มีสิทธิ์แก้ไขเจ้าหน้าที่');
        } else if (error.code === '23514') {
          alert('ข้อมูลไม่ถูกต้อง: ตำแหน่งหรือแผนกอาจไม่ตรงกับที่ระบบรองรับ');
        } else {
          alert(`ไม่สามารถแก้ไขเจ้าหน้าที่ได้: ${error.message || 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ'}`);
        }
        return;
      }
    } else {
      if (!form.password) { alert('กรุณาตั้งรหัสผ่าน'); return; }
      if (!form.username.trim()) { alert('กรุณากรอก Username'); return; }
      if (!formAdminPw) { alert('กรุณายืนยันรหัสผ่านของหัวหน้ากรมก่อนสร้างบัญชี'); return; }
      if (!currentOfficer) { alert('ไม่พบข้อมูลผู้ดำเนินการ'); return; }

      const ins = await supabase.from('officers').insert({
        officer_code: form.officer_code.trim().toUpperCase() || null,
        name: form.name,
        rank: form.rank,
        department: form.department,
        duty_rate: dutyRateVal,
        generation: generationVal,
        sort_order: sortOrderVal,
        photo_url: photoUrl,
        status: 'active',
        is_on_duty: false,
      }).select('id').single();
      created = ins.data;
      const error = ins.error;
      if (error) {
        if (error.code === '23505') {
          alert('Username นี้ถูกใช้แล้ว กรุณาใช้ชื่ออื่น');
        } else if (error.code === '23514') {
          alert('ข้อมูลไม่ถูกต้อง: ตำแหน่งหรือแผนกอาจไม่ตรงกับที่ระบบรองรับ');
        } else if (error.code === '42501' || error.message?.includes('permission')) {
          alert('คุณไม่มีสิทธิ์เพิ่มเจ้าหน้าที่');
        } else {
          alert(`ไม่สามารถเพิ่มเจ้าหน้าที่ได้: ${error.message || 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ'}`);
        }
        return;
      }
    }

    // ---------- ข้อมูลเข้าระบบ (เก็บใน schema private) ----------
    //
    // ถ้าไม่สร้าง credentials เจ้าหน้าที่คนใหม่จะล็อกอินไม่ได้เลย
    // เพราะตาราง officers ไม่มี username/password_hash อีกแล้ว (migration 0043)
    if (editItem) {
      // โหมดแก้ไข — แก้เฉพาะเมื่อมีการเปลี่ยน username หรือรหัสผ่าน
      const newUsername = form.username.trim();
      const oldUsername = await getOfficerUsername(editItem.id);
      const usernameChanged = newUsername && newUsername !== oldUsername;

      if (usernameChanged || form.password) {
        if (!formAdminPw) {
          alert('กรุณายืนยันรหัสผ่านของหัวหน้ากรมก่อนเปลี่ยนข้อมูลเข้าระบบ');
          return;
        }
        if (!currentOfficer) { alert('ไม่พบข้อมูลผู้ดำเนินการ'); return; }

        const { data: ok, error: credErr } = await supabase.rpc('admin_set_password', {
          p_actor_id: currentOfficer.id,
          p_actor_hash: await hashPassword(formAdminPw),
          p_target_id: editItem.id,
          p_new_hash: form.password ? await hashPassword(form.password) : '',
          p_new_username: usernameChanged ? newUsername : null,
        });
        setFormAdminPw('');

        if (credErr || !ok) {
          alert('เปลี่ยนข้อมูลเข้าระบบไม่สำเร็จ: ' + (credErr?.message ?? 'ยืนยันรหัสผ่านหัวหน้ากรมไม่ถูกต้อง'));
          return;
        }
      }
    } else if (created && currentOfficer) {
      // โหมดเพิ่มใหม่ — ต้องสร้าง credentials เสมอ
      const { data: ok, error: credErr } = await supabase.rpc('admin_create_credentials', {
        p_actor_id: currentOfficer.id,
        p_actor_hash: await hashPassword(formAdminPw),
        p_new_id: created.id,
        p_username: form.username.trim(),
        p_password_hash: await hashPassword(form.password),
      });
      setFormAdminPw('');

      if (credErr || !ok) {
        // สร้าง officer แล้วแต่ credentials ไม่ผ่าน → ถอยออก
        // ไม่ให้เหลือบัญชีที่ล็อกอินไม่ได้
        await supabase.from('officers').delete().eq('id', created.id);
        alert('สร้างบัญชีไม่สำเร็จ: ' + (credErr?.message ?? 'ยืนยันรหัสผ่านหัวหน้ากรมไม่ถูกต้อง'));
        return;
      }
    }

    clearOfficerUsernameCache();
    setShowForm(false);
    setEditItem(null);
    setPhotoPreview(null);
    setPhotoFile(null);
    await fetchAll();
  }

  async function executeAction() {
    if (!confirmAction || !currentOfficer) return;
    const { type, target } = confirmAction;

    if (type === 'suspend') {
      await supabase.from('officers').update({ status: 'suspended', is_on_duty: false, updated_at: new Date().toISOString() }).eq('id', target.id);
    } else if (type === 'activate') {
      await supabase.from('officers').update({ status: 'active', updated_at: new Date().toISOString() }).eq('id', target.id);
    } else if (type === 'delete') {
      await supabase.from('officers').update({ status: 'deleted', is_on_duty: false, updated_at: new Date().toISOString() }).eq('id', target.id);
      await supabase.from('audit_logs').insert({
        action: 'DELETE_OFFICER',
        target_type: 'officer',
        target_id: target.id,
        performed_by: currentOfficer.id,
        performed_by_name: currentOfficer.name,
        details: { deleted_name: target.name, deleted_username: target.username },
      });
    } else if (type === 'reset') {
      if (!resetPw) { alert('กรุณากรอกรหัสผ่านใหม่'); return; }
      if (!adminVerifyPw) { alert('กรุณายืนยันรหัสผ่านของคุณก่อนตั้งรหัสผ่านผู้อื่น'); return; }
      if (!currentOfficer) { alert('ไม่พบข้อมูลผู้ดำเนินการ'); return; }

      // ต้องยืนยันรหัสผ่านตัวเอง เพราะยังไม่มีระบบยืนยันตัวตนจริง
      // (ดู migration 0043) — ไม่งั้นใครก็เรียก RPC นี้เพื่อเข้าควบคุมบัญชีอื่นได้
      const actorHash = await hashPassword(adminVerifyPw);
      const { data, error } = await supabase.rpc('admin_set_password', {
        p_actor_id: currentOfficer.id,
        p_actor_hash: actorHash,
        p_target_id: target.id,
        p_new_hash: await hashPassword(resetPw),
        p_new_username: null,
      });
      setAdminVerifyPw('');
      if (error || !data) {
        alert('ตั้งรหัสผ่านไม่สำเร็จ: ' + (error?.message ?? 'ยืนยันรหัสผ่านไม่ถูกต้อง'));
        return;
      }
      setResetPw('');
    }

    setConfirmAction(null);
    await fetchAll();
  }

  const rankBadge = (rank: OfficerRank) => {
    const rankRecord = ranks.find(r => r.rank_key === rank || r.label === rank);
    const label = rankRecord?.label ?? RANK_LABELS[rank] ?? rank;
    if (rank === COMMISSIONER_RANK || rankRecord?.sort_order === 1) {
      return <Badge variant="warning">{label}</Badge>;
    }
    if (rankRecord?.sort_order === 2) return <Badge variant="info">{label}</Badge>;
    return <Badge variant="neutral">{label}</Badge>;
  };

  /** ป้ายรุ่น — สีฟ้าเมื่อเป็นกลุ่มพนักงานทดลองงาน */
  const generationCell = (o: Officer) => {
    const key = (o.generation ?? '').trim();
    if (!key) return <span className="text-[11px] text-gray-600">—</span>;
    const trainee = personnelIndex.isTrainee(key);
    return (
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold border ${
          trainee
            ? 'bg-sky-500/10 text-sky-300 border-sky-500/40'
            : 'bg-navy-700 text-gray-300 border-blue-900/60'
        }`}
      >
        {personnelIndex.genLabel(key)}
        {trainee && <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />}
      </span>
    );
  };

  const statusBadge = (status: string) => {
    if (status === 'active') return <Badge variant="success">ปกติ</Badge>;
    if (status === 'suspended') return <Badge variant="danger">ระงับ</Badge>;
    return <Badge variant="neutral">{status}</Badge>;
  };

  const confirmMessages: Record<ActionType, { title: string; msg: string; label: string }> = {
    suspend: { title: 'ระงับการใช้งาน', msg: 'เจ้าหน้าที่จะไม่สามารถเข้าสู่ระบบได้', label: 'ระงับ' },
    activate: { title: 'เปิดใช้งานอีกครั้ง', msg: 'เจ้าหน้าที่จะสามารถเข้าสู่ระบบได้', label: 'เปิดใช้งาน' },
    delete: { title: 'ลบเจ้าหน้าที่', msg: 'บัญชีจะถูกลบและไม่สามารถเข้าสู่ระบบได้อีก (ประวัติจะยังคงเก็บไว้)', label: 'ลบ' },
    reset: { title: 'รีเซ็ตรหัสผ่าน', msg: 'ระบุรหัสผ่านใหม่สำหรับเจ้าหน้าที่', label: 'รีเซ็ต' },
  };

  return (
    <div>
      <PageHeader
        icon={<Users size={26} />}
        title="จัดการเจ้าหน้าที่"
        subtitle="เพิ่ม แก้ไข และจัดการบัญชีเจ้าหน้าที่"
        actions={
          <>
            <button
              onClick={() => setShowBatchDutyModal(true)}
              className="btn-secondary flex items-center gap-1.5 text-amber-400 hover:text-amber-300 border-amber-500/30"
              title="กำหนดอัตราค่าขึ้นเวร (BC ต่อชั่วโมง) ให้เจ้าหน้าที่ทุกคนพร้อมกัน"
            >
              <Zap size={15} /> กำหนดเรทขึ้นเวรทุกคน
            </button>
            <button onClick={openAddRank} className="btn-secondary flex items-center gap-2">
              <Tag size={16} /> จัดการตำแหน่ง
            </button>
            <button onClick={openAddGen} className="btn-secondary flex items-center gap-2" title="จัดการรุ่น / กลุ่มพนักงานทดลองงาน">
              <Layers size={16} /> จัดการรุ่น
            </button>
            <button onClick={openWizard} className="btn-secondary flex items-center gap-2">
              <Plus size={16} /> เพิ่มด้วย Wizard
            </button>
            <button onClick={openAdd} className="btn-primary flex items-center gap-2">
              <Plus size={16} /> เพิ่มเจ้าหน้าที่
            </button>
          </>
        }
      />

      {/* Rank Management Panel */}
      {showRankForm && (
        <div className="card p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white">{editingRank ? 'แก้ไขตำแหน่ง' : 'เพิ่มตำแหน่งใหม่'}</h2>
            <button onClick={() => { setShowRankForm(false); setEditingRank(null); }} className="text-gray-500 hover:text-white">
              <X size={16} />
            </button>
          </div>
          <form onSubmit={handleRankSubmit} className="flex gap-3 items-end">
            <div className="flex-1">
              <label className="block text-xs text-gray-400 mb-1">ชื่อตำแหน่ง</label>
              <input
                className="input-field"
                placeholder="เช่น หัวหน้ากองบัญชาการ"
                value={rankForm.label}
                onChange={(e) => setRankForm({ ...rankForm, label: e.target.value })}
                autoFocus
              />
            </div>
            <div className="w-28">
              <label className="block text-xs text-gray-400 mb-1">ลำดับ (น้อย = สูง)</label>
              <input
                type="number"
                className="input-field"
                value={rankForm.sort_order}
                onChange={(e) => setRankForm({ ...rankForm, sort_order: parseInt(e.target.value) || 0 })}
              />
            </div>
            <div className="w-40">
              <label className="block text-xs text-gray-400 mb-1">รหัสตำแหน่ง (อังกฤษ)</label>
              <input
                className="input-field"
                placeholder="เช่น officer, inspector"
                value={rankForm.rank_key}
                onChange={(e) => setRankForm({ ...rankForm, rank_key: e.target.value })}
              />
            </div>
            <button type="submit" className="btn-primary px-5">
              {editingRank ? 'บันทึก' : 'เพิ่ม'}
            </button>
          </form>
        </div>
      )}

      {/* Existing Ranks List */}
      {ranks.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          {ranks.map((r) => (
            <div key={r.id} className="flex items-center gap-2 bg-navy-800 border border-amber-500/15 rounded-lg px-3 py-1.5">
              <span className="text-xs text-gray-500">#{r.sort_order}</span>
              <span className="text-sm text-white font-medium">{r.label}</span>
              <button onClick={() => openEditRank(r)} className="text-blue-400 hover:bg-blue-500/10 p-1 rounded">
                <Edit2 size={11} />
              </button>
              {r.rank_key !== COMMISSIONER_RANK && r.sort_order !== 1 && (
                <button onClick={() => deleteRank(r)} className="text-red-400 hover:bg-red-500/10 p-1 rounded">
                  <Trash2 size={11} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* =============== Generation Management =============== */}
      {schemaIssue && (
        <div className="card p-4 mb-6 border-red-500/40 bg-red-500/[0.06] flex items-start gap-3">
          <AlertCircle size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-red-300 mb-1">ยังใช้ฟีเจอร์ "รุ่น" ไม่ได้</p>
            <p className="text-xs text-gray-400 leading-relaxed">{schemaIssue}</p>
            <p className="text-[11px] text-gray-500 mt-1.5">
              ระบบนี้เชื่อมต่อ Supabase จริง (ดู <code className="text-amber-400/80">.env</code>) — ถ้ากำลังทดลองแบบออฟไลน์
              ให้ตั้ง <code className="text-amber-400/80">VITE_USE_MOCK=true</code> แล้วรีเฟรช
            </p>
          </div>
        </div>
      )}

      {genError && !showGenForm && (
        <div className="card p-3 mb-6 border-red-500/40 bg-red-500/[0.06] flex items-start gap-2.5">
          <AlertCircle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-red-300 leading-relaxed">{genError}</p>
        </div>
      )}

      {showGenForm && (
        <div className="card p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <Layers size={15} className="text-amber-400" />
              {editingGen ? 'แก้ไขรุ่น' : 'เพิ่มรุ่นใหม่'}
            </h2>
            <button
              onClick={() => { setShowGenForm(false); setEditingGen(null); setGenError(null); }}
              className="text-gray-500 hover:text-white"
            >
              <X size={16} />
            </button>
          </div>
          <form onSubmit={handleGenSubmit} className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[180px]">
              <label className="block text-xs text-gray-400 mb-1">ชื่อรุ่น *</label>
              <input
                className="input-field"
                placeholder="เช่น รุ่นที่ 4"
                value={genForm.label}
                onChange={(e) => setGenForm({ ...genForm, label: e.target.value })}
                autoFocus
              />
            </div>
            <div className="w-40">
              <label className="block text-xs text-gray-400 mb-1">รหัสรุ่น</label>
              <input
                className="input-field font-mono"
                placeholder="เช่น 4"
                value={genForm.generation_key}
                onChange={(e) => setGenForm({ ...genForm, generation_key: e.target.value })}
              />
              <p className="text-[10px] text-gray-600 mt-1">เว้นว่างไว้ = ใช้ชื่อรุ่นแทน</p>
            </div>
            <div className="w-28">
              <label className="block text-xs text-gray-400 mb-1">ลำดับ</label>
              <input
                type="number"
                className="input-field font-mono"
                value={genForm.sort_order}
                onChange={(e) => setGenForm({ ...genForm, sort_order: parseInt(e.target.value) || 0 })}
              />
            </div>
            <label className="flex items-center gap-2 cursor-pointer select-none pb-2.5">
              <input
                type="checkbox"
                checked={genForm.is_trainee}
                onChange={(e) => setGenForm({ ...genForm, is_trainee: e.target.checked })}
                className="w-4 h-4 accent-amber-500"
              />
              <span className="text-xs text-gray-300">กลุ่มพนักงานทดลองงาน</span>
            </label>
            <button type="submit" className="btn-primary px-5">
              {editingGen ? 'บันทึก' : 'เพิ่ม'}
            </button>
          </form>
          {genError && (
            <p className="text-xs text-red-400 mt-3 flex items-center gap-1.5">
              <X size={12} /> {genError}
            </p>
          )}
        </div>
      )}

      {/* Existing Generations List */}
      {generations.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          {generations.map((g) => {
            const key = (g.generation_key ?? g.label ?? '').trim();
            const count = officers.filter((o) => (o.generation ?? '').trim() === key).length;
            return (
              <div
                key={g.id}
                className={`flex items-center gap-2 border rounded-lg px-3 py-1.5 ${
                  g.is_trainee
                    ? 'bg-sky-500/10 border-sky-500/30'
                    : 'bg-navy-800 border-amber-500/15'
                }`}
              >
                <span className="text-xs text-gray-500">#{g.sort_order}</span>
                <span className="text-sm text-white font-medium">{g.label}</span>
                <span className="text-[10px] font-mono text-gray-500">{count} คน</span>
                {g.is_trainee && (
                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-sky-500/20 text-sky-300 border border-sky-500/40">
                    ทดลองงาน
                  </span>
                )}
                <button onClick={() => openEditGen(g)} className="text-blue-400 hover:bg-blue-500/10 p-1 rounded">
                  <Edit2 size={11} />
                </button>
                <button onClick={() => deleteGen(g)} className="text-red-400 hover:bg-red-500/10 p-1 rounded">
                  <Trash2 size={11} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Toolbar: search + sort + filters */}
      <div className="card relative mb-6 overflow-hidden">
        <span className="ph-corner ph-corner-tl" aria-hidden />
        <span className="ph-corner ph-corner-br" aria-hidden />
        <div className="p-3 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              className="input-field pl-9"
              placeholder="ค้นหาชื่อ, Username, ตำแหน่ง, แผนก, รุ่น..."
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-1.5">
            <ListOrdered size={14} className="text-amber-500/80" />
            <select
              className="select-field !w-auto !py-1.5 !px-2 !text-xs"
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as PersonnelSortMode)}
              title="ลำดับที่ใช้แสดงผลในตาราง (ลากเพื่อจัดลำดับได้ตามลำดับนี้)"
            >
              {PERSONNEL_SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <Layers size={14} className="text-sky-400/80" />
            <select
              className="select-field !w-auto !py-1.5 !px-2 !text-xs"
              value={genFilter}
              onChange={(e) => setGenFilter(e.target.value)}
            >
              <option value="">ทุกรุ่น</option>
              <option value={UNGROUPED_KEY}>— ไม่ระบุรุ่น —</option>
              {activeGenerations.map((g) => {
                const key = (g.generation_key ?? g.label ?? '').trim();
                if (!key) return null;
                return <option key={g.id} value={key}>{g.label}</option>;
              })}
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <Wrench size={14} className="text-amber-500/80" />
            <select
              className="select-field !w-auto !py-1.5 !px-2 !text-xs"
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
            >
              <option value="">ทุกแผนก</option>
              {DEPARTMENTS.map((d) => (
                <option key={d} value={d}>{DEPARTMENT_LABELS[d]}</option>
              ))}
            </select>
          </div>

          {hasActiveFilter && (
            <button
              onClick={() => { setSearchQ(''); setGenFilter(''); setDeptFilter(''); }}
              className="text-[11px] text-gray-400 hover:text-amber-400 transition-colors"
            >
              ล้างตัวกรอง
            </button>
          )}
        </div>

        {/* แถบบอกวิธีจัดลำดับ */}
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-t border-blue-900/40 bg-navy-900/40">
          <GripVertical size={13} className="text-gray-500" />
          <span className="text-[11px] text-gray-400">
            ลากที่ไอคอนจับ หรือกดปุ่ม <ChevronUp size={11} className="inline" /> / <ChevronDown size={11} className="inline" />
            เพื่อจัดลำดับความสำคัญ — ลำดับที่บันทึกจะถูกใช้ในหน้า<strong className="text-amber-400 font-semibold"> ทำเนียบบุคลากร</strong>
          </span>
          {savingOrder && (
            <span className="text-[11px] text-amber-400 flex items-center gap-1">
              <Loader2 size={11} className="animate-spin" /> กำลังบันทึก...
            </span>
          )}
          <div className="flex-1" />
          <button
            onClick={normalizeOrder}
            className="text-[11px] text-gray-400 hover:text-amber-400 transition-colors flex items-center gap-1"
            title="เขียน sort_order ใหม่เป็น 1..N ตามลำดับปัจจุบัน"
          >
            <Sparkles size={11} /> จัดลำดับใหม่ 1..N
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="table-panel">
        <div className="overflow-x-auto">
          {loading ? (
            <div className="p-8 text-center text-gray-500 text-sm">กำลังโหลด...</div>
          ) : visibleRows.length === 0 ? (
            <div className="p-12 text-center">
              <Users size={36} className="text-gray-600 mx-auto mb-2" />
              <p className="text-gray-400 text-sm">ไม่พบเจ้าหน้าที่</p>
              {hasActiveFilter && (
                <button
                  onClick={() => { setSearchQ(''); setGenFilter(''); setDeptFilter(''); }}
                  className="btn-secondary mt-4 inline-flex"
                >
                  ล้างตัวกรอง
                </button>
              )}
            </div>
          ) : (
            <table className="w-full min-w-[860px]">
              <thead className="table-header-gold">
                <tr className="border-b border-amber-500/15">
                  <th className="w-10 text-center">ลาก</th>
                  <th className="text-left px-3 py-3 text-xs font-medium text-gray-500 uppercase">ลำดับ</th>
                  <th className="text-left px-3 py-3 text-xs font-medium text-gray-500 uppercase">รหัส</th>
                  <th className="text-left px-3 py-3 text-xs font-medium text-gray-500 uppercase">ชื่อ / Username</th>
                  <th className="text-left px-3 py-3 text-xs font-medium text-gray-500 uppercase">ตำแหน่ง</th>
                  <th className="text-left px-3 py-3 text-xs font-medium text-gray-500 uppercase">แผนก</th>
                  <th className="text-left px-3 py-3 text-xs font-medium text-gray-500 uppercase">รุ่น</th>
                  <th className="text-center px-3 py-3 text-xs font-medium text-gray-500 uppercase">สถานะ</th>
                  <th className="text-center px-3 py-3 text-xs font-medium text-gray-500 uppercase">เวร</th>
                  <th className="px-3 py-3 text-xs font-medium text-gray-500 uppercase text-right">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((o, i) => {
                  const isDragging = dragId === o.id;
                  const dropPos = dropTarget?.id === o.id ? dropTarget.pos : null;
                  return (
                    <tr
                      key={o.id}
                      onDragOver={(e) => handleDragOver(e, o)}
                      onDrop={(e) => handleDrop(e, o)}
                      className={`table-row transition-opacity ${
                        o.id === currentOfficer?.id ? 'bg-amber-500/5' : ''
                      } ${isDragging ? 'opacity-40' : ''} ${
                        dropPos === 'before' ? 'border-t-2 border-t-amber-400' : ''
                      } ${dropPos === 'after' ? 'border-b-2 border-b-amber-400' : ''}`}
                    >
                      {/* ไอคอนจับลาก */}
                      <td className="px-2 py-3 text-center">
                        <button
                          type="button"
                          draggable
                          onDragStart={(e) => handleDragStart(e, o.id)}
                          onDragEnd={handleDragEnd}
                          title="ลากเพื่อจัดลำดับ"
                          aria-label={`ลากเพื่อจัดลำดับ ${o.name}`}
                          className="cursor-grab active:cursor-grabbing text-gray-600 hover:text-amber-400 transition-colors"
                        >
                          <GripVertical size={16} />
                        </button>
                      </td>

                      {/* ลำดับ + ปุ่มเลื่อน */}
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] font-mono text-gray-500 w-6 text-center">
                            {o.sort_order ?? '—'}
                          </span>
                          <div className="flex flex-col">
                            <button
                              onClick={() => moveRow(o.id, -1)}
                              disabled={i === 0}
                              title="เลื่อนขึ้น"
                              className="text-gray-500 hover:text-amber-400 disabled:opacity-20 disabled:hover:text-gray-500 transition-colors leading-none"
                            >
                              <ChevronUp size={13} />
                            </button>
                            <button
                              onClick={() => moveRow(o.id, 1)}
                              disabled={i === visibleRows.length - 1}
                              title="เลื่อนลง"
                              className="text-gray-500 hover:text-amber-400 disabled:opacity-20 disabled:hover:text-gray-500 transition-colors leading-none"
                            >
                              <ChevronDown size={13} />
                            </button>
                          </div>
                        </div>
                      </td>

                      {/* รหัสเจ้าหน้าที่ — แยกคอลัมน์ให้เห็นชัด กันลืมกรอก */}
                      <td className="px-3 py-3">
                        {o.officer_code ? (
                          <span className="font-mono text-xs font-semibold text-blue-300 bg-blue-500/10 border border-blue-500/30 rounded px-1.5 py-0.5 inline-block">
                            {o.officer_code}
                          </span>
                        ) : (
                          <button
                            onClick={() => { openEdit(o); setForm({ ...form, officer_code: '' }); }}
                            className="text-[11px] text-amber-400 hover:text-amber-300 underline underline-offset-2"
                            title="ยังไม่ได้ตั้งรหัสเจ้าหน้าที่ — คลิกเพื่อกรอก"
                          >
                            ยังไม่ได้ตั้ง
                          </button>
                        )}
                      </td>

                      {/* ชื่อ / Username */}
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-lg overflow-hidden bg-navy-700 border border-blue-900/60 flex items-center justify-center flex-shrink-0">
                            {o.photo_url ? (
                              <img src={o.photo_url} alt={o.name} className="w-full h-full object-cover" loading="lazy" />
                            ) : (
                              <span className="text-amber-400 font-bold text-sm">
                                {o.name.charAt(0).toUpperCase()}
                              </span>
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="text-white text-sm font-medium truncate flex items-center gap-1.5">
                              {o.id === currentOfficer?.id && (
                                <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 flex-shrink-0">
                                  คุณ
                                </span>
                              )}
                              <span className="truncate">{o.name}</span>
                            </div>
                            {/* สถานะปฏิบัติงาน — เปลี่ยนทันทีเมื่อกดเข้า/ออกเวร */}
                            <div className="flex items-center gap-1.5 text-[11px] mt-0.5">
                              <span
                                className={`inline-flex items-center gap-1 ${
                                  o.is_on_duty ? 'text-emerald-400' : 'text-gray-500'
                                }`}
                              >
                                <span className={`w-1.5 h-1.5 rounded-full ${
                                  o.is_on_duty ? 'bg-emerald-400' : 'bg-gray-600'
                                }`} />
                                {o.is_on_duty ? 'กำลังปฏิบัติหน้าที่' : 'ไม่ได้ปฏิบัติหน้าที่'}
                              </span>
                              {o.username && (
                                <span className="text-gray-500 font-mono truncate">@{o.username}</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>

                      <td className="px-3 py-3">{rankBadge(o.rank)}</td>

                      <td className="px-3 py-3 text-sm text-gray-400">
                        <div className="text-white truncate">{DEPARTMENT_LABELS[o.department]}</div>
                        <div className="text-[11px] text-amber-400/80 font-mono">
                          {(o.duty_rate ?? 0).toLocaleString('th-TH')} BC/ชม.
                        </div>
                      </td>

                      <td className="px-3 py-3">{generationCell(o)}</td>

                      <td className="px-3 py-3 text-center">{statusBadge(o.status)}</td>

                      <td className="px-3 py-3 text-center">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${o.is_on_duty ? 'text-emerald-400 bg-emerald-500/10' : 'text-gray-600 bg-gray-600/10'}`}>
                          {o.is_on_duty ? '● ปฏิบัติ' : '○ ว่าง'}
                        </span>
                      </td>

                      <td className="px-3 py-3">
                        <div className="flex items-center gap-1 justify-end">
                          <ActionBtn icon={<History size={13} />} label="ประวัติ" color="green" onClick={() => setHistoryOfficer(o)} />
                          <ActionBtn icon={<Edit2 size={13} />} label="แก้ไข" color="blue" onClick={() => openEdit(o)} />
                          <ActionBtn icon={<Key size={13} />} label="รีเซ็ต PW" color="amber" onClick={() => setConfirmAction({ type: 'reset', target: o })} />
                          {o.status === 'active'
                            ? <ActionBtn icon={<ShieldOff size={13} />} label="ระงับ" color="red" onClick={() => setConfirmAction({ type: 'suspend', target: o })} />
                            : <ActionBtn icon={<Shield size={13} />} label="เปิด" color="green" onClick={() => setConfirmAction({ type: 'activate', target: o })} />
                          }
                          {o.id !== currentOfficer?.id && (
                            <ActionBtn icon={<Trash2 size={13} />} label="ลบ" color="darkred" onClick={() => setConfirmAction({ type: 'delete', target: o })} />
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        {hasActiveFilter && visibleRows.length > 0 && (
          <div className="px-4 py-2.5 border-t border-blue-900/40 text-[11px] text-gray-500">
            แสดง {visibleRows.length} จาก {officers.length} คน — การจัดลำดับจะไม่กระทบเจ้าหน้าที่ที่ถูกกรองออก
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      {showForm && (
        <Modal title={editItem ? 'แก้ไขข้อมูลเจ้าหน้าที่' : 'เพิ่มเจ้าหน้าที่ใหม่'} onClose={() => { setShowForm(false); setEditItem(null); setPhotoPreview(null); setPhotoFile(null); setFormAdminPw(''); }} size="md">
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Photo Upload */}
            <div className="flex flex-col items-center gap-3">
              <div className="relative w-24 h-24 rounded-xl overflow-hidden border-2 border-amber-500/30 bg-navy-700 flex items-center justify-center group">
                {photoPreview ? (
                  <img src={photoPreview} alt="preview" className="w-full h-full object-cover" />
                ) : (
                  <Upload size={24} className="text-gray-600" />
                )}
                {photoPreview && (
                  <button
                    type="button"
                    onClick={() => { setPhotoPreview(null); setPhotoFile(null); }}
                    className="absolute top-1 right-1 w-6 h-6 bg-red-600 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X size={14} className="text-white" />
                  </button>
                )}
              </div>
              <label className="cursor-pointer text-xs text-amber-400 hover:text-amber-300 font-medium">
                {photoPreview ? 'เปลี่ยนรูปภาพ' : 'อัปโหลดรูปถ่ายเจ้าหน้าที่'}
                <input type="file" accept="image/*" className="hidden" onChange={handlePhotoSelect} />
              </label>
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">รหัสเจ้าหน้าที่</label>
              <input
                className="input-field font-mono"
                placeholder="เช่น CDT-01"
                value={form.officer_code}
                onChange={(e) => setForm({ ...form, officer_code: e.target.value })}
              />
              <p className="text-[11px] text-gray-500 mt-1">
                ใช้ตัวอักษรภาษาอังกฤษคั่นด้วยขีดและตัวเลข เช่น CDT-01 (เว้นว่างได้)
              </p>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">ชื่อ-นามสกุล *</label>
              <input required className="input-field" placeholder="ชื่อเจ้าหน้าที่" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Username *</label>
              <input
                required
                className="input-field font-mono"
                placeholder="username"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
              />
              {editItem && form.username && (
                <p className="text-[11px] text-gray-500 mt-1">
                  ข้อมูลนี้เก็บแยกจากข้อมูลเจ้าหน้าที่ ต้องยืนยันรหัสผ่านของคุณก่อนบันทึก
                </p>
              )}
            </div>
            <div>
              <label className="block text-xs text-amber-400 mb-1">
                ยืนยันรหัสผ่านของคุณ (หัวหน้ากรม) *
              </label>
              <input
                required
                type="password"
                className="input-field"
                placeholder="ใส่รหัสผ่านของคุณเอง"
                value={formAdminPw}
                onChange={(e) => setFormAdminPw(e.target.value)}
                autoComplete="current-password"
              />
              <p className="text-[11px] text-gray-500 mt-1">
                ต้องยืนยันตัวตนก่อนจึงจะสร้างหรือเปลี่ยนข้อมูลเข้าระบบของเจ้าหน้าที่ได้
              </p>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">{editItem ? 'รหัสผ่านใหม่ (เว้นว่างถ้าไม่เปลี่ยน)' : 'รหัสผ่าน *'}</label>
              <input
                type="password"
                required={!editItem}
                className="input-field"
                placeholder="รหัสผ่าน"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">ตำแหน่ง</label>
              <select className="input-field" value={form.rank} onChange={(e) => setForm({ ...form, rank: e.target.value as OfficerRank })}>
                {ranks.length > 0 ? (
                  ranks.map((r) => <option key={r.id} value={r.rank_key ?? r.label}>{r.label}</option>)
                ) : (
                  (Object.entries(RANK_LABELS) as [string, string][]).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))
                )}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">แผนก</label>
              <select className="input-field" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value as Department })}>
                {DEPARTMENTS.map((d) => <option key={d} value={d}>{DEPARTMENT_LABELS[d]}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">รุ่น (Generation)</label>
                <select className="input-field" value={form.generation} onChange={(e) => setForm({ ...form, generation: e.target.value })}>
                  <option value="">{GENERATION_UNSET_LABEL}</option>
                  {generations.map((g) => {
                    const key = (g.generation_key ?? g.label ?? '').trim();
                    if (!key) return null;
                    return (
                      <option key={g.id} value={key}>
                        {g.label}{g.is_trainee ? ' (ทดลองงาน)' : ''}
                      </option>
                    );
                  })}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">ลำดับการแสดงผล</label>
                <input
                  type="number"
                  className="input-field font-mono"
                  value={form.sort_order}
                  onChange={(e) => setForm({ ...form, sort_order: parseInt(e.target.value) || 0 })}
                />
                <p className="text-[10px] text-gray-500 mt-1">ยิ่งน้อยยิ่งขึ้นก่อน (ใช้ในหน้าทำเนียบบุคลากร)</p>
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">อัตราค่าขึ้นเวร (Duty Rate / BC ต่อชั่วโมง)</label>
              <input
                type="number"
                min={0}
                step="10"
                className="input-field font-mono"
                placeholder="เช่น 500"
                value={form.duty_rate}
                onChange={(e) => setForm({ ...form, duty_rate: parseFloat(e.target.value) || 0 })}
              />
              {/* Quick rate preset chips */}
              <div className="flex flex-wrap gap-1 mt-1.5">
                {[100, 200, 300, 400, 500, 800, 1000].map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setForm({ ...form, duty_rate: p })}
                    className={`px-2 py-0.5 rounded text-[11px] font-mono border transition-all ${
                      form.duty_rate === p
                        ? 'bg-amber-500 text-black border-amber-400 font-bold'
                        : 'bg-navy-800 text-gray-400 border-blue-900/60 hover:text-white hover:border-amber-500/40'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-gray-500 mt-1">ระบบจะนำไปคูณกับจำนวนชั่วโมงที่เข้าเวรจริง (Clock-in ถึง Clock-out) ในการตัดยอดเงินเดือนรายเดือน</p>
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={() => { setShowForm(false); setEditItem(null); setPhotoPreview(null); setPhotoFile(null); setFormAdminPw(''); }} className="btn-secondary flex-1">ยกเลิก</button>
              <button type="submit" disabled={uploadingPhoto} className="btn-primary flex-1 disabled:opacity-50">
                {uploadingPhoto ? 'กำลังอัปโหลด...' : editItem ? 'บันทึก' : 'เพิ่มเจ้าหน้าที่'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Add Officer Wizard */}
      {wizardOpen && (
        <Modal
          title={`เพิ่มเจ้าหน้าที่ด้วย Wizard (ขั้น ${wizardStep}/3)`}
          onClose={() => setWizardOpen(false)}
          size="lg"
        >
          {/* Stepper */}
          <div className="flex items-center gap-2 mb-6">
            {[1, 2, 3].map((n) => (
              <div key={n} className="flex-1 flex items-center gap-2">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold ${wizardStep >= n ? 'bg-amber-500 text-navy-900' : 'bg-navy-700 text-gray-500'}`}>
                  {n}
                </div>
                {n < 3 && <div className={`flex-1 h-0.5 ${wizardStep > n ? 'bg-amber-500' : 'bg-navy-700'}`} />}
              </div>
            ))}
          </div>

          {/* Step 1 — เลือก template */}
          {wizardStep === 1 && (
            <div className="space-y-4">
              <p className="text-sm text-gray-400">เลือกเจ้าหน้าที่ template (ไม่บังคับ) — ระบบจะ auto-fill ตำแหน่ง, แผนก, ค่าขึ้นเวร, หมวดบริการ</p>
              <select
                className="input-field"
                value={wizardTemplate?.id ?? ''}
                onChange={(e) => {
                  const t = officers.find((o) => o.id === e.target.value);
                  if (t) applyTemplate(t);
                  else { setWizardTemplate(null); }
                }}
              >
                <option value="">— ข้าม (ใช้ค่า default) —</option>
                {officers.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name} — {DEPARTMENT_LABELS[o.department]}
                  </option>
                ))}
              </select>
              {wizardTemplate && (
                <div className="card p-3 text-xs text-gray-400 space-y-1">
                  <div>ตำแหน่ง: <span className="text-white">{wizardTemplate.rank}</span></div>
                  <div>แผนก: <span className="text-white">{DEPARTMENT_LABELS[wizardTemplate.department]}</span></div>
                  <div>รุ่น: <span className="text-white">{personnelIndex.genLabel(wizardTemplate.generation)}</span></div>
                  <div>ค่าขึ้นเวร: <span className="text-white">{wizardTemplate.duty_rate ?? 0} BC/ชม.</span></div>
                  <div>หมวดบริการ: <span className="text-white">{wizardTemplate.service_category || '—'}</span></div>
                </div>
              )}
            </div>
          )}

          {/* Step 2 — ข้อมูลส่วนตัว */}
          {wizardStep === 2 && (
            <div className="space-y-4">
              <div className="flex flex-col items-center gap-3">
                <div className="relative w-24 h-24 rounded-xl overflow-hidden border-2 border-amber-500/30 bg-navy-700 flex items-center justify-center">
                  {wizardPhotoPreview ? (
                    <img src={wizardPhotoPreview} alt="preview" className="w-full h-full object-cover" />
                  ) : (
                    <Upload size={24} className="text-gray-600" />
                  )}
                </div>
                <label className="cursor-pointer text-xs text-amber-400 hover:text-amber-300 font-medium">
                  {wizardPhotoPreview ? 'เปลี่ยนรูปภาพ' : 'อัปโหลดรูปถ่าย'}
                  <input type="file" accept="image/*" className="hidden" onChange={handleWizardPhotoSelect} />
                </label>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">ชื่อ-นามสกุล *</label>
                <input required className="input-field" value={wizardForm.name} onChange={(e) => setWizardForm({ ...wizardForm, name: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Username *</label>
                <input required className="input-field font-mono" value={wizardForm.username} onChange={(e) => setWizardForm({ ...wizardForm, username: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">รหัสเจ้าหน้าที่</label>
                <input
                  className="input-field font-mono"
                  placeholder="เช่น CDT-01"
                  value={wizardForm.officer_code}
                  onChange={(e) => setWizardForm({ ...wizardForm, officer_code: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">รหัสผ่าน *</label>
                <input required type="password" className="input-field" value={wizardForm.password} onChange={(e) => setWizardForm({ ...wizardForm, password: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs text-amber-400 mb-1">ยืนยันรหัสผ่านของคุณ (หัวหน้ากรม) *</label>
                <input
                  required
                  type="password"
                  className="input-field"
                  value={wizardAdminPw}
                  onChange={(e) => setWizardAdminPw(e.target.value)}
                  autoComplete="current-password"
                />
                <p className="text-[11px] text-gray-500 mt-1">
                  ต้องยืนยันตัวตนก่อนจึงจะสร้างบัญชีให้เจ้าหน้าที่คนอื่นได้
                </p>
              </div>
            </div>
          )}

          {/* Step 3 — ตรวจสอบ + แก้ไข */}
          {wizardStep === 3 && (
            <div className="space-y-3">
              <p className="text-xs text-gray-400">ตรวจสอบข้อมูล — สามารถแก้ไขได้ก่อนบันทึก</p>
              <div>
                <label className="block text-xs text-gray-400 mb-1">ชื่อ</label>
                <input className="input-field" value={wizardForm.name} onChange={(e) => setWizardForm({ ...wizardForm, name: e.target.value })} />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Username</label>
                <input className="input-field font-mono" value={wizardForm.username} onChange={(e) => setWizardForm({ ...wizardForm, username: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">ตำแหน่ง</label>
                  <select className="input-field" value={wizardForm.rank} onChange={(e) => setWizardForm({ ...wizardForm, rank: e.target.value as OfficerRank })}>
                    {ranks.length > 0
                      ? ranks.map((r) => <option key={r.id} value={r.rank_key ?? r.label}>{r.label}</option>)
                      : (Object.entries(RANK_LABELS) as [string, string][]).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">แผนก</label>
                  <select className="input-field" value={wizardForm.department} onChange={(e) => setWizardForm({ ...wizardForm, department: e.target.value as Department })}>
                    {DEPARTMENTS.map((d) => <option key={d} value={d}>{DEPARTMENT_LABELS[d]}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">ค่าขึ้นเวร (BC/ชม.)</label>
                  <input type="number" min={0} step="0.01" className="input-field" value={wizardForm.duty_rate} onChange={(e) => setWizardForm({ ...wizardForm, duty_rate: parseFloat(e.target.value) || 0 })} />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">หมวดบริการ</label>
                  <select className="input-field" value={wizardForm.service_category} onChange={(e) => setWizardForm({ ...wizardForm, service_category: e.target.value })}>
                    <option value="">— ไม่ระบุ —</option>
                    {SERVICE_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">รุ่น (Generation)</label>
                <select className="input-field" value={wizardForm.generation} onChange={(e) => setWizardForm({ ...wizardForm, generation: e.target.value })}>
                  <option value="">{GENERATION_UNSET_LABEL}</option>
                  {generations.map((g) => {
                    const key = (g.generation_key ?? g.label ?? '').trim();
                    if (!key) return null;
                    return (
                      <option key={g.id} value={key}>
                        {g.label}{g.is_trainee ? ' (ทดลองงาน)' : ''}
                      </option>
                    );
                  })}
                </select>
                <p className="text-[10px] text-gray-500 mt-1">
                  เลือกรุ่นเพื่อจัดกลุ่ม/ค้นหาได้ง่ายขึ้นในหน้าทำเนียบบุคลากร
                </p>
              </div>
              <div className="card p-3 text-xs text-amber-300 bg-amber-500/10 border-amber-500/30">
                90% ของค่าบริการที่เจ้าหน้าที่คนนี้บันทึก จะเข้าแผนก <strong>{DEPARTMENT_LABELS[wizardForm.department]}</strong>
              </div>
              {wizardError && <div className="text-xs text-red-400">{wizardError}</div>}
            </div>
          )}

          {/* Navigation */}
          <div className="flex gap-3 pt-4 mt-4 border-t border-blue-900/40">
            <button type="button" onClick={() => setWizardOpen(false)} className="btn-secondary">ยกเลิก</button>
            <div className="flex-1" />
            {wizardStep > 1 && (
              <button type="button" onClick={() => setWizardStep((s) => (s - 1) as 1 | 2 | 3)} className="btn-secondary">ย้อนกลับ</button>
            )}
            {wizardStep < 3 && (
              <button
                type="button"
                onClick={() => setWizardStep((s) => (s + 1) as 1 | 2 | 3)}
                className="btn-primary"
                disabled={wizardStep === 2 && (!wizardForm.name || !wizardForm.username || !wizardForm.password)}
              >
                ถัดไป
              </button>
            )}
            {wizardStep === 3 && (
              <button type="button" onClick={submitWizard} disabled={wizardUploading} className="btn-primary disabled:opacity-50">
                {wizardUploading ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
            )}
          </div>
        </Modal>
      )}

      {/* Confirm Action Dialog */}
      {confirmAction && (
        <ConfirmDialog
          title={`${confirmMessages[confirmAction.type].title} — ${confirmAction.target.name}`}
          message={confirmMessages[confirmAction.type].msg}
          confirmLabel={confirmMessages[confirmAction.type].label}
          danger={confirmAction.type === 'delete' || confirmAction.type === 'suspend'}
          onConfirm={executeAction}
          onCancel={() => { setConfirmAction(null); setResetPw(''); setAdminVerifyPw(''); }}
          extraField={
            confirmAction.type === 'reset'
              ? { label: 'รหัสผ่านใหม่', value: resetPw, onChange: setResetPw, placeholder: 'กรอกรหัสผ่านใหม่...' }
              : undefined
          }
          verifyField={
            confirmAction.type === 'reset'
              ? {
                  label: 'ยืนยันรหัสผ่านของคุณ (หัวหน้ากรม)',
                  value: adminVerifyPw,
                  onChange: setAdminVerifyPw,
                  placeholder: 'ใส่รหัสผ่านของคุณเอง',
                  hint: 'ต้องยืนยันตัวตนก่อนจึงจะตั้งรหัสผ่านของเจ้าหน้าที่คนอื่นได้',
                }
              : undefined
          }
        />
      )}

      {/* Officer History Modal */}
      <OfficerHistoryModal officer={historyOfficer} onClose={() => setHistoryOfficer(null)} />

      {/* Batch Duty Rate Modal (กำหนดเรทขึ้นเวรทุกคน) */}
      {showBatchDutyModal && (
        <BatchDutyRateModal
          onClose={() => setShowBatchDutyModal(false)}
          onSaved={async () => {
            setShowBatchDutyModal(false);
            await fetchAll();
          }}
        />
      )}
    </div>
  );
}

/* =========================================================================
 * Subcomponent: BatchDutyRateModal (ตั้งเรทขึ้นเวรทุกคนพร้อมกัน)
 * ========================================================================= */
function BatchDutyRateModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [rateInput, setRateInput] = useState<string>('500');
  const [saving, setSaving] = useState(false);

  const presets = [100, 200, 300, 400, 500, 800, 1000];

  async function handleSave() {
    const num = parseFloat(rateInput);
    if (isNaN(num) || num < 0) {
      alert('กรุณาระบุอัตราค่าขึ้นเวรที่ถูกต้อง (ต้อง >= 0)');
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from('officers')
        .update({ duty_rate: num, updated_at: new Date().toISOString() })
        .neq('status', 'deleted');
      if (error) throw error;
      alert(`ตั้งค่าขึ้นเวรให้เจ้าหน้าที่ทุกคนเป็น ${num.toLocaleString('th-TH')} BC/ชม. เรียบร้อยแล้ว`);
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
          ตั้งค่าเรทค่าขึ้นเวร (BC ต่อชั่วโมง) ให้เจ้าหน้าที่ทุกคนในระบบพร้อมกัน โดยระบบจะนำไปคูณกับชั่วโมงทำงานจริงในแต่ละเดือน
        </p>

        <div>
          <label className="block text-xs text-gray-400 mb-1.5">เลือกเรทด่วน:</label>
          <div className="flex flex-wrap gap-1.5">
            {presets.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setRateInput(p.toString())}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold font-mono border transition-all ${
                  rateInput === p.toString()
                    ? 'bg-amber-500 text-black border-amber-400 font-bold'
                    : 'bg-navy-800 text-gray-300 border-blue-900/60 hover:border-amber-500/40'
                }`}
              >
                {p.toLocaleString('th-TH')} BC/ชม.
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">หรือระบุตัวเลขเอง (BC ต่อชั่วโมง):</label>
          <input
            type="number"
            min={0}
            step="10"
            className="input-field font-mono text-lg font-bold text-amber-400"
            value={rateInput}
            onChange={(e) => setRateInput(e.target.value)}
            placeholder="เช่น 500"
          />
        </div>

        <div className="flex gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">ยกเลิก</button>
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

function ActionBtn({ icon, label, color, onClick }: { icon: ReactNode; label: string; color: string; onClick: () => void }) {
  const colors: Record<string, string> = {
    blue: 'text-blue-400 hover:bg-blue-500/10',
    amber: 'text-amber-400 hover:bg-amber-500/10',
    red: 'text-orange-400 hover:bg-orange-500/10',
    green: 'text-emerald-400 hover:bg-emerald-500/10',
    darkred: 'text-red-400 hover:bg-red-500/10',
  };
  return (
    <button
      title={label}
      onClick={onClick}
      className={`p-1.5 rounded transition-colors text-gray-500 ${colors[color]}`}
    >
      {icon}
    </button>
  );
}
