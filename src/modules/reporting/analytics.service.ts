import { prisma } from '../../lib/prisma.js';
import { businessDateFromYmdString } from '../../lib/businessDate.js';
import type { ServiceResponse, ServiceResult } from '../../types/service-response.js';

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

function endOfMonth(d: Date) {
  const x = new Date(d);
  x.setMonth(x.getMonth() + 1);
  x.setDate(0);
  x.setHours(23, 59, 59, 999);
  return x;
}

export class AnalyticsService {
  async getDailyAnalytics(branchId?: string | null, date?: string): ServiceResult {
    if (!branchId) {
      return { error: 'branchId required', status: 400 };
    }
    const cal = businessDateFromYmdString(date || new Date().toISOString().slice(0, 10));
    if (!cal || Number.isNaN(cal.getTime())) {
      return { error: 'Invalid date (use YYYY-MM-DD)', status: 400 };
    }
    const dayStart = startOfDay(cal);
    const dayEnd = endOfDay(cal);

    const sessions = await prisma.dailySession.findMany({
      where: { branchId, date: cal },
      include: { sales: true, leftoverRecords: true },
    });
    const salesSum = sessions.reduce((acc, s) => acc + s.sales.reduce((t, x) => t + Number(x.totalAmount), 0), 0);
    const expensesCompany = await prisma.expense.findMany({
      where: { branchId, date: cal, type: 'COMPANY' },
    });
    const expensesOwner = await prisma.expense.findMany({
      where: { branchId, date: cal, type: 'OWNER' },
    });
    const expenseTotal = expensesCompany.reduce((sum, e) => sum + Number(e.amount), 0);
    const ownerExpenseTotal = expensesOwner.reduce((sum, e) => sum + Number(e.amount), 0);
    const batches = await prisma.productionBatch.count({
      where: { branchId, date: cal },
    });
    const deliveries = await prisma.supplierDelivery.findMany({
      where: { supplier: { branchId }, createdAt: { gte: dayStart, lte: dayEnd } },
    });
    const deliveryCost = deliveries.reduce((s, d) => s + Number(d.unitBuyPrice) * d.quantityReceived, 0);
    const deliveryRevenue = deliveries.reduce((s, d) => s + Number(d.unitSellPrice) * (d.quantityReceived - d.returnedQuantity), 0);

    const leftoverLines = sessions.reduce((acc, s) => acc + s.leftoverRecords.length, 0);
    const closedSessions = sessions.filter((s) => s.status === 'CLOSED').length;
    const openSessions = sessions.filter((s) => s.status === 'OPEN').length;

    return {
      data: {
        date: date || new Date().toISOString().slice(0, 10),
        branchId,
        sessions: sessions.length,
        closedSessions,
        openSessions,
        leftoverLines,
        salesTotal: salesSum,
        expenseTotal,
        ownerExpenseTotal,
        batches,
        deliveryCost,
        deliveryRevenue,
      },
    };
  }

  async getWeeklyAnalytics(branchId?: string | null, date?: string): ServiceResult {
    if (!branchId) {
      return { error: 'branchId required', status: 400 };
    }
    const cal = businessDateFromYmdString(date || new Date().toISOString().slice(0, 10));
    if (!cal || Number.isNaN(cal.getTime())) {
      return { error: 'Invalid date (use YYYY-MM-DD)', status: 400 };
    }
    const weekStart = startOfWeek(cal);
    const weekEnd = endOfDay(new Date(weekStart));
    weekEnd.setDate(weekEnd.getDate() + 6);

    const sessions = await prisma.dailySession.findMany({
      where: { branchId, date: { gte: weekStart, lte: weekEnd } },
      include: { sales: true },
    });
    const salesSum = sessions.reduce((acc, s) => acc + s.sales.reduce((t, x) => t + Number(x.totalAmount), 0), 0);
    const expenses = await prisma.expense.findMany({
      where: { branchId, date: { gte: weekStart, lte: weekEnd } },
    });
    const expenseTotal = expenses.reduce((sum, e) => sum + Number(e.amount), 0);

    return {
      data: {
        date: date || new Date().toISOString().slice(0, 10),
        branchId,
        weekStart: weekStart.toISOString().slice(0, 10),
        weekEnd: weekEnd.toISOString().slice(0, 10),
        sessions: sessions.length,
        salesTotal: salesSum,
        expenseTotal,
      },
    };
  }

  async getMonthlyAnalytics(branchId?: string | null, month?: number, year?: number): ServiceResult {
    if (!branchId) {
      return { error: 'branchId required', status: 400 };
    }
    const m = month ?? new Date().getUTCMonth() + 1;
    const y = year ?? new Date().getUTCFullYear();
    const monthStart = startOfMonth(new Date(Date.UTC(y, m - 1, 1)));
    const monthEnd = endOfMonth(new Date(Date.UTC(y, m - 1, 1)));

    const sessions = await prisma.dailySession.findMany({
      where: { branchId, date: { gte: monthStart, lte: monthEnd } },
      include: { sales: true },
    });
    const salesSum = sessions.reduce((acc, s) => acc + s.sales.reduce((t, x) => t + Number(x.totalAmount), 0), 0);
    const expenses = await prisma.expense.findMany({
      where: { branchId, date: { gte: monthStart, lte: monthEnd } },
    });
    const expenseTotal = expenses.reduce((sum, e) => sum + Number(e.amount), 0);

    return {
      data: {
        month: m,
        year: y,
        branchId,
        monthStart: monthStart.toISOString().slice(0, 10),
        monthEnd: monthEnd.toISOString().slice(0, 10),
        sessions: sessions.length,
        salesTotal: salesSum,
        expenseTotal,
      },
    };
  }
}
