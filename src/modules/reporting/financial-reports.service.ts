import { prisma } from '../../lib/prisma.js';
import { businessDateFromYmdString } from '../../lib/businessDate.js';
import type { ServiceResponse, ServiceResult } from '../../types/service-response.js';

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

export class FinancialReportsService {
  async getRangeReport(branchId?: string | null, from?: string, to?: string, date?: string): ServiceResult {
    if (!branchId) {
      return { error: 'branchId required', status: 400 };
    }

    const fromDate = from || date ? businessDateFromYmdString(from || date || '') : startOfDayUtc(new Date());
    const toDate = to || date ? businessDateFromYmdString(to || date || '') : endOfDayUtc(new Date());

    if (!fromDate || !toDate) {
      return { error: 'Invalid date range', status: 400 };
    }

    const sessions = await prisma.dailySession.findMany({
      where: { branchId, date: { gte: fromDate, lte: toDate } },
      include: {
        sales: { include: { items: { include: { product: true } } } },
        leftoverRecords: { include: { product: true } },
      },
      orderBy: { date: 'asc' },
    });

    const salesTotal = sessions.reduce((acc, s) => acc + s.sales.reduce((t, x) => t + Number(x.totalAmount), 0), 0);
    const cashLeftoverTotal = sessions.reduce((acc, s) => acc + (s.cashLeftoverAmount ? Number(s.cashLeftoverAmount) : 0), 0);

    const expenses = await prisma.expense.findMany({
      where: { branchId, date: { gte: fromDate, lte: toDate } },
    });
    const companyExpenseTotal = expenses.filter(e => e.type === 'COMPANY').reduce((sum, e) => sum + Number(e.amount), 0);
    const ownerExpenseTotal = expenses.filter(e => e.type === 'OWNER').reduce((sum, e) => sum + Number(e.amount), 0);

    const loans = await prisma.loan.findMany({
      where: { branchId, date: { gte: fromDate, lte: toDate } },
    });
    const loanTotal = loans.reduce((sum, l) => sum + Number(l.totalAmount), 0);

    const deliveries = await prisma.supplierDelivery.findMany({
      where: { supplier: { branchId }, createdAt: { gte: fromDate, lte: toDate } },
    });
    const supplierDeliveryCost = deliveries.reduce((s, d) => s + Number(d.unitBuyPrice) * d.quantityReceived, 0);

    const payroll = await prisma.payrollRecord.findMany({
      where: { user: { branchId }, paymentDate: { gte: fromDate, lte: toDate } },
    });
    const payrollTotal = payroll.reduce((sum, p) => sum + Number(p.finalAmount), 0);

    const productionBatches = await prisma.productionBatch.findMany({
      where: { branchId, date: { gte: fromDate, lte: toDate } },
      include: {
        user: { select: { fullName: true } },
        items: { include: { product: true } },
        materialUsages: { include: { stockItem: true } },
      },
      orderBy: { date: 'desc' },
    });

    const detailedExpenses = await prisma.expense.findMany({
      where: { branchId, date: { gte: fromDate, lte: toDate } },
      include: {
        financialCategory: { select: { name: true } },
        user: { select: { fullName: true } },
      },
      orderBy: { date: 'desc' },
    });

    const detailedLoans = await prisma.loan.findMany({
      where: { branchId, date: { gte: fromDate, lte: toDate } },
      include: { user: { select: { fullName: true } } },
      orderBy: { date: 'desc' },
    });

    const detailedDeliveries = await prisma.supplierDelivery.findMany({
      where: { supplier: { branchId }, createdAt: { gte: fromDate, lte: toDate } },
      include: { supplier: { select: { name: true } }, product: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const detailedPayroll = await prisma.payrollRecord.findMany({
      where: { user: { branchId }, paymentDate: { gte: fromDate, lte: toDate } },
      include: { user: { select: { fullName: true } } },
      orderBy: { paymentDate: 'desc' },
    });

    const totalOperatingExpenses = companyExpenseTotal + payrollTotal;
    const totalMaterialCosts = supplierDeliveryCost;
    const totalExpenses = totalOperatingExpenses + totalMaterialCosts;
    const grossProfit = salesTotal - totalMaterialCosts;
    const netIncome = salesTotal - totalExpenses;

    const openingLeftoverQuantity = sessions.reduce((acc, s) => {
      const recs = s.leftoverRecords || [];
      return acc + recs.reduce((sum, r) => sum + (r.quantityRemaining || 0), 0);
    }, 0);

    const totals = {
      openingLeftoverQuantity,
      salesTotal,
      cashLeftoverTotal,
      companyExpenseTotal,
      ownerExpenseTotal,
      loanTotal,
      supplierDeliveryCost,
      payrollTotal,
      totalOperatingExpenses,
      totalExpense: totalExpenses,
      totalExpenses,
      grossProfit,
      netIncome,
    };

    const dailyMap = new Map<string, any>();
    for (const s of sessions) {
      const dayKey = s.date.toISOString().slice(0, 10);
      if (!dailyMap.has(dayKey)) {
        dailyMap.set(dayKey, {
          date: dayKey,
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
      const entry = dailyMap.get(dayKey);
      entry.salesTotal += s.sales.reduce((t, x) => t + Number(x.totalAmount), 0);
      entry.cashLeftoverTotal += s.cashLeftoverAmount ? Number(s.cashLeftoverAmount) : 0;
    }

    return {
      data: {
        branchId,
        from: fromDate.toISOString().slice(0, 10),
        to: toDate.toISOString().slice(0, 10),
        fromDate: fromDate.toISOString().slice(0, 10),
        toDate: toDate.toISOString().slice(0, 10),
        totals,
        salesTotal,
        cashLeftoverTotal,
        companyExpenseTotal,
        ownerExpenseTotal,
        loanTotal,
        supplierDeliveryCost,
        payrollTotal,
        totalOperatingExpenses,
        totalExpenses,
        grossProfit,
        netIncome,
        dailyBreakdown: Array.from(dailyMap.values()),
        sessions,
        productionBatches,
        expenses: detailedExpenses,
        loans: detailedLoans,
        supplierDeliveries: detailedDeliveries,
        payrollRecords: detailedPayroll,
      },
    };
  }

  async getPeriodReport(period: string, branchId?: string | null, query?: any): ServiceResult {
    if (!branchId) {
      return { error: 'branchId required', status: 400 };
    }

    const today = new Date();
    const y = parseInt((query?.year as string) || String(today.getUTCFullYear()), 10);
    const month = parseInt((query?.month as string) || String(today.getUTCMonth() + 1), 10);

    let fromDate: Date;
    let toDate: Date;

    switch (period) {
      case 'monthly':
        fromDate = new Date(Date.UTC(y, month - 1, 1, 0, 0, 0, 0));
        toDate = new Date(Date.UTC(y, month, 0, 23, 59, 59, 999));
        break;
      case 'yearly':
        fromDate = new Date(Date.UTC(y, 0, 1, 0, 0, 0, 0));
        toDate = new Date(Date.UTC(y, 11, 31, 23, 59, 59, 999));
        break;
      default:
        return { error: 'Invalid period. Use monthly or yearly', status: 400 };
    }

    return this.getRangeReport(branchId, fromDate.toISOString().slice(0, 10), toDate.toISOString().slice(0, 10));
  }

  async getGainedDetails(branchId?: string | null, from?: string, to?: string, date?: string): ServiceResult {
    if (!branchId) {
      return { error: 'branchId required', status: 400 };
    }

    const fromDate = from || date ? businessDateFromYmdString(from || date || '') : startOfDayUtc(new Date());
    const toDate = to || date ? businessDateFromYmdString(to || date || '') : endOfDayUtc(new Date());

    if (!fromDate || !toDate) {
      return { error: 'Invalid date range', status: 400 };
    }

    const sales = await prisma.sale.findMany({
      where: {
        session: { branchId, date: { gte: fromDate, lte: toDate } },
      },
      include: {
        user: { select: { id: true, fullName: true, phone: true } },
        session: { select: { id: true, date: true, status: true } },
        items: { include: { product: { select: { id: true, name: true, unitType: true, basePrice: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const totalRevenue = sales.reduce((sum, s) => sum + Number(s.totalAmount), 0);

    return {
      data: {
        fromDate: fromDate.toISOString().slice(0, 10),
        toDate: toDate.toISOString().slice(0, 10),
        totalRevenue,
        salesCount: sales.length,
        sales,
      },
    };
  }

  async getExpensedDetails(branchId?: string | null, from?: string, to?: string, date?: string): ServiceResult {
    if (!branchId) {
      return { error: 'branchId required', status: 400 };
    }

    const fromDate = from || date ? businessDateFromYmdString(from || date || '') : startOfDayUtc(new Date());
    const toDate = to || date ? businessDateFromYmdString(to || date || '') : endOfDayUtc(new Date());

    if (!fromDate || !toDate) {
      return { error: 'Invalid date range', status: 400 };
    }

    const [expenses, supplierDeliveries, sessions] = await Promise.all([
      prisma.expense.findMany({
        where: { branchId, date: { gte: fromDate, lte: toDate } },
        include: {
          user: { select: { id: true, fullName: true } },
          financialCategory: { select: { id: true, name: true, type: true } },
        },
        orderBy: { date: 'desc' },
      }),
      prisma.supplierDelivery.findMany({
        where: { supplier: { branchId }, createdAt: { gte: fromDate, lte: toDate } },
        include: {
          supplier: { select: { id: true, name: true, type: true } },
          product: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.dailySession.findMany({
        where: { branchId, date: { gte: fromDate, lte: toDate } },
        select: { id: true, date: true, cashLeftoverAmount: true },
      }),
    ]);

    const companyExpenseTotal = expenses.filter(e => e.type === 'COMPANY').reduce((sum, e) => sum + Number(e.amount), 0);
    const ownerExpenseTotal = expenses.filter(e => e.type === 'OWNER').reduce((sum, e) => sum + Number(e.amount), 0);
    const supplierTotal = supplierDeliveries.reduce((sum, d) => sum + Number(d.unitBuyPrice) * d.quantityReceived, 0);
    const cashLeftoverTotal = sessions.reduce((sum, s) => sum + (s.cashLeftoverAmount ? Number(s.cashLeftoverAmount) : 0), 0);

    return {
      data: {
        fromDate: fromDate.toISOString().slice(0, 10),
        toDate: toDate.toISOString().slice(0, 10),
        companyExpenseTotal,
        ownerExpenseTotal,
        supplierTotal,
        cashLeftoverTotal,
        totalExpensed: companyExpenseTotal + ownerExpenseTotal + supplierTotal + cashLeftoverTotal,
        expenses,
        supplierDeliveries,
        cashLeftovers: sessions.filter(s => s.cashLeftoverAmount != null),
      },
    };
  }
}
