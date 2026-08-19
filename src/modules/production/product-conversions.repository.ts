import { prisma } from '../../lib/prisma.js';

export class ProductConversionsRepository {
  async findMany(branchId?: string, limit: number = 50) {
    const where = branchId ? { branchId } : {};
    return prisma.productConversion.findMany({
      where,
      include: {
        fromProduct: { select: { id: true, name: true, flavor: true } },
        toProduct: { select: { id: true, name: true, flavor: true } },
        user: { select: { id: true, fullName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async findById(id: string) {
    return prisma.productConversion.findUnique({
      where: { id },
      include: {
        fromProduct: { select: { id: true, name: true, flavor: true } },
        toProduct: { select: { id: true, name: true, flavor: true } },
        user: { select: { id: true, fullName: true } },
      },
    });
  }

  async create(data: any) {
    return prisma.productConversion.create({
      data,
      include: {
        fromProduct: true,
        toProduct: true,
        user: { select: { id: true, fullName: true } },
      },
    });
  }

  async delete(id: string) {
    return prisma.productConversion.delete({ where: { id } });
  }
}
