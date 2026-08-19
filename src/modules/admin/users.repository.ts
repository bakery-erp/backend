import { prisma } from '../../lib/prisma.js';

const userSelect = {
  id: true,
  fullName: true,
  phone: true,
  role: true,
  branchId: true,
  isActive: true,
  createdAt: true,
  salary: true,
  startDate: true,
  lastPaidDate: true,
  shift: true,
  filesUrl: true,
} as const;

export class UsersRepository {
  async findMany(branchId?: string) {
    const where = branchId ? { branchId } : {};
    return prisma.user.findMany({
      where,
      select: { ...userSelect, branch: { select: { name: true } } },
      orderBy: { fullName: 'asc' },
    });
  }

  async findById(id: string) {
    return prisma.user.findUnique({
      where: { id },
      select: { ...userSelect, branch: true },
    });
  }

  async findByPhone(phone: string) {
    return prisma.user.findUnique({
      where: { phone },
    });
  }

  async create(data: any) {
    return prisma.user.create({
      data,
      select: { ...userSelect, branch: { select: { name: true } } },
    });
  }

  async update(id: string, data: any) {
    return prisma.user.update({
      where: { id },
      data,
      select: { ...userSelect, branch: { select: { name: true } } },
    });
  }
}
