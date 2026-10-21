import { ClaimSharePage } from './pages/officer/ClaimSharePage';
import { ErrorBoundary } from './components/error-boundary';
import { useState, useEffect, lazy, Suspense } from 'react';
import { AuthProvider, useAuth } from './lib/AuthContext';
import { QueryProvider } from './hooks/useQueryProvider';
import { Toaster } from './components/ui/toaster';
import { Officer } from './lib/types';

// Public
import { PublicLayout, PublicPage } from './components/PublicLayout';
const HomePage = lazy(() => import('./pages/public/HomePage').then((m) => ({ default: m.HomePage })));
const CitizenPage = lazy(() => import('./pages/public/CitizenPage').then((m) => ({ default: m.CitizenPage })));
const PersonnelPage = lazy(() => import('./pages/public/PersonnelPage').then((m) => ({ default: m.PersonnelPage })));
const StatsPage = lazy(() => import('./pages/public/StatsPage').then((m) => ({ default: m.StatsPage })));
const ServiceRatesPublicPage = lazy(() => import('./pages/public/ServiceRatesPublicPage').then((m) => ({ default: m.ServiceRatesPublicPage })));
const ComplaintPage = lazy(() => import('./pages/public/ComplaintPage').then((m) => ({ default: m.ComplaintPage })));
const EmergencyReportPage = lazy(() => import('./pages/public/EmergencyReportPage').then((m) => ({ default: m.EmergencyReportPage })));
const LeaderboardPage = lazy(() => import('./pages/public/LeaderboardPage').then((m) => ({ default: m.LeaderboardPage })));
const TermsPage = lazy(() => import('./pages/public/TermsPage').then((m) => ({ default: m.TermsPage })));

// Officer
import { OfficerLayout, OfficerPage } from './components/OfficerLayout';
const LoginPage = lazy(() => import('./pages/officer/LoginPage').then((m) => ({ default: m.LoginPage })));
const DashboardPage = lazy(() => import('./pages/officer/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const OperationsPage = lazy(() => import('./pages/officer/OperationsPage').then((m) => ({ default: m.OperationsPage })));
const ServiceFeesPage = lazy(() => import('./pages/officer/ServiceFeesPage').then((m) => ({ default: m.ServiceFeesPage })));
const AnnouncementsPage = lazy(() => import('./pages/officer/AnnouncementsPage').then((m) => ({ default: m.AnnouncementsPage })));
const ServiceRatesPage = lazy(() => import('./pages/officer/ServiceRatesPage').then((m) => ({ default: m.ServiceRatesPage })));
const OfficerManagementPage = lazy(() => import('./pages/officer/OfficerManagementPage').then((m) => ({ default: m.OfficerManagementPage })));
const CitizenManagementPage = lazy(() => import('./pages/officer/CitizenManagementPage').then((m) => ({ default: m.CitizenManagementPage })));
const ComplaintsManagementPage = lazy(() => import('./pages/officer/ComplaintsManagementPage').then((m) => ({ default: m.ComplaintsManagementPage })));
const EmergencyManagementPage = lazy(() => import('./pages/officer/EmergencyManagementPage').then((m) => ({ default: m.EmergencyManagementPage })));
const VehicleManagementPage = lazy(() => import('./pages/officer/VehicleManagementPage').then((m) => ({ default: m.VehicleManagementPage })));
const LeaveManagementPage = lazy(() => import('./pages/officer/LeaveManagementPage').then((m) => ({ default: m.LeaveManagementPage })));
const ManualPage = lazy(() => import('./pages/public/ManualPage').then((m) => ({ default: m.ManualPage })));
const MyPointsPage = lazy(() => import('./pages/officer/MyPointsPage').then((m) => ({ default: m.MyPointsPage })));
const ProfilePage = lazy(() => import('./pages/officer/ProfilePage').then((m) => ({ default: m.ProfilePage })));
const AdminMenuPage = lazy(() => import('./pages/officer/AdminMenuPage').then((m) => ({ default: m.AdminMenuPage })));
const WorkReportsAdminPage = lazy(() => import('./pages/officer/WorkReportsAdminPage').then((m) => ({ default: m.WorkReportsAdminPage })));
const DutyLogsAdminPage = lazy(() => import('./pages/officer/DutyLogsAdminPage').then((m) => ({ default: m.DutyLogsAdminPage })));
const AdminSettingsPage = lazy(() => import('./pages/officer/AdminSettingsPage').then((m) => ({ default: m.AdminSettingsPage })));
const PointsManagementPage = lazy(() => import('./pages/officer/PointsManagementPage').then((m) => ({ default: m.PointsManagementPage })));
const DepartmentBalancePage = lazy(() => import('./pages/officer/DepartmentBalancePage').then((m) => ({ default: m.DepartmentBalancePage })));
const CaseOfficersPage = lazy(() => import('./pages/officer/CaseOfficersPage').then((m) => ({ default: m.CaseOfficersPage })));

// Access Denied
import { ShieldOff } from 'lucide-react';
import { MaintenanceScreen } from './components/MaintenanceScreen';
import { supabase } from './lib/supabase';
import { COMMISSIONER_RANK } from './lib/types';

function PageFallback() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="w-8 h-8 border-2 border-amber-500/30 border-t-amber-500 rounded-full animate-spin" />
    </div>
  );
}

/**
 * ตรวจ system_settings.maintenance_mode + realtime
 *
 * ถ้าเปิด true → เจ้าหน้าที่ที่ไม่ใช่หัวหน้ากรมถูกบล็อกทุกหน้า
 * หัวหน้ากรม (commissioner) ยังเข้าได้ เพื่อปิดโหมดจาก Admin Settings
 */
type MaintMode = 'off' | 'standard' | 'readonly' | 'emergency';

function useMaintenanceMode() {
  const [mode, setMode] = useState<MaintMode>('off');
  const [title, setTitle] = useState<string | null>(null);
  const [subtitle, setSubtitle] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [eta, setEta] = useState<string | null>(null);
  const [etaLabel, setEtaLabel] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    /** boolean เก่า / string ใหม่ → normalize เป็น MaintMode */
    function norm(raw: unknown): MaintMode {
      if (raw === true) return 'standard';
      if (raw === false || raw == null) return 'off';
      const s = String(raw);
      return (['off', 'standard', 'readonly', 'emergency'] as const).includes(s as MaintMode)
        ? (s as MaintMode) : 'off';
    }

    void (async () => {
      const { data } = await supabase
        .from('system_settings').select('maintenance_mode, maintenance_title, maintenance_subtitle, maintenance_message, maintenance_eta, maintenance_eta_label')
        .eq('id', 1).maybeSingle();
      if (!cancelled && data) {
        const d = data as Record<string, unknown>;
        setMode(norm(d.maintenance_mode));
        setTitle(d.maintenance_title as string | null);
        setSubtitle(d.maintenance_subtitle as string | null);
        setMessage(d.maintenance_message as string | null);
        setEta(d.maintenance_eta as string | null);
        setEtaLabel(d.maintenance_eta_label as string | null);
      }
    })();

    const ch = supabase
      .channel('maintenance-watch')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'system_settings', filter: 'id=eq.1' },
        (payload: { new: Record<string, unknown> }) => {
          const d = payload.new;
          setMode(norm(d.maintenance_mode));
          setTitle(d.maintenance_title as string | null);
          setSubtitle(d.maintenance_subtitle as string | null);
          setMessage(d.maintenance_message as string | null);
          setEta(d.maintenance_eta as string | null);
          setEtaLabel(d.maintenance_eta_label as string | null);
        },
      )
      .subscribe();

    return () => { cancelled = true; void supabase.removeChannel(ch); };
  }, []);

  return { mode, title, subtitle, message, eta, etaLabel };
}

function AccessDenied({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-6">
      <div className="w-16 h-16 bg-red-500/10 border border-red-500/30 rounded-2xl flex items-center justify-center mb-4">
        <ShieldOff size={28} className="text-red-400" />
      </div>
      <h2 className="text-xl font-bold text-white mb-2">ไม่มีสิทธิ์เข้าถึง</h2>
      <p className="text-gray-400 text-sm mb-6 max-w-xs">
        เมนูนี้สงวนสิทธิ์สำหรับหัวหน้ากรมขนส่ง (Commissioner) เท่านั้น
      </p>
      <button onClick={onBack} className="btn-secondary">กลับ Dashboard</button>
    </div>
  );
}

function OfficerApp() {
  const { officer, logout, setAuth, isCommissioner } = useAuth();
  const [currentPage, setCurrentPage] = useState<OfficerPage>('dashboard');
  /** แท็บที่จะเปิดเมื่อเข้าหน้าปฏิบัติการ — ใช้ตอนกดการ์ดทางลัดที่ระบุแท็บ */
  const [opsTab, setOpsTab] = useState<'duty' | 'roster' | 'approvals'>('duty');
  const { mode: maintMode, title: maintTitle, subtitle: maintSub, message: maintMsg, eta: maintEta, etaLabel: maintEtaLabel } = useMaintenanceMode();

  if (!officer) return null;

  // ── Maintenance: block ทุกคนยกเว้นหัวหน้ากรม ──
  if ((maintMode === 'standard' || maintMode === 'emergency')
    && officer.rank !== COMMISSIONER_RANK) {
    return (
      <MaintenanceScreen
        mode={maintMode}
        title={maintTitle}
        subtitle={maintSub}
        message={maintMsg}
        eta={maintEta}
        etaLabel={maintEtaLabel}
        officerName={officer.name}
        onLogout={() => logout()}
        onBypass={(o) => setAuth(o)}
      />
    );
  }

  // ต้องครอบคลุมทุกหน้าใน ADMIN_MENU_ITEMS + หน้า hub เอง
  // (เดิมพลาดไป 4 หน้า: points-management, department-balance, emergency, vehicles)
  const commissionerOnlyPages: OfficerPage[] = [
    'admin-menu',
    'officer-management', 'citizen-management',
    'points-management', 'department-balance', 'service-rates', 'case-officers',
    'complaints', 'announcements', 'vehicles',
    'admin-settings', 'report-approvals', 'leave-approvals', 'roster-admin',
    'manual-edit', 'duty-logs-admin', 'work-reports-admin',
  ];
  const isDenied = commissionerOnlyPages.includes(currentPage) && !isCommissioner;

  function handleNavigate(page: OfficerPage) {
    if (commissionerOnlyPages.includes(page) && !isCommissioner) {
      setCurrentPage('dashboard');
      return;
    }
    setCurrentPage(page);
    // แท็บถูกเลือกไว้เฉพาะตอนกดการ์ดทางลัด — ครั้งถัดไปกลับมาเริ่มที่แท็บแรก
    if (page !== 'operations') setOpsTab('duty');
  }

  /** เปิดหน้าปฏิบัติการที่แท็บที่ระบุ (ใช้จากการ์ดทางลัด) */
  function navigateToOpsTab(tab: 'duty' | 'roster' | 'approvals') {
    setOpsTab(tab);
    setCurrentPage('operations');
  }

  return (
    <OfficerLayout currentPage={currentPage} onNavigate={handleNavigate} onLogout={logout}>
      {/*
       * ErrorBoundary ครอบทุกหน้า
       *
       * ไฟล์นี้มีอยู่ตั้งแต่แรกแต่ไม่เคยถูกใช้ที่ไหน
       * พอ React พังในหน้าใดหน้าหนึ่ง ผู้ใช้เห็นแค่หน้าจอว่าง
       * ไม่มีข้อความบอกว่าเกิดอะไร — หาสาเหตุยากมาก
       *
       * resetKey={currentPage} = เปลี่ยนหน้าแล้วเริ่มใหม่อัตโนมัติ
       */}
      {/* ── Read-Only banner: แสดงบนสุดเมื่อเปิด readonly mode ── */}
      {maintMode === 'readonly' && officer.rank !== COMMISSIONER_RANK && (
        <div className="bg-yellow-500/15 border-b border-yellow-500/40 px-4 py-2 text-center text-xs font-semibold text-yellow-300">
          🟡 โหมด Read-Only — ดูข้อมูลได้อย่างเดียว ไม่สามารถทำรายการได้
        </div>
      )}

      <ErrorBoundary resetKey={currentPage}>
        <Suspense fallback={<PageFallback />}>
          {isDenied ? (
          <AccessDenied onBack={() => setCurrentPage('dashboard')} />
        ) : (
          <>
            {currentPage === 'dashboard' && <DashboardPage />}
            {currentPage === 'admin-settings' && <AdminSettingsPage />}
            {currentPage === 'leave-approvals' && (
              <LeaveManagementPage approvalsOnly />
            )}
            {currentPage === 'report-approvals' && (
              <OperationsPage initialTab="approvals" approvalsOnly adminTools />
            )}
            {currentPage === 'manual-edit' && <ManualPage adminEdit />}
            {currentPage === 'duty-logs-admin' && <DutyLogsAdminPage />}
            {currentPage === 'work-reports-admin' && <WorkReportsAdminPage />}
            {currentPage === 'roster-admin' && (
              <OperationsPage initialTab="roster" adminTools />
            )}
            {currentPage === 'admin-menu' && (
              <AdminMenuPage onNavigate={handleNavigate} />
            )}
            {currentPage === 'profile' && (
              <ProfilePage onNavigate={handleNavigate} onOpenOpsTab={navigateToOpsTab} />
            )}
            {currentPage === 'operations' && (
              <OperationsPage key={opsTab} initialTab={opsTab} />
            )}
            {currentPage === 'service-fees' && <ServiceFeesPage />}
            {currentPage === 'claim-share' && <ClaimSharePage />}
            {currentPage === 'complaints' && isCommissioner && <ComplaintsManagementPage />}
            {currentPage === 'announcements' && isCommissioner && <AnnouncementsPage />}
            {currentPage === 'service-rates' && isCommissioner && <ServiceRatesPage />}
            {currentPage === 'officer-management' && isCommissioner && <OfficerManagementPage />}
            {currentPage === 'citizen-management' && isCommissioner && <CitizenManagementPage />}
            {currentPage === 'emergency' && <EmergencyManagementPage />}
            {currentPage === 'vehicles' && isCommissioner && <VehicleManagementPage />}
            {currentPage === 'leave' && <LeaveManagementPage />}
            {currentPage === 'manual' && <ManualPage onBack={() => setCurrentPage('dashboard')} />}
            {currentPage === 'my-points' && <MyPointsPage />}
            {currentPage === 'points-management' && isCommissioner && <PointsManagementPage />}
            {currentPage === 'department-balance' && isCommissioner && <DepartmentBalancePage />}
            {currentPage === 'case-officers' && <CaseOfficersPage />}
          </>
        )}
        </Suspense>
      </ErrorBoundary>
    </OfficerLayout>
  );
}

function PublicApp() {
  const { setAuth } = useAuth();
  const [route, setRoute] = useState<PublicPage>('home');
  const { mode: maintMode, title: maintTitle, subtitle: maintSub, message: maintMsg, eta: maintEta, etaLabel: maintEtaLabel } = useMaintenanceMode();

  function handleLogin(officer: Officer) {
    setAuth(officer);
  }

  // ── standard / emergency: block หน้าสาธารณะ (ยกเว้น login) ──
  if ((maintMode === 'standard' || maintMode === 'emergency') && route !== 'login') {
    return (
      <MaintenanceScreen
        mode={maintMode}
        title={maintTitle}
        subtitle={maintSub}
        message={maintMsg}
        eta={maintEta}
        etaLabel={maintEtaLabel}
        onBypass={handleLogin}
      />
    );
  }

  if (route === 'login') {
    return (
      <Suspense fallback={<PageFallback />}>
        <LoginPage onLogin={handleLogin} onBack={() => setRoute('home')} />
      </Suspense>
    );
  }

  return (
    <PublicLayout currentPage={route} onNavigate={setRoute}>
      <Suspense fallback={<PageFallback />}>
        {route === 'home' && <HomePage onNavigate={setRoute} />}
        {route === 'citizen' && <CitizenPage />}
        {route === 'personnel' && <PersonnelPage />}
        {route === 'stats' && <StatsPage />}
        {route === 'rates' && <ServiceRatesPublicPage />}
        {route === 'complaint' && <ComplaintPage onBack={() => setRoute('home')} />}
        {route === 'emergency' && <EmergencyReportPage />}
        {route === 'leaderboard' && <LeaderboardPage />}
        {route === 'manual' && <ManualPage variant="citizen" />}
        {route === 'terms' && <TermsPage />}
      </Suspense>
    </PublicLayout>
  );
}

function AppRouter() {
  const { officer } = useAuth();
  return officer ? <OfficerApp /> : <PublicApp />;
}

export default function App() {
  return (
    <QueryProvider>
      <AuthProvider>
        {/* ต้อง mount ที่นี่เดียว ไม่งั้น toast() ทุกจุดในระบบจะไม่แสดงผล */}
        <Toaster />
        <AppRouter />
      </AuthProvider>
    </QueryProvider>
  );
}
