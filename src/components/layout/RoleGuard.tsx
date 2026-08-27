/**
 * RoleGuard — render children เฉพาะเมื่อ user มี role ที่อนุญาต
 *
 * @example
 *   <RoleGuard roles={['commissioner']}>
 *     <DangerousButton />
 *   </RoleGuard>
 */
import { ReactNode } from 'react';
import { useAuth } from '../../lib/AuthContext';
import type { OfficerRank } from '../../lib/types';

interface Props {
  children: ReactNode;
  roles: OfficerRank | OfficerRank[];
  fallback?: ReactNode;
}

export function RoleGuard({ children, roles, fallback = null }: Props) {
  const { officer } = useAuth();
  if (!officer) return <>{fallback}</>;
  const allowed = Array.isArray(roles) ? roles : [roles];
  if (!allowed.includes(officer.rank as OfficerRank)) return <>{fallback}</>;
  return <>{children}</>;
}
