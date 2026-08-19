import { prisma } from '../../lib/prisma.js';

export class AnalyticsRepository {
  async findSessionsByDateRange(branchId: string, startDate: Date, endDate: Date) {
    return prisma.dailySession.findMany({
      where: { branchId, date: { gte: startDate, lte: endDate } },
      include: { sales: true, leftoverRecords: true },
    });
  }

  async findSessionsByDate(branchId: string, date: Date) {
    return prisma.dailySession.findMany({
      where: { branchId, date },
      include: { sales: true, leftoverRecords: true },
    });
  }

  async findExpensesByDateRange(branchId: string, startDate: Date, endDate: Date, type?: string) {
    const where: any = { branchId, date: { gte: startDate, lte: endDate } };
    if (type) where.type = type;
    return prisma.expense.findMany({ where });
  }

  async findExpensesByDate(branchId: string, date: Date, type?: string) {
    const where: any = { branchId, date };
    if (type) where.type = type;
    return prisma.expense.findMany({ where });
  }

  async countProductionBatches(branchId: string, date: Date) {
    return prisma.productionBatch.count({ where: { branchId, date } });
  }

  async findSupplierDeliveriesByDateRange(branchId: string, startDate: Date, endDate: Date) {
    return prisma.supplierDelivery.findMany({
      where: { supplier: { branchId }, createdAt: { gte: startDate, lte: endDate } },
    });
  }
}
