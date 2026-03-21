import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';

function decimalToNum(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseFloat(v);
  return 0;
}

export const payrollRouter = Router();
payrollRouter.use(authMiddleware);

payrollRouter.get('/', requireRole('OWNER', 'ADMIN'), async (req, res) => {
  const userId = req.query.userId as string | undefined;
  const month = req.query.month as string | undefined;
  const year = req.query.year as string | undefined;
  const where: any = {};
  if (userId) where.userId = userId;
  if (month) where.month = parseInt(month, 10);
  if (year) where.year = parseInt(year, 10);
  const list = await prisma.payrollRecord.findMany({
    where,
    include: { user: { select: { id: true, fullName: true, phone: true, role: true } } },
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
  });
  res.json(list);
});

payrollRouter.post('/', requireRole('OWNER', 'ADMIN'), async (req, res) => {
  const { userId, month, year, baseSalary, loanDeductions, penaltyDeductions, bonus, paymentDate } = req.body as {
    userId: string;
    month: number;
    year: number;
    baseSalary: number | string;
    loanDeductions?: number | string;
    penaltyDeductions?: number | string;
    bonus?: number | string;
    paymentDate?: string;
  };
  if (!userId || month == null || year == null || baseSalary == null) {
    return res.status(400).json({ error: 'userId, month, year, baseSalary required' });
  }
  const base = decimalToNum(baseSalary);
  const loanD = decimalToNum(loanDeductions);
  const penaltyD = decimalToNum(penaltyDeductions);
  const bonusNum = decimalToNum(bonus);
  const finalAmount = base - loanD - penaltyD + bonusNum;
  const record = await prisma.payrollRecord.create({
    data: {
      userId,
      month,
      year,
      baseSalary: base,
      loanDeductions: loanD,
      penaltyDeductions: penaltyD,
      bonus: bonusNum,
      finalAmount,
      paymentDate: paymentDate ? new Date(paymentDate) : null,
    },
    include: { user: { select: { id: true, fullName: true, phone: true, role: true } } },
  });
  res.status(201).json(record);
});

payrollRouter.get('/calculate/:userId', requireRole('OWNER', 'ADMIN'), async (req, res) => {
  const { userId } = req.params;
  const { month, year } = req.query as { month: string; year: string };
  if (!month || !year) return res.status(400).json({ error: 'month and year required' });
  const m = parseInt(month, 10);
  const y = parseInt(year, 10);
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });
  if (!user) return res.status(404).json({ error: 'User not found' });
  const baseSalary = user.salary != null ? Number(user.salary) : 0;
  const startDate = user.startDate ? new Date(user.startDate) : null;
  const monthStart = new Date(y, m - 1, 1);
  const monthEnd = new Date(y, m, 0);
  let proratedBase = baseSalary;
  if (startDate && startDate > monthStart) {
    const daysInMonth = monthEnd.getDate();
    const daysWorked = Math.min(daysInMonth, Math.ceil((monthEnd.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)));
    proratedBase = (baseSalary / daysInMonth) * daysWorked;
  }
  const openLoans = await prisma.loan.findMany({
    where: { userId, status: 'OPEN' },
  });
  const totalLoanBalance = openLoans.reduce((s, l) => s + Number(l.remainingBalance), 0);
  const undeductedPenalties = await prisma.penalty.findMany({
    where: { userId, isDeducted: false },
  });
  const penaltyDeductions = undeductedPenalties.reduce((s, p) => s + Number(p.amount), 0);
  res.json({
    userId,
    month: m,
    year: y,
    baseSalary,
    proratedBase,
    loanDeductions: totalLoanBalance,
    penaltyDeductions,
    suggestedFinalAmount: proratedBase - totalLoanBalance - penaltyDeductions,
    undeductedPenalties,
    openLoans,
  });
});

payrollRouter.get('/:id', requireRole('OWNER', 'ADMIN'), async (req, res) => {
  const record = await prisma.payrollRecord.findUnique({
    where: { id: req.params.id },
    include: { user: { select: { id: true, fullName: true, phone: true, role: true } } },
  });
  if (!record) return res.status(404).json({ error: 'Payroll record not found' });
  res.json(record);
});

payrollRouter.patch('/:id', requireRole('OWNER', 'ADMIN'), async (req, res) => {
  const { paymentDate, bonus, loanDeductions, penaltyDeductions } = req.body as {
    paymentDate?: string | null;
    bonus?: number | string;
    loanDeductions?: number | string;
    penaltyDeductions?: number | string;
  };
  const existing = await prisma.payrollRecord.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Payroll record not found' });
  const data: any = {};
  if (paymentDate !== undefined) data.paymentDate = paymentDate ? new Date(paymentDate) : null;
  if (bonus != null) data.bonus = decimalToNum(bonus);
  if (loanDeductions != null) data.loanDeductions = decimalToNum(loanDeductions);
  if (penaltyDeductions != null) data.penaltyDeductions = decimalToNum(penaltyDeductions);
  if (bonus != null || loanDeductions != null || penaltyDeductions != null) {
    const base = Number(existing.baseSalary);
    const loanD = data.loanDeductions ?? Number(existing.loanDeductions);
    const penaltyD = data.penaltyDeductions ?? Number(existing.penaltyDeductions);
    const bonusNum = data.bonus ?? Number(existing.bonus);
    data.finalAmount = base - loanD - penaltyD + bonusNum;
  }
  const record = await prisma.payrollRecord.update({
    where: { id: req.params.id },
    data,
    include: { user: { select: { id: true, fullName: true, phone: true } } },
  });
  res.json(record);
});
