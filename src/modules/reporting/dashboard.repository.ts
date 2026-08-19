import { prisma } from '../../lib/prisma.js';

export class DashboardRepository {
  async countOpenSessions(branchId?: string) {
    const where = branchId ? { branchId, status: 'OPEN' as const } : { status: 'OPEN' as const };
    return prisma.dailySession.count({ where });
  }

  async aggregateTodaySales(startDate: Date, endDate: Date, branchId?: string) {
    return prisma.sale.aggregate({
      where: {
        createdAt: { gte: startDate, lt: endDate },
        ...(branchId ? { session: { branchId } } : {}),
      },
      _sum: { totalAmount: true },
    });
  }

  async countUnpaidDeliveries(branchId?: string) {
    return prisma.supplierDelivery.aggregate({
      where: { isPaid: false, ...(branchId ? { supplier: { branchId } } : {}) },
      _count: { id: true },
    });
  }

  async countOutOfStock(branchId?: string) {
    return prisma.stockItem.count({
      where: {
        ...(branchId ? { branchId } : {}),
        currentQuantity: { lte: 0 },
      },
    });
  }
}
