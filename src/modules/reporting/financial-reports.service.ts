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
      include: {
        financialCategory: { select: { name: true } },
        user: { select: { fullName: true } },
      },
      orderBy: { date: 'desc' },
    });

    const companyExpenseTotal = expenses.filter(e => e.type === 'COMPANY').reduce((sum, e) => sum + Number(e.amount), 0);
    const ownerExpenseTotal = expenses.filter(e => e.type === 'OWNER').reduce((sum, e) => sum + Number(e.amount), 0);

    const loans = await prisma.loan.findMany({
      where: { branchId, date: { gte: fromDate, lte: toDate } },
      include: { user: { select: { fullName: true } } },
      orderBy: { date: 'desc' },
    });
    const loanTotal = loans.reduce((sum, l) => sum + Number(l.totalAmount), 0);

    const deliveries = await prisma.supplierDelivery.findMany({
      where: { supplier: { branchId }, createdAt: { gte: fromDate, lte: toDate } },
      include: { supplier: { select: { name: true } }, product: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const supplierDeliveryCost = deliveries.reduce((s, d) => s + Number(d.unitBuyPrice) * d.quantityReceived, 0);

    const stockPurchasePayments = await prisma.stockPurchasePayment.findMany({
      where: {
        loan: { branchId },
        createdAt: { gte: fromDate, lte: toDate },
      },
      include: {
        user: { select: { fullName: true } },
        loan: { select: { supplierName: true, stockMovement: { select: { stockItem: { select: { name: true } } } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const stockLoanPaymentTotal = stockPurchasePayments.reduce((sum, sp) => sum + Number(sp.amount), 0);

    const payroll = await prisma.payrollRecord.findMany({
      where: { user: { branchId }, paymentDate: { gte: fromDate, lte: toDate } },
      include: { user: { select: { fullName: true } } },
      orderBy: { paymentDate: 'desc' },
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

    // Total Operating Expenses (Company operating costs + payroll + stock loan payments)
    const totalOperatingExpenses = companyExpenseTotal + payrollTotal + stockLoanPaymentTotal;
    const totalMaterialCosts = supplierDeliveryCost;
    const totalCompanyCosts = totalOperatingExpenses + totalMaterialCosts;

    // Gross & Operating Net Profit
    const grossProfit = salesTotal - totalMaterialCosts;
    const operatingNetIncome = salesTotal - totalCompanyCosts;

    // Net Cash after Owner Personal Expenses / Withdrawals
    const netIncomeAfterOwnerDrawings = operatingNetIncome - ownerExpenseTotal;

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
      stockLoanPaymentTotal,
      payrollTotal,
      totalOperatingExpenses,
      totalExpense: totalCompanyCosts,
      totalExpenses: totalCompanyCosts,
      grossProfit,
      operatingNetIncome,
      netIncome: operatingNetIncome,
      netIncomeAfterOwnerDrawings,
    };

    // Build Daily Breakdown Map
    const dailyMap = new Map<string, any>();

    const getOrCreateDailyEntry = (dayKey: string) => {
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
          stockLoanPaymentTotal: 0,
          payrollTotal: 0,
          operatingNetIncome: 0,
        });
      }
      return dailyMap.get(dayKey);
    };

    for (const s of sessions) {
      const dayKey = s.date.toISOString().slice(0, 10);
      const entry = getOrCreateDailyEntry(dayKey);
      entry.salesTotal += s.sales.reduce((t, x) => t + Number(x.totalAmount), 0);
      entry.cashLeftoverTotal += s.cashLeftoverAmount ? Number(s.cashLeftoverAmount) : 0;
      const recs = s.leftoverRecords || [];
      entry.openingLeftoverQuantity += recs.reduce((sum, r) => sum + (r.quantityRemaining || 0), 0);
    }

    for (const e of expenses) {
      const dayKey = e.date ? new Date(e.date).toISOString().slice(0, 10) : new Date(e.createdAt).toISOString().slice(0, 10);
      const entry = getOrCreateDailyEntry(dayKey);
      if (e.type === 'COMPANY') {
        entry.companyExpenseTotal += Number(e.amount);
      } else if (e.type === 'OWNER') {
        entry.ownerExpenseTotal += Number(e.amount);
      }
    }

    for (const l of loans) {
      const dayKey = l.date ? new Date(l.date).toISOString().slice(0, 10) : new Date(l.createdAt).toISOString().slice(0, 10);
      const entry = getOrCreateDailyEntry(dayKey);
      entry.loanTotal += Number(l.totalAmount);
    }

    for (const d of deliveries) {
      const dayKey = new Date(d.createdAt).toISOString().slice(0, 10);
      const entry = getOrCreateDailyEntry(dayKey);
      entry.supplierDeliveryCost += Number(d.unitBuyPrice) * d.quantityReceived;
    }

    for (const sp of stockPurchasePayments) {
      const dayKey = new Date(sp.createdAt).toISOString().slice(0, 10);
      const entry = getOrCreateDailyEntry(dayKey);
      entry.stockLoanPaymentTotal += Number(sp.amount);
    }

    for (const p of payroll) {
      const dayKey = p.paymentDate ? new Date(p.paymentDate).toISOString().slice(0, 10) : new Date(p.createdAt).toISOString().slice(0, 10);
      const entry = getOrCreateDailyEntry(dayKey);
      entry.payrollTotal += Number(p.finalAmount);
    }

    const dailyBreakdown = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));
    for (const entry of dailyBreakdown) {
      // Daily Operating Net Income excludes Owner Expenses as per requirement
      entry.operatingNetIncome = entry.salesTotal - (entry.companyExpenseTotal + entry.supplierDeliveryCost + entry.stockLoanPaymentTotal + entry.payrollTotal);
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
        stockLoanPaymentTotal,
        payrollTotal,
        totalOperatingExpenses,
        totalExpenses: totalCompanyCosts,
        grossProfit,
        operatingNetIncome,
        netIncome: operatingNetIncome,
        netIncomeAfterOwnerDrawings,
        dailyBreakdown,
        sessions,
        productionBatches,
        expenses,
        companyExpenses: expenses.filter(e => e.type === 'COMPANY'),
        ownerExpenses: expenses.filter(e => e.type === 'OWNER'),
        loans,
        supplierDeliveries: deliveries,
        stockPurchasePayments,
        payrollRecords: payroll,
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

    const [expenses, supplierDeliveries, stockPurchasePayments, sessions] = await Promise.all([
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
      prisma.stockPurchasePayment.findMany({
        where: { loan: { branchId }, createdAt: { gte: fromDate, lte: toDate } },
        include: {
          user: { select: { id: true, fullName: true } },
          loan: { select: { supplierName: true, stockMovement: { select: { stockItem: { select: { name: true } } } } } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.dailySession.findMany({
        where: { branchId, date: { gte: fromDate, lte: toDate } },
        select: { id: true, date: true, cashLeftoverAmount: true },
      }),
    ]);

    const companyExpenses = expenses.filter(e => e.type === 'COMPANY');
    const ownerExpenses = expenses.filter(e => e.type === 'OWNER');
    const companyExpenseTotal = companyExpenses.reduce((sum, e) => sum + Number(e.amount), 0);
    const ownerExpenseTotal = ownerExpenses.reduce((sum, e) => sum + Number(e.amount), 0);
    const supplierTotal = supplierDeliveries.reduce((sum, d) => sum + Number(d.unitBuyPrice) * d.quantityReceived, 0);
    const stockLoanTotal = stockPurchasePayments.reduce((sum, sp) => sum + Number(sp.amount), 0);
    const cashLeftoverTotal = sessions.reduce((sum, s) => sum + (s.cashLeftoverAmount ? Number(s.cashLeftoverAmount) : 0), 0);

    return {
      data: {
        fromDate: fromDate.toISOString().slice(0, 10),
        toDate: toDate.toISOString().slice(0, 10),
        companyExpenseTotal,
        ownerExpenseTotal,
        supplierTotal,
        stockLoanTotal,
        cashLeftoverTotal,
        totalCompanyExpenses: companyExpenseTotal + supplierTotal + stockLoanTotal,
        totalExpensed: companyExpenseTotal + ownerExpenseTotal + supplierTotal + stockLoanTotal,
        expenses,
        companyExpenses,
        ownerExpenses,
        supplierDeliveries,
        stockPurchasePayments,
        cashLeftovers: sessions.filter(s => s.cashLeftoverAmount != null),
      },
    };
  }
}
