import type { BankHolidaySource } from '../../src/adapters/bankHolidays.js';

// England & Wales bank holidays used by the tests (a subset of the real gov.uk feed).
export const BANK_HOLIDAYS = ['2026-12-25', '2026-12-28', '2027-01-01', '2027-03-26', '2027-03-29'];

export interface FakeBankHolidays extends BankHolidaySource {
  calls: number;
}

export function fakeBankHolidays(dates: string[] = BANK_HOLIDAYS): FakeBankHolidays {
  const source: FakeBankHolidays = {
    calls: 0,
    async dates() {
      source.calls++;
      return new Set(dates);
    },
  };
  return source;
}
