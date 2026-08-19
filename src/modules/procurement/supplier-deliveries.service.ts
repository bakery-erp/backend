import { prisma } from '../../lib/prisma.js';
import { utcDayRangeInclusive } from '../../lib/businessDate.js';
import type { ServiceResponse, ServiceResult } from '../../types/service-response.js';

function decimalToNum(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseFloat(v);
  return 0;
}

export class SupplierDeliveriesService {
  async getSupplierDeliveries(supplierId?: string, branchId?: string, isPaid?: string, dateYmd?: string, limit: number = 50): ServiceResult {
    const where: any = {};
    if (supplierId) where.supplierId = supplierId;
    if (branchId) where.supplier = { branchId };
    if (isPaid !== undefined) where.isPaid = isPaid === 'true';
    if (dateYmd) {
      const range = utcDayRangeInclusive(dateYmd);
      if (range) {
        where.createdAt = { gte: range.start, lte: range.end };
      }
    }
    const list = await prisma.supplierDelivery.findMany({
      where,
      include: { supplier: true, product: true },
      orderBy: { createdAt: 'desc' },
      take: dateYmd ? 500 : limit,
    });
    return { data: list };
  }

  async getSupplierDeliveryById(id: string): ServiceResult {
    const delivery = await prisma.supplierDelivery.findUnique({
      where: { id },
      include: { supplier: true, product: true },
    });
    if (!delivery) {
      return { error: 'Delivery not found', status: 404 };
    }
    return { data: delivery };
  }

  async createSupplierDelivery(body: Record<string, unknown>, userId: string): ServiceResult {
    const { supplierId, productId, quantityReceived, unitBuyPrice, unitSellPrice, isPaid, returnedQuantity } = body;
    
    if (!supplierId || !productId || quantityReceived == null || unitBuyPrice == null) {
      return { error: 'supplierId, productId, quantityReceived, unitBuyPrice required', status: 400 };
    }

    let sellPrice = unitSellPrice != null ? decimalToNum(unitSellPrice) : 0;
    if (!sellPrice && productId) {
      const p = await prisma.product.findUnique({ where: { id: productId as string } });
      if (p) sellPrice = Number(p.basePrice);
    }

    const qty = typeof quantityReceived === 'number' ? quantityReceived : parseInt(String(quantityReceived), 10);
    const delivery = await prisma.supplierDelivery.create({
      data: {
        supplierId: supplierId as string,
        productId: productId as string,
        quantityReceived: qty,
        unitBuyPrice: decimalToNum(unitBuyPrice),
        unitSellPrice: sellPrice,
        isPaid: Boolean(isPaid),
        returnedQuantity: returnedQuantity != null ? parseInt(String(returnedQuantity), 10) : 0,
      },
      include: { supplier: true, product: true },
    });

    return { data: delivery };
  }

  async updateSupplierDelivery(id: string, body: { isPaid?: boolean; returnedQuantity?: number }): ServiceResult {
    const { isPaid, returnedQuantity } = body;
    const delivery = await prisma.supplierDelivery.update({
      where: { id },
      data: {
        ...(isPaid !== undefined && { isPaid }),
        ...(returnedQuantity !== undefined && { returnedQuantity }),
      },
      include: { supplier: true, product: true },
    });
    return { data: delivery };
  }

  async deleteSupplierDelivery(id: string, userId: string): ServiceResult {
    const delivery = await prisma.supplierDelivery.findUnique({
      where: { id },
    });
    if (!delivery) {
      return { error: 'Delivery not found', status: 404 };
    }

    await prisma.supplierDelivery.delete({ where: { id } });
    return { data: undefined };
  }
}
