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

    const timestampStart = startOfDayUtc(fromDate);
    const timestampEnd = endOfDayUtc(toDate);

    const [
      sessions,
      expenses,
      loans,
      customerLoanPayments,
      allDeliveries,
      unpaidStockLoans,
      stockPurchasePayments,
      payroll,
      productionBatches,
      allClosedSessions,
    ] = await Promise.all([
      prisma.dailySession.findMany({
        where: { branchId, date: { gte: fromDate, lte: toDate } },
        include: {
          sales: { include: { items: { include: { product: true } } } },
          leftoverRecords: { include: { product: true } },
        },
        orderBy: { date: 'asc' },
      }),
      prisma.expense.findMany({
        where: { branchId, date: { gte: fromDate, lte: toDate } },
        include: {
          financialCategory: { select: { name: true } },
          user: { select: { fullName: true } },
        },
        orderBy: { date: 'desc' },
      }),
      prisma.loan.findMany({
        where: { branchId, date: { gte: fromDate, lte: toDate } },
        include: { user: { select: { fullName: true } }, payments: true },
        orderBy: { date: 'desc' },
      }),
      prisma.loanPayment.findMany({
        where: {
          loan: { branchId, type: 'CUSTOMER' },
          date: { gte: fromDate, lte: toDate },
        },
        include: { loan: { select: { id: true, entityId: true } } },
        orderBy: { date: 'desc' },
      }),
      prisma.supplierDelivery.findMany({
        where: {
          AND: [
            {
              OR: [
                { supplier: { branchId } },
                { session: { branchId } },
              ],
            },
            {
              OR: [
                { createdAt: { gte: timestampStart, lte: timestampEnd } },
                { session: { date: { gte: fromDate, lte: toDate } } },
              ],
            },
          ],
        },
        include: {
          supplier: { select: { id: true, name: true, branchId: true } },
          product: { select: { id: true, name: true, unitType: true, basePrice: true, buyPrice: true } },
          session: { select: { id: true, date: true, status: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.stockPurchaseLoan.findMany({
        where: {
          branchId,
          status: { not: 'PAID' },
        },
        include: {
          stockMovement: {
            select: {
              stockItem: { select: { name: true, unitType: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.stockPurchasePayment.findMany({
        where: {
          loan: { branchId },
          createdAt: { gte: timestampStart, lte: timestampEnd },
        },
        include: {
          user: { select: { fullName: true } },
          loan: { select: { supplierName: true, stockMovement: { select: { stockItem: { select: { name: true } } } } } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.payrollRecord.findMany({
        where: {
          user: { branchId },
          status: { not: 'REJECTED' },
          OR: [
            { paymentDate: { gte: timestampStart, lte: timestampEnd } },
            { paymentDate: null, createdAt: { gte: timestampStart, lte: timestampEnd } },
          ],
        },
        include: { user: { select: { id: true, fullName: true, phone: true, role: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.productionBatch.findMany({
        where: { branchId, date: { gte: fromDate, lte: toDate } },
        include: {
          user: { select: { fullName: true } },
          items: { include: { product: true } },
          materialUsages: { include: { stockItem: true } },
        },
        orderBy: { date: 'desc' },
      }),
      prisma.dailySession.findMany({
        where: { branchId, status: 'CLOSED' },
        orderBy: { date: 'desc' },
        select: { date: true, cashLeftoverAmount: true, actualCashAmount: true },
      }),
    ]);

    const salesTotal = sessions.reduce((acc, s) => acc + s.sales.reduce((t, x) => t + Number(x.totalAmount), 0), 0);
    const cashLeftoverTotal = sessions.reduce((acc, s) => acc + (s.cashLeftoverAmount ? Number(s.cashLeftoverAmount) : 0), 0);

    const companyExpenseTotal = expenses.filter(e => e.type === 'COMPANY').reduce((sum, e) => sum + Number(e.amount), 0);
    const ownerExpenseTotal = expenses.filter(e => e.type === 'OWNER').reduce((sum, e) => sum + Number(e.amount), 0);

    const loanTotal = loans.reduce((sum, l) => sum + Number(l.totalAmount), 0);
    const customerLoans = loans.filter(l => l.type === 'CUSTOMER');
    const customerCreditSalesTotal = customerLoans.reduce((sum, l) => sum + Number(l.totalAmount), 0);
    const employeeLoans = loans.filter(l => l.type !== 'CUSTOMER');
    const employeeLoanTotal = employeeLoans.reduce((sum, l) => sum + Number(l.totalAmount), 0);

    const customerCreditPaymentTotal = customerLoanPayments.reduce((sum, p) => sum + Number(p.amountPaid), 0);

    // On dashboard, show supplier purchases only if taken from daily cash drawer
    const deliveries = allDeliveries.filter((d) => d.paymentSource === 'DAILY_CASH');
    const ownerDeliveries = allDeliveries.filter((d) => d.paymentSource === 'OWNER');
    const supplierDeliveryCost = deliveries.reduce(
      (s, d) => s + Number(d.unitBuyPrice) * Math.max(0, d.quantityReceived - (d.returnedQuantity || 0)),
      0
    );
    const supplierDeliveryOwnerCost = ownerDeliveries.reduce(
      (s, d) => s + Number(d.unitBuyPrice) * Math.max(0, d.quantityReceived - (d.returnedQuantity || 0)),
      0
    );

    // Unpaid deliveries (Payables / Credits that owner has to pay)
    const unpaidSupplierDeliveries = allDeliveries.filter((d) => !d.isPaid);
    const unpaidSupplierDeliveriesTotal = unpaidSupplierDeliveries.reduce(
      (s, d) => s + Number(d.unitBuyPrice) * Math.max(0, d.quantityReceived - (d.returnedQuantity || 0)),
      0
    );

    // Unpaid stock purchase loans (Credits/debts that owner has to pay to suppliers)
    const unpaidStockLoansTotal = unpaidStockLoans.reduce((sum, sl) => sum + Number(sl.remainingBalance), 0);
    const totalPendingOwnerLiabilities = unpaidSupplierDeliveriesTotal + unpaidStockLoansTotal;

    const stockLoanPaymentTotal = stockPurchasePayments.reduce((sum, sp) => sum + Number(sp.amount), 0);
    const payrollTotal = payroll.reduce((sum, p) => sum + Number(p.finalAmount), 0);

    // Total Revenue (Accrual: POS cash/bank sales + Customer Credited product sales)
    const grossRevenueTotal = salesTotal + customerCreditSalesTotal;

    // Cash Realized / Cash Collections (POS sales + Customer Credit repayments collected)
    const totalCashCollected = salesTotal + customerCreditPaymentTotal;

    // Total Operating Expenses (Daily operating costs + payroll + stock loan payments)
    const totalOperatingExpenses = companyExpenseTotal + payrollTotal + stockLoanPaymentTotal;
    const totalMaterialCosts = supplierDeliveryCost;
    const totalCompanyCosts = totalOperatingExpenses + totalMaterialCosts;

    // Gross & Operating Net Profit (Accrual: including credited products sold)
    const grossProfit = grossRevenueTotal - totalMaterialCosts;
    const operatingNetIncome = grossRevenueTotal - totalCompanyCosts;

    // Net Cash Position Change (Cash Inflows - Cash Outflows)
    const netCashPositionChange = totalCashCollected - (companyExpenseTotal + stockLoanPaymentTotal + payrollTotal + ownerExpenseTotal);

    // Net Income after Owner Personal Expenses / Withdrawals
    const netIncomeAfterOwnerDrawings = operatingNetIncome - ownerExpenseTotal;

    const openingLeftoverQuantity = sessions.reduce((acc, s) => {
      const recs = s.leftoverRecords || [];
      return acc + recs.reduce((sum, r) => sum + (r.quantityRemaining || 0), 0);
    }, 0);


    // Build Daily Breakdown Map
    const dailyMap = new Map<string, any>();

    const getOrCreateDailyEntry = (dayKey: string) => {
      if (!dailyMap.has(dayKey)) {
        dailyMap.set(dayKey, {
          date: dayKey,
          sessionId: null,
          sessionStatus: null,
          yesterdayCashLeftover: 0,
          salesTotal: 0,
          creditReceivedFromLoan: 0,
          tomorrowCashLeftover: 0,
          dailyTotalRevenue: 0,
          companyExpenseTotal: 0,
          ownerExpenseTotal: 0,
          dailyNetIncome: 0,
          openingLeftoverQuantity: 0,
          customerCreditSalesTotal: 0,
          customerCreditPaymentTotal: 0,
          grossRevenueTotal: 0,
          totalCashCollected: 0,
          cashLeftoverTotal: 0,
          loanTotal: 0,
          supplierDeliveryCost: 0,
          stockLoanPaymentTotal: 0,
          payrollTotal: 0,
          operatingNetIncome: 0,
          netCashPositionChange: 0,
        });
      }
      return dailyMap.get(dayKey);
    };

    for (const s of sessions) {
      const dayKey = s.date.toISOString().slice(0, 10);
      const entry = getOrCreateDailyEntry(dayKey);
      entry.sessionId = s.id;
      entry.sessionStatus = s.status;

      let yesterdayCash = s.openingCashFloat != null ? Number(s.openingCashFloat) : 0;
      if (yesterdayCash === 0) {
        const prevClosed = allClosedSessions.find((cs) => cs.date < s.date);
        yesterdayCash = prevClosed?.cashLeftoverAmount != null
          ? Number(prevClosed.cashLeftoverAmount)
          : (prevClosed?.actualCashAmount != null ? Number(prevClosed.actualCashAmount) : 0);
      }
      entry.yesterdayCashLeftover = yesterdayCash;

      const salesSum = s.sales.reduce((t, x) => t + Number(x.totalAmount), 0);
      entry.salesTotal += salesSum;

      const tomorrowCash = s.cashLeftoverAmount != null ? Number(s.cashLeftoverAmount) : 0;
      entry.tomorrowCashLeftover = tomorrowCash;
      entry.cashLeftoverTotal += tomorrowCash;

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
      if (l.type === 'CUSTOMER') {
        entry.customerCreditSalesTotal += Number(l.totalAmount);
      }
    }

    for (const cp of customerLoanPayments) {
      const dayKey = cp.date ? new Date(cp.date).toISOString().slice(0, 10) : new Date(cp.createdAt).toISOString().slice(0, 10);
      const entry = getOrCreateDailyEntry(dayKey);
      entry.creditReceivedFromLoan += Number(cp.amountPaid);
      entry.customerCreditPaymentTotal += Number(cp.amountPaid);
    }

    for (const d of deliveries) {
      const dayKey = d.session?.date
        ? new Date(d.session.date).toISOString().slice(0, 10)
        : new Date(d.createdAt).toISOString().slice(0, 10);
      const entry = getOrCreateDailyEntry(dayKey);
      const netQty = Math.max(0, d.quantityReceived - (d.returnedQuantity || 0));
      entry.supplierDeliveryCost += Number(d.unitBuyPrice) * netQty;
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
      // Exact user formula: Yesterday Leftover + Sales Income + Credit Received - Tomorrow Leftover
      entry.dailyTotalRevenue = entry.yesterdayCashLeftover + entry.salesTotal + entry.creditReceivedFromLoan - entry.tomorrowCashLeftover;
      // Net Income: Total Revenue - Total Expense
      entry.dailyNetIncome = entry.dailyTotalRevenue - entry.companyExpenseTotal;

      entry.grossRevenueTotal = entry.salesTotal + entry.customerCreditSalesTotal;
      entry.totalCashCollected = entry.salesTotal + entry.customerCreditPaymentTotal;
      entry.operatingNetIncome = entry.dailyNetIncome;
      entry.netCashPositionChange = entry.totalCashCollected - (entry.companyExpenseTotal + entry.stockLoanPaymentTotal + entry.payrollTotal + entry.ownerExpenseTotal);
    }

    const rangeYesterdayCash = dailyBreakdown.length > 0 ? dailyBreakdown[0].yesterdayCashLeftover : 0;
    const rangeTomorrowCash = dailyBreakdown.length > 0 ? dailyBreakdown[dailyBreakdown.length - 1].tomorrowCashLeftover : 0;
    const totalCreditReceived = dailyBreakdown.reduce((sum, d) => sum + d.creditReceivedFromLoan, 0);
    const totalDailyRevenue = dailyBreakdown.reduce((sum, d) => sum + d.dailyTotalRevenue, 0);
    const totalDailyNetIncome = dailyBreakdown.reduce((sum, d) => sum + d.dailyNetIncome, 0);

    const totals = {
      // Exact formula fields:
      yesterdayLeftoverCash: rangeYesterdayCash,
      salesTotal,
      creditReceivedFromLoans: totalCreditReceived,
      tomorrowLeftoverCash: rangeTomorrowCash,
      dailyTotalRevenue: totalDailyRevenue,
      companyExpenseTotal,
      ownerExpenseTotal,
      dailyNetIncome: totalDailyNetIncome,

      // Compatibility & Extended reporting:
      openingLeftoverQuantity,
      customerCreditSalesTotal,
      customerCreditPaymentTotal,
      grossRevenueTotal,
      totalCashCollected,
      cashLeftoverTotal: rangeTomorrowCash || cashLeftoverTotal,
      loanTotal,
      employeeLoanTotal,
      supplierDeliveryCost,
      stockLoanPaymentTotal,
      payrollTotal,
      totalOperatingExpenses: companyExpenseTotal,
      totalExpense: companyExpenseTotal,
      totalExpenses: companyExpenseTotal,
      grossProfit: totalDailyRevenue - companyExpenseTotal,
      operatingNetIncome: totalDailyNetIncome,
      netIncome: totalDailyNetIncome,
      netCashPositionChange,
      netIncomeAfterOwnerDrawings: totalDailyNetIncome - ownerExpenseTotal,
      unpaidSupplierDeliveriesTotal,
      unpaidStockLoansTotal,
      totalPendingOwnerLiabilities,
      dailyTotalRevenueWithCredit: totalDailyRevenue + customerCreditSalesTotal,
      ownerExpenseWithLiabilities: ownerExpenseTotal + totalPendingOwnerLiabilities,
    };

    return {
      data: {
        branchId,
        from: fromDate.toISOString().slice(0, 10),
        to: toDate.toISOString().slice(0, 10),
        fromDate: fromDate.toISOString().slice(0, 10),
        toDate: toDate.toISOString().slice(0, 10),
        totals,
        salesTotal,
        yesterdayLeftoverCash: totals.yesterdayLeftoverCash,
        creditReceivedFromLoans: totals.creditReceivedFromLoans,
        tomorrowLeftoverCash: totals.tomorrowLeftoverCash,
        dailyTotalRevenue: totals.dailyTotalRevenue,
        dailyTotalRevenueWithCredit: totals.dailyTotalRevenueWithCredit,
        customerCreditSalesTotal,
        customerCreditPaymentTotal,
        grossRevenueTotal,
        totalCashCollected,
        cashLeftoverTotal: totals.tomorrowLeftoverCash || cashLeftoverTotal,
        companyExpenseTotal,
        ownerExpenseTotal,
        ownerExpenseWithLiabilities: totals.ownerExpenseWithLiabilities,
        unpaidSupplierDeliveriesTotal,
        unpaidStockLoansTotal,
        totalPendingOwnerLiabilities,
        loanTotal,
        employeeLoanTotal,
        supplierDeliveryCost,
        stockLoanPaymentTotal,
        payrollTotal,
        totalOperatingExpenses: companyExpenseTotal,
        totalExpense: companyExpenseTotal,
        totalExpenses: companyExpenseTotal,
        grossProfit: totals.grossProfit,
        operatingNetIncome: totals.dailyNetIncome,
        netIncome: totals.dailyNetIncome,
        netCashPositionChange,
        netIncomeAfterOwnerDrawings: totals.netIncomeAfterOwnerDrawings,
        dailyBreakdown,
        sessions,
        productionBatches,
        expenses,
        companyExpenses: expenses.filter(e => e.type === 'COMPANY'),
        ownerExpenses: expenses.filter(e => e.type === 'OWNER'),
        loans,
        customerLoans,
        employeeLoans,
        customerLoanPayments,
        supplierDeliveries: deliveries,
        unpaidSupplierDeliveries,
        unpaidStockLoans,
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

    const timestampStart = startOfDayUtc(fromDate);
    const timestampEnd = endOfDayUtc(toDate);

    const [expenses, allSupplierDeliveries, stockPurchasePayments, sessions, payrollRecords] = await Promise.all([
      prisma.expense.findMany({
        where: { branchId, date: { gte: fromDate, lte: toDate } },
        include: {
          user: { select: { id: true, fullName: true } },
          financialCategory: { select: { id: true, name: true, type: true } },
        },
        orderBy: { date: 'desc' },
      }),
      prisma.supplierDelivery.findMany({
        where: {
          AND: [
            {
              OR: [
                { supplier: { branchId } },
                { session: { branchId } },
              ],
            },
            {
              OR: [
                { createdAt: { gte: timestampStart, lte: timestampEnd } },
                { session: { date: { gte: fromDate, lte: toDate } } },
              ],
            },
          ],
        },
        include: {
          supplier: { select: { id: true, name: true, type: true } },
          product: { select: { id: true, name: true } },
          session: { select: { id: true, date: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.stockPurchasePayment.findMany({
        where: { loan: { branchId }, createdAt: { gte: timestampStart, lte: timestampEnd } },
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
      prisma.payrollRecord.findMany({
        where: {
          user: { branchId },
          status: { not: 'REJECTED' },
          OR: [
            { paymentDate: { gte: timestampStart, lte: timestampEnd } },
            { paymentDate: null, createdAt: { gte: timestampStart, lte: timestampEnd } },
          ],
        },
        include: { user: { select: { id: true, fullName: true, phone: true, role: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const companyExpenses = expenses.filter(e => e.type === 'COMPANY');
    const ownerExpenses = expenses.filter(e => e.type === 'OWNER');
    const companyExpenseTotal = companyExpenses.reduce((sum, e) => sum + Number(e.amount), 0);
    const ownerExpenseTotal = ownerExpenses.reduce((sum, e) => sum + Number(e.amount), 0);
    const supplierDeliveries = allSupplierDeliveries.filter((d) => d.paymentSource === 'DAILY_CASH');
    const supplierTotal = supplierDeliveries.reduce(
      (sum, d) => sum + Number(d.unitBuyPrice) * Math.max(0, d.quantityReceived - (d.returnedQuantity || 0)),
      0
    );
    const stockLoanTotal = stockPurchasePayments.reduce((sum, sp) => sum + Number(sp.amount), 0);
    const payrollTotal = payrollRecords.reduce((sum, p) => sum + Number(p.finalAmount), 0);
    const cashLeftoverTotal = sessions.reduce((sum, s) => sum + (s.cashLeftoverAmount ? Number(s.cashLeftoverAmount) : 0), 0);

    return {
      data: {
        fromDate: fromDate.toISOString().slice(0, 10),
        toDate: toDate.toISOString().slice(0, 10),
        companyExpenseTotal,
        ownerExpenseTotal,
        supplierTotal,
        stockLoanTotal,
        payrollTotal,
        cashLeftoverTotal,
        totalCompanyExpenses: companyExpenseTotal + supplierTotal + stockLoanTotal + payrollTotal,
        totalExpensed: companyExpenseTotal + ownerExpenseTotal + supplierTotal + stockLoanTotal + payrollTotal,
        expenses,
        companyExpenses,
        ownerExpenses,
        supplierDeliveries,
        allSupplierDeliveries,
        stockPurchasePayments,
        payrollRecords,
        cashLeftovers: sessions.filter(s => s.cashLeftoverAmount != null),
      },
    };
  }
}
