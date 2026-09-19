/**
 * API Layer — barrel export
 *
 * ใช้ import จากที่นี่ที่เดียวเพื่อความสะอาด:
 *   import { useOfficers, useClockIn, useServiceRecords } from '@/lib/api';
 */
export * from './officers';
export * from './dutyLogs';
export * from './serviceRecords';
export * from './serviceRates';
export * from './vehicles';
export * from './citizens';
export * from './licenses';
export * from './announcements';
export * from './complaints';
export * from './emergencyReports';
export * from './officerLeaves';
export * from './systemSettings';
export * from './auditLogs';
export * from './auth';
