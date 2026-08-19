import { prisma } from '../../lib/prisma.js';

export class SalesRepository {
  async findMany(sessionId?: string, branchId?: string, limit: number = 50) {
    const where: Record<string, unknown> = {};
    if (sessionId) where.sessionId = sessionId;
    if (branchId) where.session = { branchId };
    return prisma.sale.findMany({
      where,
      include: {
        session: { select: { id: true, date: true, branchId: true } },
        user: { select: { id: true, fullName: true } },
        items: { include: { product: { select: { id: true, name: true, flavor: true, unitType: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async findById(id: string) {
    return prisma.sale.findUnique({
      where: { id },
      include: {
        session: { select: { id: true, date: true, branchId: true, status: true } },
        user: { select: { id: true, fullName: true, phone: true } },
        items: { include: { product: true } },
      },
    });
  }

  async create(data: any) {
    return prisma.sale.create({
      data,
      include: {
        session: { select: { id: true, date: true, branchId: true } },
        user: { select: { id: true, fullName: true } },
        items: { include: { product: true } },
      },
    });
  }
}
