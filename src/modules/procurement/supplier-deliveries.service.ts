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
  async getSupplierDeliveries(supplierId?: string, branchId?: string, isPaid?: string, dateYmd?: string, sessionId?: string, limit: number = 50): ServiceResult {
    const where: any = {};
    if (supplierId) where.supplierId = supplierId;
    if (branchId) where.supplier = { branchId };
    if (sessionId) where.sessionId = sessionId;
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
    const { supplierId, isPaid, sessionId, items, paymentSource } = body;
    const finalPaymentSource = (paymentSource === 'OWNER' ? 'OWNER' : 'DAILY_CASH') as any;
    
    if (!supplierId) {
      return { error: 'supplierId is required', status: 400 };
    }

    let targetSessionId = typeof sessionId === 'string' ? sessionId : undefined;

    // Search for active session if targetSessionId not provided
    if (!targetSessionId && supplierId) {
      const supp = await prisma.supplier.findUnique({ where: { id: supplierId as string } });
      if (supp?.branchId) {
        const activeSess = await prisma.dailySession.findFirst({
          where: { branchId: supp.branchId, status: { in: ['OPEN', 'PAUSED'] } },
        });
        if (activeSess) targetSessionId = activeSess.id;
      }
    }

    // Handle Multi-Item creation
    if (Array.isArray(items) && items.length > 0) {
      const createdDeliveries = await prisma.$transaction(async (tx) => {
        const results = [];
        for (const item of items) {
          const { productId, quantityReceived, unitBuyPrice, unitSellPrice, returnedQuantity } = item;
          if (!productId || quantityReceived == null) continue;

          let sellPrice = unitSellPrice != null ? decimalToNum(unitSellPrice) : 0;
          if (!sellPrice && productId) {
            const p = await tx.product.findUnique({ where: { id: productId } });
            if (p) sellPrice = Number(p.basePrice);
          }

          const itemSource = (item.paymentSource === 'OWNER' || finalPaymentSource === 'OWNER') ? 'OWNER' : 'DAILY_CASH';
          const qty = typeof quantityReceived === 'number' ? quantityReceived : parseInt(String(quantityReceived), 10);
          const del = await tx.supplierDelivery.create({
            data: {
              supplierId: supplierId as string,
              productId: productId as string,
              sessionId: targetSessionId || null,
              quantityReceived: qty,
              unitBuyPrice: decimalToNum(unitBuyPrice || 0),
              unitSellPrice: sellPrice,
              isPaid: Boolean(isPaid),
              paymentSource: itemSource as any,
              returnedQuantity: returnedQuantity != null ? parseInt(String(returnedQuantity), 10) : 0,
            },
            include: { supplier: true, product: true },
          });
          results.push(del);
        }
        return results;
      });

      return { data: createdDeliveries };
    }

    // Single item fallback
    const { productId, quantityReceived, unitBuyPrice, unitSellPrice, returnedQuantity } = body;
    if (!productId || quantityReceived == null || unitBuyPrice == null) {
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
        sessionId: targetSessionId || null,
        quantityReceived: qty,
        unitBuyPrice: decimalToNum(unitBuyPrice),
        unitSellPrice: sellPrice,
        isPaid: Boolean(isPaid),
        paymentSource: finalPaymentSource,
        returnedQuantity: returnedQuantity != null ? parseInt(String(returnedQuantity), 10) : 0,
      },
      include: { supplier: true, product: true },
    });

    return { data: delivery };
  }

  async updateSupplierDelivery(id: string, body: { isPaid?: boolean; returnedQuantity?: number; paymentSource?: string }): ServiceResult {
    const { isPaid, returnedQuantity, paymentSource } = body;
    const delivery = await prisma.supplierDelivery.update({
      where: { id },
      data: {
        ...(isPaid !== undefined && { isPaid }),
        ...(returnedQuantity !== undefined && { returnedQuantity }),
        ...(paymentSource !== undefined && { paymentSource: paymentSource as any }),
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
