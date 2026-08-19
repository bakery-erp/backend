import { prisma } from '../../lib/prisma.js';

export class PayrollRepository {
  async findManyByUser(userId: string) {
    return prisma.payrollRecord.findMany({
      where: { userId },
      include: { user: { select: { id: true, fullName: true, phone: true, role: true } } },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
  }

  async findMany(userId?: string, month?: number, year?: number) {
    const where: any = {};
    if (userId) where.userId = userId;
    if (month) where.month = month;
    if (year) where.year = year;
    return prisma.payrollRecord.findMany({
      where,
      include: { user: { select: { id: true, fullName: true, phone: true, role: true } } },
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
  }

  async findById(id: string) {
    return prisma.payrollRecord.findUnique({
      where: { id },
      include: { user: { select: { id: true, fullName: true, phone: true, role: true } } },
    });
  }

  async create(data: any) {
    return prisma.payrollRecord.create({
      data,
      include: { user: { select: { id: true, fullName: true, phone: true, role: true } } },
    });
  }

  async update(id: string, data: any) {
    return prisma.payrollRecord.update({
      where: { id },
      data,
      include: { user: { select: { id: true, fullName: true, phone: true } } },
    });
  }
}
