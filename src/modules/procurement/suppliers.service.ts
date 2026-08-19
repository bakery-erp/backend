import { prisma } from '../../lib/prisma.js';
import type { ServiceResponse, ServiceResult } from '../../types/service-response.js';

export class SuppliersService {
  async getSuppliers(branchId?: string | null, type?: string): ServiceResult {
    if (!branchId) {
      return { error: 'branchId required', status: 400 };
    }
    const where: any = { branchId };
    if (type) where.type = type;
    const list = await prisma.supplier.findMany({
      where,
      orderBy: { name: 'asc' },
      include: { _count: { select: { deliveries: true } } },
    });
    return { data: list };
  }

  async getSupplierById(id: string): ServiceResult {
    const supplier = await prisma.supplier.findUnique({
      where: { id },
      include: { branch: true, deliveries: { include: { product: true }, orderBy: { createdAt: 'desc' }, take: 50 } },
    });
    if (!supplier) {
      return { error: 'Supplier not found', status: 404 };
    }
    return { data: supplier };
  }

  async createSupplier(body: any, userBranchId?: string | null): ServiceResult {
    const { branchId, name, phone, type } = body;
    const bid = branchId || userBranchId;

    if (!bid || !name?.trim() || !type) {
      return { error: 'branchId, name, type required', status: 400 };
    }

    const supplier = await prisma.supplier.create({
      data: { branchId: bid, name: name.trim(), phone: phone?.trim() || null, type: type as any },
    });
    return { data: supplier };
  }

  async updateSupplier(id: string, body: any): ServiceResult {
    const { name, phone, type } = body;
    const supplier = await prisma.supplier.update({
      where: { id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(phone !== undefined && { phone: phone?.trim() || null }),
        ...(type !== undefined && { type: type as any }),
      },
    });
    return { data: supplier };
  }

  async deleteSupplier(id: string): ServiceResult {
    const deliveryCount = await prisma.supplierDelivery.count({ where: { supplierId: id } });
    if (deliveryCount > 0) {
      return { error: 'Cannot delete a supplier that still has deliveries', status: 400 };
    }
    await prisma.supplier.delete({ where: { id } });
    return { data: undefined };
  }
}
