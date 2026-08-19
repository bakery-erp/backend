import { prisma } from '../../lib/prisma.js';

export class ProductionBatchesRepository {
  async findMany(branchId: string, date?: Date, status?: string) {
    const where: any = { branchId };
    if (status) where.status = status;
    if (date) where.date = date;

    return prisma.productionBatch.findMany({
      where,
      include: {
        user: { select: { id: true, fullName: true } },
        items: { include: { product: { select: { id: true, name: true, unitType: true, basePrice: true } } } },
        materialUsages: { include: { stockItem: { select: { id: true, name: true, unitType: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string) {
    return prisma.productionBatch.findUnique({
      where: { id },
      include: {
        branch: true,
        user: true,
        items: { include: { product: true } },
        materialUsages: { include: { stockItem: true } },
      },
    });
  }

  async create(data: any) {
    return prisma.productionBatch.create({
      data,
      include: {
        user: { select: { id: true, fullName: true } },
        items: { include: { product: true } },
        materialUsages: { include: { stockItem: true } },
      },
    });
  }

  async update(id: string, data: any) {
    return prisma.productionBatch.update({
      where: { id },
      data,
      include: {
        user: { select: { id: true, fullName: true } },
        items: { include: { product: true } },
        materialUsages: { include: { stockItem: true } },
      },
    });
  }
}
