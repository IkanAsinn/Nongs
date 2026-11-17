/**
 * The birthday event. The cake is not part of the house: it only appears on the
 * living-room coffee table on a player's birthday.
 */
import type { Furniture } from './furniture.js';

/** A date of birth. `month` is 1–12. */
export interface Birthday {
  day: number;
  month: number;
  year: number;
}

/** True on the birthday. Someone born on 29 February celebrates on the 28th in other years. */
export function isBirthday(birthday: Birthday | null, date: Date): boolean {
  if (!birthday) return false;
  const month = date.getMonth() + 1;
  const day = date.getDate();
  if (birthday.month === month && birthday.day === day) return true;
  const leap = new Date(date.getFullYear(), 1, 29).getMonth() === 1;
  return birthday.month === 2 && birthday.day === 29 && !leap && month === 2 && day === 28;
}

/**
 * Reads a date of birth written "DD-MM-YYYY" (slashes or dots also work), as
 * typed at registration. Null when it is not a real date or is in the future.
 */
export function parseBirthday(text: string | null | undefined, today: Date = new Date()): Birthday | null {
  const match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(text?.trim() ?? '');
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(year, month - 1, day);
  const real = date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  return real && year >= 1900 && date <= today ? { day, month, year } : null;
}

/** Writes a birthday back as "DD-MM-YYYY". */
export const formatBirthday = (birthday: Birthday): string =>
  `${String(birthday.day).padStart(2, '0')}-${String(birthday.month).padStart(2, '0')}-${birthday.year}`;

/** Where the cake stands during the event: on the coffee table in the living room. */
export const BIRTHDAY_CAKE: Furniture = { id: 'cake', model: 'prop_cake', x: 0, z: -5.6, yaw: 0, elevation: 0.45 };
