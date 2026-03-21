import type { ExpenseType as ExpenseTypeEnum } from '@prisma/client';

/** Maps API input to DB enum. Accepts new names (COMPANY/OWNER) and legacy (OPERATIONAL/PERSONAL). */
export function parseExpenseType(input?: string): ExpenseTypeEnum {
  const t = (input ?? '').toUpperCase();
  if (t === 'OWNER' || t === 'PERSONAL') return 'OWNER';
  return 'COMPANY'; // COMPANY, OPERATIONAL, default
}

export function isValidExpenseTypeForPatch(input: string): boolean {
  return ['COMPANY', 'OWNER', 'OPERATIONAL', 'PERSONAL'].includes(input.toUpperCase());
}
