import { twMerge } from 'tailwind-merge';

import { clsx, type ClassValue } from 'clsx';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * แปลง Date เป็น string สำหรับ <input type="datetime-local"> โดยใช้เวลาท้องถิ่น
 * (ห้ามใช้ toISOString().slice(0,16) เพราะเป็นเวลา UTC — ที่ไทยจะเพี้ยนไป 7 ชม.)
 */
export function toLocalDateTimeInputValue(d?: Date | string | null): string {
  const date = d ? new Date(d) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
