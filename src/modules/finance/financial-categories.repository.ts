import { prisma } from '../../lib/prisma.js';

export class FinancialCategoriesRepository {
  async findMany(type?: 'REVENUE' | 'EXPENSE') {
    const where = type ? { type } : {};
    return prisma.financialCategory.findMany({
      where,
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { products: true, expenses: true } } },
    });
  }

  async findById(id: string) {
    return prisma.financialCategory.findUnique({
      where: { id },
      include: { _count: { select: { products: true, expenses: true } } },
    });
  }

  async create(data: { name: string; type: 'REVENUE' | 'EXPENSE' }) {
    return prisma.financialCategory.create({ data });
  }

  async update(id: string, data: { name?: string; type?: 'REVENUE' | 'EXPENSE' }) {
    return prisma.financialCategory.update({ where: { id }, data });
  }

  async delete(id: string) {
    return prisma.financialCategory.delete({ where: { id } });
  }
}
