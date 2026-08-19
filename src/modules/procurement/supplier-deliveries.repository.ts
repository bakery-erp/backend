import { prisma } from '../../lib/prisma.js';

export class SupplierDeliveriesRepository {
  async findMany(supplierId?: string, branchId?: string, isPaid?: boolean, dateRange?: { start: Date; end: Date }, limit: number = 50) {
    const where: any = {};
    if (supplierId) where.supplierId = supplierId;
    if (branchId) where.supplier = { branchId };
    if (isPaid !== undefined) where.isPaid = isPaid;
    if (dateRange) where.createdAt = { gte: dateRange.start, lte: dateRange.end };

    return prisma.supplierDelivery.findMany({
      where,
      include: { supplier: true, product: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async findById(id: string) {
    return prisma.supplierDelivery.findUnique({
      where: { id },
      include: { supplier: true, product: true },
    });
  }

  async create(data: any) {
    return prisma.supplierDelivery.create({
      data,
      include: { supplier: true, product: true },
    });
  }

  async update(id: string, data: any) {
    return prisma.supplierDelivery.update({
      where: { id },
      data,
      include: { supplier: true, product: true },
    });
  }

  async delete(id: string) {
    return prisma.supplierDelivery.delete({ where: { id } });
  }
}
