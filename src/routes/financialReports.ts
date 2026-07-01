import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authMiddleware, requireRole, type AuthRequest } from '../middleware/auth.js';
import { businessDateFromYmdString, dateToYmdUtc, parseYmd, utcDayRangeInclusive } from '../lib/businessDate.js';

export const financialReportsRouter = Router();
financialReportsRouter.use(authMiddleware);
financialReportsRouter.use(requireRole('OWNER', 'ADMIN'));

type Period = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'semester' | 'yearly';

type DayTotals = {
  openingLeftoverQuantity: number;
  salesTotal: number;
  cashLeftoverTotal: number;
  companyExpenseTotal: number;
  ownerExpenseTotal: number;
  loanTotal: number;
  supplierDeliveryCost: number;
  payrollTotal: number;
  netIncome: number;
};

function toNumber(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') return parseFloat(v) || 0;
  return 0;
}

function startOfDayUtc(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

function endOfDayUtc(d: Date): Date {
  const x = new Date(d);
  x.setUTCHours(23, 59, 59, 999);
  return x;
}

function resolveBranchId(req: AuthRequest): string | null {
  const branchId = (req.query.branchId as string | undefined) || req.user?.branchId || null;
  return branchId;
}

function resolveRange(req: AuthRequest, fallbackDate = new Date()) {
  const fromParam = (req.query.from as string | undefined)?.trim();
  const toParam = (req.query.to as string | undefined)?.trim();
  const dateParam = (req.query.date as string | undefined)?.trim();

  const fromDate =
    fromParam || dateParam
      ? businessDateFromYmdString(fromParam || dateParam || '')
      : startOfDayUtc(fallbackDate);
  const toDate =
    toParam || dateParam
      ? businessDateFromYmdString(toParam || dateParam || '')
      : endOfDayUtc(fallbackDate);

  if (!fromDate || !toDate) return null;
  return {
    fromDate: startOfDayUtc(fromDate),
    toDate: endOfDayUtc(toDate),
  };
}

function resolvePeriodRange(period: Period, req: AuthRequest) {
  const today = new Date();
  const y = parseInt((req.query.year as string) || String(today.getUTCFullYear()), 10);
  const month = parseInt((req.query.month as string) || String(today.getUTCMonth() + 1), 10);
  const quarter = parseInt((req.query.quarter as string) || String(Math.ceil((today.getUTCMonth() + 1) / 3)), 10);
  const semester = parseInt((req.query.semester as string) || String(today.getUTCMonth() < 6 ? 1 : 2), 10);
  const endDateParam = (req.query.endDate as string | undefined)?.trim();

  if (period === 'daily') {
    const range = resolveRange(req, today);
    return range ? { ...range, period } : null;
  }

  if (period === 'weekly') {
    const end = endDateParam ? businessDateFromYmdString(endDateParam) : startOfDayUtc(today);
    if (!end) return null;
    const day = end.getUTCDay();
    const diff = end.getUTCDate() - day + (day === 0 ? -6 : 1);
    const from = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), diff, 0, 0, 0, 0));
    return { period, fromDate: from, toDate: endOfDayUtc(end) };
  }

  if (period === 'monthly') {
    const from = new Date(Date.UTC(y, month - 1, 1, 0, 0, 0, 0));
    const to = new Date(Date.UTC(y, month, 0, 23, 59, 59, 999));
    return { period, fromDate: from, toDate: to };
  }

  if (period === 'quarterly') {
    const startMonth = (Math.max(1, Math.min(4, quarter)) - 1) * 3;
    const from = new Date(Date.UTC(y, startMonth, 1, 0, 0, 0, 0));
    const to = new Date(Date.UTC(y, startMonth + 3, 0, 23, 59, 59, 999));
    return { period, fromDate: from, toDate: to };
  }

  if (period === 'semester') {
    const startMonth = semester === 2 ? 6 : 0;
    const from = new Date(Date.UTC(y, startMonth, 1, 0, 0, 0, 0));
    const to = new Date(Date.UTC(y, startMonth + 6, 0, 23, 59, 59, 999));
    return { period, fromDate: from, toDate: to };
  }

  const from = new Date(Date.UTC(y, 0, 1, 0, 0, 0, 0));
  const to = new Date(Date.UTC(y, 11, 31, 23, 59, 59, 999));
  return { period, fromDate: from, toDate: to };
}

function sumTotals(rows: DayTotals[]): DayTotals {
  return rows.reduce<DayTotals>(
    (acc, row) => ({
      openingLeftoverQuantity: acc.openingLeftoverQuantity + row.openingLeftoverQuantity,
      salesTotal: acc.salesTotal + row.salesTotal,
      cashLeftoverTotal: acc.cashLeftoverTotal + row.cashLeftoverTotal,
      companyExpenseTotal: acc.companyExpenseTotal + row.companyExpenseTotal,
      ownerExpenseTotal: acc.ownerExpenseTotal + row.ownerExpenseTotal,
      loanTotal: acc.loanTotal + row.loanTotal,
      supplierDeliveryCost: acc.supplierDeliveryCost + row.supplierDeliveryCost,
      payrollTotal: acc.payrollTotal + row.payrollTotal,
      netIncome: acc.netIncome + row.netIncome,
    }),
    {
      openingLeftoverQuantity: 0,
      salesTotal: 0,
      cashLeftoverTotal: 0,
      companyExpenseTotal: 0,
      ownerExpenseTotal: 0,
      loanTotal: 0,
      supplierDeliveryCost: 0,
      payrollTotal: 0,
      netIncome: 0,
    }
  );
}

async function loadRangeReport(branchId: string, fromDate: Date, toDate: Date) {
  const sessions = await prisma.dailySession.findMany({
    where: { branchId, date: { gte: fromDate, lte: toDate } },
    include: {
      sales: { include: { items: { include: { product: { select: { id: true, name: true, flavor: true, unitType: true } } } } }, orderBy: { createdAt: 'asc' } },
      leftoverRecords: { include: { product: { select: { id: true, name: true, flavor: true, unitType: true } } } },
    },
    orderBy: { date: 'asc' },
  });

  const productionBatches = await prisma.productionBatch.findMany({
    where: { branchId, date: { gte: fromDate, lte: toDate } },
    include: {
      user: { select: { id: true, fullName: true } },
      items: { include: { product: { select: { id: true, name: true, flavor: true, unitType: true } } } },
      materialUsages: { include: { stockItem: { select: { id: true, name: true, unitType: true } } } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const expenses = await prisma.expense.findMany({
    where: { branchId, date: { gte: fromDate, lte: toDate } },
    include: {
      user: { select: { id: true, fullName: true, phone: true } },
      financialCategory: { select: { id: true, name: true, type: true } },
    },
    orderBy: { date: 'desc' },
  });

  const loans = await prisma.loan.findMany({
    where: { branchId, date: { gte: fromDate, lte: toDate } },
    include: { user: { select: { id: true, fullName: true, phone: true, role: true } }, payments: true },
    orderBy: { createdAt: 'desc' },
  });

  const supplierDeliveries = await prisma.supplierDelivery.findMany({
    where: { supplier: { branchId }, createdAt: { gte: fromDate, lte: toDate } },
    include: { supplier: true, product: true, stockItem: true },
    orderBy: { createdAt: 'desc' },
  });

  const payrollRecords = await prisma.payrollRecord.findMany({
    where: { user: { branchId } },
    include: { user: { select: { id: true, fullName: true, phone: true, role: true } } },
    orderBy: { createdAt: 'desc' },
  });
  const payrollInRange = payrollRecords.filter((row) => {
    const pivot = row.paymentDate ?? row.createdAt;
    return pivot >= fromDate && pivot <= toDate;
  });

  const previousClosedBeforeRange = await prisma.dailySession.findFirst({
    where: {
      branchId,
      status: 'CLOSED',
      date: { lt: fromDate },
    },
    include: { leftoverRecords: { include: { product: { select: { id: true, name: true, flavor: true, unitType: true } } } } },
    orderBy: { date: 'desc' },
  });

  const dayMap = new Map<string, DayTotals>();
  const ensure = (ymd: string) => {
    if (!dayMap.has(ymd)) {
      dayMap.set(ymd, {
        openingLeftoverQuantity: 0,
        salesTotal: 0,
        cashLeftoverTotal: 0,
        companyExpenseTotal: 0,
        ownerExpenseTotal: 0,
        loanTotal: 0,
        supplierDeliveryCost: 0,
        payrollTotal: 0,
        netIncome: 0,
      });
    }
    return dayMap.get(ymd)!;
  };

  const carryRows = (previousClosedBeforeRange?.leftoverRecords ?? []).map((row) => ({
    productId: row.productId,
    quantityRemaining: row.quantityRemaining,
    product: row.product,
  }));

  const sessionsWithOpening = sessions.map((session) => {
    const openingLeftoverRecords = carryRows.map((row) => ({
      product: row.product,
      quantityRemaining: row.quantityRemaining,
    }));
    const openingLeftoverQuantity = openingLeftoverRecords.reduce((sum, row) => sum + row.quantityRemaining, 0);
    if (session.status === 'CLOSED') {
      carryRows.splice(0, carryRows.length, ...session.leftoverRecords.map((row) => ({
        productId: row.productId,
        quantityRemaining: row.quantityRemaining,
        product: row.product,
      })));
    }
    return {
      ...session,
      openingLeftoverRecords,
      openingLeftoverQuantity,
    };
  });

  for (const session of sessionsWithOpening) {
    const ymd = dateToYmdUtc(session.date);
    const bucket = ensure(ymd);
    bucket.openingLeftoverQuantity += session.openingLeftoverQuantity;
    const salesTotal = session.sales.reduce((sum, sale) => sum + toNumber(sale.totalAmount), 0);
    const cashLeftoverTotal = toNumber(session.cashLeftoverAmount);
    bucket.salesTotal += salesTotal;
    bucket.cashLeftoverTotal += cashLeftoverTotal;
  }

  for (const row of expenses) {
    const ymd = dateToYmdUtc(row.date);
    const bucket = ensure(ymd);
    if (row.type === 'COMPANY') bucket.companyExpenseTotal += toNumber(row.amount);
    if (row.type === 'OWNER') bucket.ownerExpenseTotal += toNumber(row.amount);
  }

  for (const row of loans) {
    const ymd = dateToYmdUtc(row.date);
    ensure(ymd).loanTotal += toNumber(row.totalAmount);
  }

  for (const row of supplierDeliveries) {
    const ymd = dateToYmdUtc(row.createdAt);
    const netQty = Math.max(0, row.quantityReceived - row.returnedQuantity);
    ensure(ymd).supplierDeliveryCost += toNumber(row.unitBuyPrice) * netQty;
  }

  for (const row of payrollInRange) {
    const ymd = dateToYmdUtc(row.paymentDate ?? row.createdAt);
    ensure(ymd).payrollTotal += toNumber(row.finalAmount);
  }

  const dailyBreakdown = Array.from(dayMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, totals]) => ({
      date,
      ...totals,
      netIncome:
        totals.salesTotal - totals.cashLeftoverTotal - totals.companyExpenseTotal - totals.ownerExpenseTotal - totals.loanTotal - totals.supplierDeliveryCost - totals.payrollTotal,
    }));

  const totals = sumTotals(dailyBreakdown);
  return {
    sessions: sessionsWithOpening,
    productionBatches,
    expenses,
    loans,
    supplierDeliveries,
    payrollRecords: payrollInRange,
    dailyBreakdown,
    totals: {
      ...totals,
      totalExpense:
        totals.companyExpenseTotal + totals.ownerExpenseTotal + totals.loanTotal + totals.supplierDeliveryCost + totals.payrollTotal,
      netIncome:
        totals.salesTotal - totals.cashLeftoverTotal - totals.companyExpenseTotal - totals.ownerExpenseTotal - totals.loanTotal - totals.supplierDeliveryCost - totals.payrollTotal,
    },
  };
}

financialReportsRouter.get('/daily', async (req: AuthRequest, res) => {
  const branchId = resolveBranchId(req);
  const date = (req.query.date as string | undefined)?.trim() || new Date().toISOString().slice(0, 10);
  const ymd = parseYmd(date);
  if (!branchId) return res.status(400).json({ error: 'branchId required' });
  if (!ymd) return res.status(400).json({ error: 'Invalid date (use YYYY-MM-DD)' });
  const fromDate = businessDateFromYmdString(date)!;
  const toDate = businessDateFromYmdString(date)!;
  const report = await loadRangeReport(branchId, startOfDayUtc(fromDate), endOfDayUtc(toDate));
  res.json({
    period: 'daily',
    branchId,
    date,
    ...report,
  });
});

financialReportsRouter.get('/summary', async (req: AuthRequest, res) => {
  const branchId = resolveBranchId(req);
  const range = resolveRange(req);
  if (!branchId) return res.status(400).json({ error: 'branchId required' });
  if (!range) return res.status(400).json({ error: 'from and to are required in YYYY-MM-DD format' });
  const report = await loadRangeReport(branchId, range.fromDate, range.toDate);
  res.json({
    period: 'summary',
    branchId,
    from: dateToYmdUtc(range.fromDate),
    to: dateToYmdUtc(range.toDate),
    ...report,
  });
});

financialReportsRouter.get('/period', async (req: AuthRequest, res) => {
  const branchId = resolveBranchId(req);
  const period = String(req.query.period || 'monthly').toLowerCase() as Period;
  if (!branchId) return res.status(400).json({ error: 'branchId required' });
  if (!['daily', 'weekly', 'monthly', 'quarterly', 'semester', 'yearly'].includes(period)) {
    return res.status(400).json({ error: 'period must be daily, weekly, monthly, quarterly, semester, or yearly' });
  }
  const range = resolvePeriodRange(period, req);
  if (!range) return res.status(400).json({ error: 'Unable to resolve period range' });
  const report = await loadRangeReport(branchId, range.fromDate, range.toDate);
  res.json({
    period,
    branchId,
    from: dateToYmdUtc(range.fromDate),
    to: dateToYmdUtc(range.toDate),
    ...report,
  });
});
