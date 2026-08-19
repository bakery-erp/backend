import { prisma } from '../../lib/prisma.js';

export class LoansRepository {
  async findManyByUser(userId: string) {
    return prisma.loan.findMany({
      where: { userId },
      include: { user: { select: { id: true, fullName: true, phone: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findMany(branchId: string, type?: string, status?: string, fromDate?: Date, toDate?: Date) {
    const where: any = { branchId };
    if (type) where.type = type;
    if (status) where.status = status;
    if (fromDate || toDate) {
      where.date = {};
      if (fromDate) where.date.gte = fromDate;
      if (toDate) where.date.lte = toDate;
    }
    return prisma.loan.findMany({
      where,
      include: { user: { select: { id: true, fullName: true, phone: true, role: true } }, payments: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string) {
    return prisma.loan.findUnique({
      where: { id },
      include: { user: { select: { id: true, fullName: true, phone: true, role: true } }, payments: true },
    });
  }

  async create(data: any) {
    return prisma.loan.create({
      data,
      include: { user: { select: { id: true, fullName: true, phone: true } }, payments: true },
    });
  }

  async update(id: string, data: any) {
    return prisma.loan.update({
      where: { id },
      data,
      include: { payments: true, user: { select: { id: true, fullName: true, phone: true } } },
    });
  }

  async delete(id: string) {
    await prisma.loanPayment.deleteMany({ where: { loanId: id } });
    return prisma.loan.delete({ where: { id } });
  }
}
