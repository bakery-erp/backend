import { prisma } from '../../lib/prisma.js';

export class FinancialReportsRepository {
  async findSessionsByDateRange(branchId: string, fromDate: Date, toDate: Date) {
    return prisma.dailySession.findMany({
      where: { branchId, date: { gte: fromDate, lte: toDate } },
      include: {
        sales: { include: { items: { include: { product: true } } } },
        leftoverRecords: { include: { product: true } },
      },
      orderBy: { date: 'asc' },
    });
  }

  async findExpensesByDateRange(branchId: string, fromDate: Date, toDate: Date) {
    return prisma.expense.findMany({
      where: { branchId, date: { gte: fromDate, lte: toDate } },
    });
  }

  async findLoansByDateRange(branchId: string, fromDate: Date, toDate: Date) {
    return prisma.loan.findMany({
      where: { branchId, date: { gte: fromDate, lte: toDate } },
    });
  }

  async findSupplierDeliveriesByDateRange(branchId: string, fromDate: Date, toDate: Date) {
    return prisma.supplierDelivery.findMany({
      where: {
        AND: [
          { OR: [{ supplier: { branchId } }, { session: { branchId } }] },
          { OR: [{ createdAt: { gte: fromDate, lte: toDate } }, { session: { date: { gte: fromDate, lte: toDate } } }] },
        ],
      },
    });
  }

  async findPayrollByDateRange(branchId: string, fromDate: Date, toDate: Date) {
    return prisma.payrollRecord.findMany({
      where: { user: { branchId }, paymentDate: { gte: fromDate, lte: toDate } },
    });
  }
}
