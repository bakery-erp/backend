import { prisma } from '../../lib/prisma.js';

export class DailySessionsRepository {
  async findMany(branchId: string, fromDate?: Date, toDate?: Date, status?: string) {
    const where: any = { branchId };
    if (status) where.status = status;
    if (fromDate || toDate) {
      where.date = {};
      if (fromDate) where.date.gte = fromDate;
      if (toDate) where.date.lte = toDate;
    }
    return prisma.dailySession.findMany({
      where,
      include: {
        _count: { select: { sales: true, leftoverRecords: true } },
      },
      orderBy: { date: 'desc' },
    });
  }

  async findById(id: string) {
    return prisma.dailySession.findUnique({
      where: { id },
      include: {
        branch: true,
        sales: { include: { user: true, items: { include: { product: true } } } },
        leftoverRecords: { include: { product: true } },
      },
    });
  }

  async findFirst(where: any, include?: any) {
    return prisma.dailySession.findFirst({ where, include });
  }

  async create(data: any) {
    return prisma.dailySession.create({ data });
  }

  async update(id: string, data: any) {
    return prisma.dailySession.update({ where: { id }, data });
  }

  async delete(id: string) {
    return prisma.dailySession.delete({ where: { id } });
  }

  async findPreviousClosed(branchId: string, date: Date) {
    return prisma.dailySession.findFirst({
      where: {
        branchId,
        status: 'CLOSED',
        date: { lt: date },
      },
      include: { leftoverRecords: true },
      orderBy: { date: 'desc' },
    });
  }

  async findProductionBatches(branchId: string, date: Date) {
    return prisma.productionBatch.findMany({
      where: { branchId, date },
      include: { items: { include: { product: true } } },
    });
  }

  async findSupplierDeliveries(branchId: string, startDate: Date, endDate: Date) {
    return prisma.supplierDelivery.findMany({
      where: {
        supplier: { branchId },
        createdAt: { gte: startDate, lte: endDate },
      },
    });
  }

  async findProductsByIds(ids: string[]) {
    return prisma.product.findMany({ where: { id: { in: ids } } });
  }
}
