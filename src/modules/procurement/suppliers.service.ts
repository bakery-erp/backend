import { prisma } from '../../lib/prisma.js';
import type { ServiceResponse, ServiceResult } from '../../types/service-response.js';

import { decimalToNum } from '../../lib/decimal.js';

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
      include: {
        _count: { select: { deliveries: true } },
        deliveries: {
          select: {
            unitBuyPrice: true,
            quantityReceived: true,
            returnedQuantity: true,
            paidAmount: true,
            isPaid: true,
            paymentStatus: true,
          },
        },
      },
    });

    const enrichedList = list.map((s) => {
      const deliveries = s.deliveries || [];
      let totalPurchases = 0;
      let totalPaid = 0;
      let unpaidCount = 0;

      for (const d of deliveries) {
        const netQty = Math.max(0, d.quantityReceived - (d.returnedQuantity || 0));
        const cost = netQty * decimalToNum(d.unitBuyPrice);
        const paid = d.isPaid && decimalToNum(d.paidAmount) === 0 ? cost : decimalToNum(d.paidAmount);
        totalPurchases += cost;
        totalPaid += paid;
        if (!d.isPaid && d.paymentStatus !== 'PAID') {
          unpaidCount += 1;
        }
      }

      const totalBalanceDue = Math.max(0, totalPurchases - totalPaid);

      const { deliveries: _del, ...supplierWithoutDeliveries } = s;
      return {
        ...supplierWithoutDeliveries,
        stats: {
          totalDeliveries: deliveries.length,
          totalPurchases,
          totalPaid,
          totalBalanceDue,
          unpaidCount,
        },
      };
    });

    return { data: enrichedList };
  }

  async getSupplierById(id: string): ServiceResult {
    const supplier = await prisma.supplier.findUnique({
      where: { id },
      include: {
        branch: true,
        deliveries: {
          include: {
            product: true,
            payments: {
              orderBy: { createdAt: 'desc' },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!supplier) {
      return { error: 'Supplier not found', status: 404 };
    }

    const deliveries = supplier.deliveries || [];
    let totalPurchases = 0;
    let totalPaid = 0;
    let pendingCount = 0;
    let partialCount = 0;
    let paidCount = 0;

    for (const d of deliveries) {
      const netQty = Math.max(0, d.quantityReceived - (d.returnedQuantity || 0));
      const cost = Number((netQty * decimalToNum(d.unitBuyPrice)).toFixed(2));
      const paid = Number(decimalToNum(d.paidAmount || 0).toFixed(2));
      const rem = Math.max(0, Number((cost - paid).toFixed(2)));
      totalPurchases += cost;
      totalPaid += Math.min(cost, paid);
      if (cost > 0 && rem <= 0.001) {
        paidCount += 1;
      } else if (paid > 0) {
        partialCount += 1;
      } else {
        pendingCount += 1;
      }
    }

    const totalBalanceDue = Math.max(0, totalPurchases - totalPaid);

    return {
      data: {
        ...supplier,
        stats: {
          totalDeliveries: deliveries.length,
          totalPurchases,
          totalPaid,
          totalBalanceDue,
          paidCount,
          partialCount,
          pendingCount,
        },
      },
    };
  }

  async createSupplier(body: any, userBranchId?: string | null): ServiceResult {
    const { branchId, name, phone, contactPerson, address, notes, type } = body;
    const bid = branchId || userBranchId;

    if (!bid || !name?.trim() || !type) {
      return { error: 'branchId, name, type required', status: 400 };
    }

    const supplier = await prisma.supplier.create({
      data: {
        branchId: bid,
        name: name.trim(),
        phone: phone?.trim() || null,
        contactPerson: contactPerson?.trim() || null,
        address: address?.trim() || null,
        notes: notes?.trim() || null,
        type: type as any,
      },
    });
    return { data: supplier };
  }

  async updateSupplier(id: string, body: any): ServiceResult {
    const { name, phone, contactPerson, address, notes, type, branchId } = body;
    const supplier = await prisma.supplier.update({
      where: { id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(phone !== undefined && { phone: phone?.trim() || null }),
        ...(contactPerson !== undefined && { contactPerson: contactPerson?.trim() || null }),
        ...(address !== undefined && { address: address?.trim() || null }),
        ...(notes !== undefined && { notes: notes?.trim() || null }),
        ...(type !== undefined && { type: type as any }),
        ...(branchId !== undefined && { branchId }),
      },
    });
    return { data: supplier };
  }

  async deleteSupplier(id: string): ServiceResult {
    const deliveryCount = await prisma.supplierDelivery.count({ where: { supplierId: id } });
    if (deliveryCount > 0) {
      return {
        error: `Cannot delete supplier. They have ${deliveryCount} recorded delivery receipt(s). Please delete or reassign deliveries first.`,
        status: 400,
      };
    }
    await prisma.supplier.delete({ where: { id } });
    return { data: undefined };
  }
}

