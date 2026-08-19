import { prisma } from '../../lib/prisma.js';

export class StockItemsRepository {
  async findMany(branchId: string) {
    return prisma.stockItem.findMany({
      where: { branchId },
      orderBy: { name: 'asc' },
    });
  }

  async findById(id: string) {
    return prisma.stockItem.findUnique({
      where: { id },
      include: { branch: { select: { id: true, name: true } } },
    });
  }

  async create(data: any) {
    return prisma.stockItem.create({ data });
  }

  async update(id: string, data: any) {
    return prisma.stockItem.update({ where: { id }, data });
  }

  async findByIdForUpdate(id: string) {
    return prisma.stockItem.findUnique({
      where: { id },
      select: { id: true, currentQuantity: true },
    });
  }

  async updateQuantity(id: string, quantity: number) {
    return prisma.stockItem.update({
      where: { id },
      data: { currentQuantity: quantity },
    });
  }
}
