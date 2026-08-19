import { prisma } from '../../lib/prisma.js';

const expenseInclude = {
  user: { select: { id: true, fullName: true } as const },
  financialCategory: { select: { id: true, name: true, type: true } },
};

export class ExpensesRepository {
  async findMany(branchId: string, from?: Date, to?: Date, category?: string) {
    const where: Record<string, unknown> = { branchId };
    if (category) where.category = category;
    if (from || to) {
      where.date = {};
      if (from) (where.date as Record<string, Date>).gte = from;
      if (to) (where.date as Record<string, Date>).lte = to;
    }
    return prisma.expense.findMany({
      where,
      include: expenseInclude,
      orderBy: { date: 'desc' },
    });
  }

  async findById(id: string) {
    return prisma.expense.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, fullName: true, phone: true } },
        financialCategory: { select: { id: true, name: true, type: true } },
      },
    });
  }

  async create(data: any) {
    return prisma.expense.create({
      data,
      include: expenseInclude,
    });
  }

  async update(id: string, data: any) {
    return prisma.expense.update({
      where: { id },
      data,
      include: expenseInclude,
    });
  }

  async delete(id: string) {
    return prisma.expense.delete({ where: { id } });
  }
}
