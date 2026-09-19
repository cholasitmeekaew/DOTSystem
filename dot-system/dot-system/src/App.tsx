import { useState, lazy, Suspense } from 'react';
import { AuthProvider, useAuth } from './lib/AuthContext';
import { QueryProvider } from './hooks/useQueryProvider';
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
const PointsManagementPage = lazy(() => import('./pages/officer/PointsManagementPage').then((m) => ({ default: m.PointsManagementPage })));
const DepartmentBalancePage = lazy(() => import('./pages/officer/DepartmentBalancePage').then((m) => ({ default: m.DepartmentBalancePage })));

// Access Denied
import { ShieldOff } from 'lucide-react';

function PageFallback() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="w-8 h-8 border-2 border-amber-500/30 border-t-amber-500 rounded-full animate-spin" />
    </div>
  );
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
  const { officer, logout, isCommissioner } = useAuth();
  const [currentPage, setCurrentPage] = useState<OfficerPage>('dashboard');

  if (!officer) return null;

  const commissionerOnlyPages: OfficerPage[] = ['announcements', 'service-rates', 'officer-management', 'citizen-management', 'complaints'];
  const isDenied = commissionerOnlyPages.includes(currentPage) && !isCommissioner;

  function handleNavigate(page: OfficerPage) {
    if (commissionerOnlyPages.includes(page) && !isCommissioner) {
      setCurrentPage('dashboard');
      return;
    }
    setCurrentPage(page);
  }

  return (
    <OfficerLayout currentPage={currentPage} onNavigate={handleNavigate} onLogout={logout}>
      <Suspense fallback={<PageFallback />}>
        {isDenied ? (
          <AccessDenied onBack={() => setCurrentPage('dashboard')} />
        ) : (
          <>
            {currentPage === 'dashboard' && <DashboardPage />}
            {currentPage === 'operations' && <OperationsPage />}
            {currentPage === 'service-fees' && <ServiceFeesPage />}
            {currentPage === 'complaints' && isCommissioner && <ComplaintsManagementPage />}
            {currentPage === 'announcements' && isCommissioner && <AnnouncementsPage />}
            {currentPage === 'service-rates' && isCommissioner && <ServiceRatesPage />}
            {currentPage === 'officer-management' && isCommissioner && <OfficerManagementPage />}
            {currentPage === 'citizen-management' && isCommissioner && <CitizenManagementPage />}
            {currentPage === 'emergency' && <EmergencyManagementPage />}
            {currentPage === 'vehicles' && <VehicleManagementPage />}
            {currentPage === 'leave' && <LeaveManagementPage />}
            {currentPage === 'manual' && <ManualPage onBack={() => setCurrentPage('dashboard')} />}
            {currentPage === 'my-points' && <MyPointsPage />}
            {currentPage === 'points-management' && isCommissioner && <PointsManagementPage />}
            {currentPage === 'department-balance' && isCommissioner && <DepartmentBalancePage />}
          </>
        )}
      </Suspense>
    </OfficerLayout>
  );
}

function PublicApp() {
  const { setAuth } = useAuth();
  const [route, setRoute] = useState<PublicPage>('home');

  function handleLogin(officer: Officer) {
    setAuth(officer);
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
        <AppRouter />
      </AuthProvider>
    </QueryProvider>
  );
}
