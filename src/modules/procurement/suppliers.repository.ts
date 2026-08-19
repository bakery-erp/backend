import { prisma } from '../../lib/prisma.js';

export class SuppliersRepository {
  async findMany(branchId: string, type?: string) {
    const where: any = { branchId };
    if (type) where.type = type;
    return prisma.supplier.findMany({
      where,
      orderBy: { name: 'asc' },
      include: { _count: { select: { deliveries: true } } },
    });
  }

  async findById(id: string) {
    return prisma.supplier.findUnique({
      where: { id },
      include: { branch: true, deliveries: { include: { product: true }, orderBy: { createdAt: 'desc' }, take: 50 } },
    });
  }

  async create(data: any) {
    return prisma.supplier.create({ data });
  }

  async update(id: string, data: any) {
    return prisma.supplier.update({ where: { id }, data });
  }

  async countDeliveries(supplierId: string) {
    return prisma.supplierDelivery.count({ where: { supplierId } });
  }

  async delete(id: string) {
    return prisma.supplier.delete({ where: { id } });
  }
}
