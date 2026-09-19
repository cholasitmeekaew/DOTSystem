/**
 * useRole — helper สำหรับเช็ค role + แสดงเมนู/ปุ่มตามสิทธิ์
 */
import { useAuth } from './useAuth';
import type { OfficerRank } from '../lib/types';

export function useRole() {
  const { officer, isCommissioner, isInspector } = useAuth();

  return {
    officer,
    rank: officer?.rank as OfficerRank | undefined,
    isCommissioner,
    isInspector,
    isOfficer: officer?.rank === 'officer',
    has: (roles: OfficerRank | OfficerRank[]) => {
      if (!officer) return false;
      const list = Array.isArray(roles) ? roles : [roles];
      return list.includes(officer.rank as OfficerRank);
    },
  };
}
