import { prisma } from '../../lib/prisma.js';

export class BranchesRepository {
  async findMany() {
    return prisma.branch.findMany({ orderBy: { name: 'asc' } });
  }

  async findById(id: string) {
    return prisma.branch.findUnique({
      where: { id },
      include: { users: { select: { id: true, fullName: true, phone: true, role: true } } },
    });
  }

  async create(data: { name: string; address?: string; companyId: string }) {
    return prisma.branch.create({ data });
  }

  async update(id: string, data: { name?: string; address?: string; isActive?: boolean }) {
    return prisma.branch.update({ where: { id }, data });
  }
}
