import { describe, expect, it } from 'vitest';
import { formatBirthday, isBirthday, parseBirthday } from './birthday.js';

describe('birthdays', () => {
  it('fall on the day, in any year', () => {
    expect(isBirthday({ day: 17, month: 11, year: 1990 }, new Date(2026, 10, 17))).toBe(true);
    expect(isBirthday({ day: 17, month: 11, year: 1990 }, new Date(2030, 10, 17, 23, 59))).toBe(true);
    expect(isBirthday({ day: 17, month: 11, year: 1990 }, new Date(2026, 10, 18))).toBe(false);
    expect(isBirthday(null, new Date())).toBe(false);
  });

  it('move from 29 February to the 28th outside leap years', () => {
    const leapling = { day: 29, month: 2, year: 2004 };
    expect(isBirthday(leapling, new Date(2027, 1, 28))).toBe(true);
    expect(isBirthday(leapling, new Date(2028, 1, 28))).toBe(false);
    expect(isBirthday(leapling, new Date(2028, 1, 29))).toBe(true);
  });

  it('are read from "DD-MM-YYYY"', () => {
    const today = new Date(2026, 10, 17);
    expect(parseBirthday('17-11-1990', today)).toEqual({ day: 17, month: 11, year: 1990 });
    expect(parseBirthday('7/3/2001', today)).toEqual({ day: 7, month: 3, year: 2001 });
    expect(parseBirthday('29-02-2004', today)).toEqual({ day: 29, month: 2, year: 2004 });
    expect(parseBirthday('29-02-2003', today)).toBeNull();
    expect(parseBirthday('31-04-2000', today)).toBeNull();
    expect(parseBirthday('01-13-2000', today)).toBeNull();
    expect(parseBirthday('18-11-2026', today)).toBeNull();
    expect(parseBirthday('11-17', today)).toBeNull();
    expect(parseBirthday('', today)).toBeNull();
  });

  it('are written back as "DD-MM-YYYY"', () => {
    expect(formatBirthday({ day: 7, month: 3, year: 2001 })).toBe('07-03-2001');
  });
});
