import { prisma } from '../../lib/prisma.js';

export class PenaltiesRepository {
  async findManyByUser(userId: string) {
    return prisma.penalty.findMany({
      where: { userId },
      include: { user: { select: { id: true, fullName: true, phone: true } } },
      orderBy: { date: 'desc' },
    });
  }

  async findMany(userId?: string, isDeducted?: boolean) {
    const where: any = {};
    if (userId) where.userId = userId;
    if (isDeducted !== undefined) where.isDeducted = isDeducted;
    return prisma.penalty.findMany({
      where,
      include: { user: { select: { id: true, fullName: true, phone: true, role: true } } },
      orderBy: { date: 'desc' },
    });
  }

  async create(data: any) {
    return prisma.penalty.create({
      data,
      include: { user: { select: { id: true, fullName: true, phone: true } } },
    });
  }

  async update(id: string, data: any) {
    return prisma.penalty.update({
      where: { id },
      data,
      include: { user: { select: { id: true, fullName: true, phone: true } } },
    });
  }
}
