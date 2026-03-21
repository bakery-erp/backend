import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authMiddleware, requireRole, type AuthRequest } from '../middleware/auth.js';

export const analyticsRouter = Router();
analyticsRouter.use(authMiddleware);
/** Analytics: OWNER only (full financial picture). ADMIN uses dashboard + ops; see docs/DESIGN-ROADMAP-FINANCIAL.md */
analyticsRouter.use(requireRole('OWNER'));

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
function startOfWeek(d: Date) {
  const x = new Date(d);
  const day = x.getDay();
  const diff = x.getDate() - day + (day === 0 ? -6 : 1);
  x.setDate(diff);
  x.setHours(0, 0, 0, 0);
  return x;
}
function startOfMonth(d: Date) {
  const x = new Date(d);
  x.setDate(1);
  x.setHours(0, 0, 0, 0);
  return x;
}

analyticsRouter.get('/daily', async (req: AuthRequest, res) => {
  const branchId = (req.query.branchId as string) || req.user?.branchId;
  const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);
  if (!branchId) return res.status(400).json({ error: 'branchId required' });
  const d = new Date(date);
  const dayStart = startOfDay(d);
  const dayEnd = endOfDay(d);

  const sessions = await prisma.dailySession.findMany({
    where: { branchId, date: { gte: dayStart, lte: dayEnd } },
    include: { sales: true, leftoverRecords: true },
  });
  const salesSum = sessions.reduce((acc, s) => acc + s.sales.reduce((t, x) => t + Number(x.totalAmount), 0), 0);
  const expensesCompany = await prisma.expense.findMany({
    where: { branchId, date: { gte: dayStart, lte: dayEnd }, type: 'COMPANY' },
  });
  const expensesOwner = await prisma.expense.findMany({
    where: { branchId, date: { gte: dayStart, lte: dayEnd }, type: 'OWNER' },
  });
  const expenseTotal = expensesCompany.reduce((sum, e) => sum + Number(e.amount), 0);
  const ownerExpenseTotal = expensesOwner.reduce((sum, e) => sum + Number(e.amount), 0);
  const batches = await prisma.productionBatch.count({
    where: { branchId, date: { gte: dayStart, lte: dayEnd } },
  });
  const deliveries = await prisma.supplierDelivery.findMany({
    where: { supplier: { branchId }, createdAt: { gte: dayStart, lte: dayEnd } },
  });
  const deliveryCost = deliveries.reduce((s, d) => s + Number(d.unitBuyPrice) * d.quantityReceived, 0);
  const deliveryRevenue = deliveries.reduce((s, d) => s + Number(d.unitSellPrice) * (d.quantityReceived - d.returnedQuantity), 0);

  res.json({
    date,
    branchId,
    sessions: sessions.length,
    salesCount: sessions.reduce((acc, s) => acc + s.sales.length, 0),
    salesTotal: salesSum,
    expenseTotal,
    ownerExpenseTotal,
    productionBatches: batches,
    supplierDeliveries: deliveries.length,
    supplierDeliveryCost: deliveryCost,
    supplierDeliveryRevenue: deliveryRevenue,
    netDaily: salesSum - expenseTotal - deliveryCost + (deliveryRevenue - deliveryCost),
  });
});

analyticsRouter.get('/weekly', async (req: AuthRequest, res) => {
  const branchId = (req.query.branchId as string) || req.user?.branchId;
  const endDate = (req.query.endDate as string) || new Date().toISOString().slice(0, 10);
  if (!branchId) return res.status(400).json({ error: 'branchId required' });
  const weekStart = startOfWeek(new Date(endDate));
  const weekEnd = endOfDay(new Date(endDate));

  const sessions = await prisma.dailySession.findMany({
    where: { branchId, date: { gte: weekStart, lte: weekEnd } },
    include: { sales: true },
  });
  const salesTotal = sessions.reduce((acc, s) => acc + s.sales.reduce((t, x) => t + Number(x.totalAmount), 0), 0);
  const expensesCompany = await prisma.expense.findMany({
    where: { branchId, date: { gte: weekStart, lte: weekEnd }, type: 'COMPANY' },
  });
  const expensesOwner = await prisma.expense.findMany({
    where: { branchId, date: { gte: weekStart, lte: weekEnd }, type: 'OWNER' },
  });
  const expenseTotal = expensesCompany.reduce((sum, e) => sum + Number(e.amount), 0);
  const ownerExpenseTotal = expensesOwner.reduce((sum, e) => sum + Number(e.amount), 0);
  const batches = await prisma.productionBatch.count({
    where: { branchId, date: { gte: weekStart, lte: weekEnd } },
  });
  const deliveries = await prisma.supplierDelivery.findMany({
    where: { supplier: { branchId }, createdAt: { gte: weekStart, lte: weekEnd } },
  });
  const deliveryCost = deliveries.reduce((s, d) => s + Number(d.unitBuyPrice) * d.quantityReceived, 0);

  res.json({
    period: 'weekly',
    from: weekStart.toISOString().slice(0, 10),
    to: endDate,
    branchId,
    sessionsCount: sessions.length,
    salesTotal,
    expenseTotal,
    ownerExpenseTotal,
    productionBatches: batches,
    supplierDeliveriesCount: deliveries.length,
    supplierDeliveryCost: deliveryCost,
    netWeekly: salesTotal - expenseTotal - deliveryCost,
  });
});

analyticsRouter.get('/monthly', async (req: AuthRequest, res) => {
  const branchId = (req.query.branchId as string) || req.user?.branchId;
  const year = parseInt(req.query.year as string) || new Date().getFullYear();
  const month = parseInt(req.query.month as string) || new Date().getMonth() + 1;
  if (!branchId) return res.status(400).json({ error: 'branchId required' });
  const monthStart = startOfMonth(new Date(year, month - 1));
  const monthEnd = endOfDay(new Date(year, month, 0));

  const sessions = await prisma.dailySession.findMany({
    where: { branchId, date: { gte: monthStart, lte: monthEnd } },
    include: { sales: true },
  });
  const salesTotal = sessions.reduce((acc, s) => acc + s.sales.reduce((t, x) => t + Number(x.totalAmount), 0), 0);
  const expensesAll = await prisma.expense.findMany({
    where: { branchId, date: { gte: monthStart, lte: monthEnd } },
  });
  const expenseTotal = expensesAll.reduce((sum, e) => sum + Number(e.amount), 0);
  const expenseCompanyTotal = expensesAll.filter((e) => e.type === 'COMPANY').reduce((sum, e) => sum + Number(e.amount), 0);
  const expenseOwnerTotal = expensesAll.filter((e) => e.type === 'OWNER').reduce((sum, e) => sum + Number(e.amount), 0);
  const batches = await prisma.productionBatch.count({
    where: { branchId, date: { gte: monthStart, lte: monthEnd } },
  });
  const deliveries = await prisma.supplierDelivery.findMany({
    where: { supplier: { branchId }, createdAt: { gte: monthStart, lte: monthEnd } },
  });
  const deliveryCost = deliveries.reduce((s, d) => s + Number(d.unitBuyPrice) * d.quantityReceived, 0);
  const payroll = await prisma.payrollRecord.findMany({
    where: { user: { branchId }, year, month },
  });
  const payrollTotal = payroll.reduce((s, p) => s + Number(p.finalAmount), 0);

  res.json({
    period: 'monthly',
    year,
    month,
    from: monthStart.toISOString().slice(0, 10),
    to: monthEnd.toISOString().slice(0, 10),
    branchId,
    sessionsCount: sessions.length,
    salesTotal,
    expenseTotal,
    expenseCompanyTotal,
    expenseOwnerTotal,
    payrollTotal,
    productionBatches: batches,
    supplierDeliveriesCount: deliveries.length,
    supplierDeliveryCost: deliveryCost,
    netMonthly: salesTotal - expenseTotal - deliveryCost - payrollTotal,
  });
});
