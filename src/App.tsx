import { useState } from 'react';
import { AuthProvider, useAuth } from './lib/AuthContext';
import { QueryProvider } from './hooks/useQueryProvider';
import { Officer } from './lib/types';

// Public
import { PublicLayout, PublicPage } from './components/PublicLayout';
import { HomePage } from './pages/public/HomePage';
import { CitizenPage } from './pages/public/CitizenPage';
import { PersonnelPage } from './pages/public/PersonnelPage';
import { StatsPage } from './pages/public/StatsPage';
import { ServiceRatesPublicPage } from './pages/public/ServiceRatesPublicPage';
import { ComplaintPage } from './pages/public/ComplaintPage';
import { EmergencyReportPage } from './pages/public/EmergencyReportPage';

// Officer
import { LoginPage } from './pages/officer/LoginPage';
import { OfficerLayout, OfficerPage } from './components/OfficerLayout';
import { DashboardPage } from './pages/officer/DashboardPage';
import { OperationsPage } from './pages/officer/OperationsPage';
import { ServiceFeesPage } from './pages/officer/ServiceFeesPage';
import { AnnouncementsPage } from './pages/officer/AnnouncementsPage';
import { ServiceRatesPage } from './pages/officer/ServiceRatesPage';
import { OfficerManagementPage } from './pages/officer/OfficerManagementPage';
import { CitizenManagementPage } from './pages/officer/CitizenManagementPage';
import { ComplaintsManagementPage } from './pages/officer/ComplaintsManagementPage';
import { EmergencyManagementPage } from './pages/officer/EmergencyManagementPage';
import { VehicleManagementPage } from './pages/officer/VehicleManagementPage';
import { LeaveManagementPage } from './pages/officer/LeaveManagementPage';

// Access Denied
import { ShieldOff } from 'lucide-react';

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
        </>
      )}
    </OfficerLayout>
  );
}

function PublicApp() {
  const { setOfficer } = useAuth();
  const [route, setRoute] = useState<PublicPage>('home');

  function handleLogin(officer: Officer) {
    setOfficer(officer);
  }

  if (route === 'login') {
    return <LoginPage onLogin={handleLogin} onBack={() => setRoute('home')} />;
  }

  return (
    <PublicLayout currentPage={route} onNavigate={setRoute}>
      {route === 'home' && <HomePage onNavigate={setRoute} />}
      {route === 'citizen' && <CitizenPage />}
      {route === 'personnel' && <PersonnelPage />}
      {route === 'stats' && <StatsPage />}
      {route === 'rates' && <ServiceRatesPublicPage />}
      {route === 'complaint' && <ComplaintPage />}
      {route === 'emergency' && <EmergencyReportPage />}
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
