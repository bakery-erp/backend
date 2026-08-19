import { prisma } from '../../lib/prisma.js';

export class StockMovementsRepository {
  async findMany(branchId?: string, stockItemId?: string, limit: number = 50) {
    const stockWhere = branchId ? { branchId } : {};
    const where: any = { user: { isActive: true } };
    if (stockItemId) where.stockItemId = stockItemId;
    else where.stockItem = stockWhere;

    return prisma.stockMovement.findMany({
      where,
      include: { 
        stockItem: { select: { id: true, name: true, unitType: true } }, 
        user: { select: { id: true, fullName: true } } 
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async findById(id: string) {
    return prisma.stockMovement.findUnique({
      where: { id },
      include: { 
        stockItem: true, 
        user: { select: { id: true, fullName: true, phone: true } } 
      },
    });
  }

  async create(data: any) {
    return prisma.stockMovement.create({
      data,
      include: { 
        stockItem: true, 
        user: { select: { id: true, fullName: true } } 
      },
    });
  }
}
