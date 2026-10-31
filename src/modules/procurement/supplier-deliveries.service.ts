import { prisma } from '../../lib/prisma.js';
import { Role } from '@prisma/client';
import { utcDayRangeInclusive } from '../../lib/businessDate.js';
import { parsePagination, buildPaginatedResponse } from '../../lib/pagination.js';
import type { ServiceResponse, ServiceResult } from '../../types/service-response.js';
import { notificationsService } from '../notifications/notifications.service.js';

function decimalToNum(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseFloat(v);
  return 0;
}

export class SupplierDeliveriesService {
  async getSupplierDeliveries(params: {
    supplierId?: string;
    branchId?: string;
    isPaid?: string;
    paymentStatus?: string;
    dateYmd?: string;
    sessionId?: string;
    page?: number;
    limit?: number;
  }): ServiceResult {
    const { supplierId, branchId, isPaid, paymentStatus, dateYmd, sessionId, page, limit } = params;
    const where: any = {};
    if (supplierId) where.supplierId = supplierId;
    if (branchId) where.supplier = { branchId };
    if (sessionId) where.sessionId = sessionId;
    if (paymentStatus && paymentStatus !== 'ALL') {
      if (paymentStatus === 'UNPAID' || paymentStatus === 'PENDING') {
        where.paymentStatus = { in: ['PENDING', 'PARTIAL'] };
      } else {
        where.paymentStatus = paymentStatus;
      }
    } else if (isPaid !== undefined) {
      where.isPaid = isPaid === 'true';
    }

    if (dateYmd) {
      const range = utcDayRangeInclusive(dateYmd);
      if (range) {
        where.createdAt = { gte: range.start, lte: range.end };
      }
    }

    const findArgs: any = {
      where,
      include: {
        supplier: true,
        product: true,
        payments: {
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    };

    if (page != null && limit != null) {
      findArgs.skip = (page - 1) * limit;
      findArgs.take = limit;
    } else if (limit) {
      findArgs.take = limit;
    } else {
      findArgs.take = 50;
    }

    const [total, allDeliveriesForStats, list] = await Promise.all([
      prisma.supplierDelivery.count({ where }),
      prisma.supplierDelivery.findMany({
        where,
        select: {
          unitBuyPrice: true,
          quantityReceived: true,
          returnedQuantity: true,
          paidAmount: true,
          isPaid: true,
          paymentStatus: true,
        },
      }),
      prisma.supplierDelivery.findMany(findArgs),
    ]);

    let totalAmount = 0;
    let totalPaidAmount = 0;

    for (const d of allDeliveriesForStats) {
      const netQty = Math.max(0, d.quantityReceived - (d.returnedQuantity || 0));
      const cost = netQty * decimalToNum(d.unitBuyPrice);
      const paid = d.isPaid && decimalToNum(d.paidAmount) === 0 ? cost : decimalToNum(d.paidAmount);
      totalAmount += cost;
      totalPaidAmount += paid;
    }

    const totalUnpaidAmount = Math.max(0, totalAmount - totalPaidAmount);

    const stats = {
      totalDeliveries: total,
      totalAmount,
      totalPaidAmount,
      totalUnpaidAmount,
    };

    if (page != null && limit != null) {
      return {
        data: {
          ...buildPaginatedResponse(list, total, page, limit),
          stats,
        },
      };
    }

    return { data: list };
  }

  async getSupplierDeliveryById(id: string): ServiceResult {
    const delivery = await prisma.supplierDelivery.findUnique({
      where: { id },
      include: {
        supplier: true,
        product: true,
        payments: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!delivery) {
      return { error: 'Delivery not found', status: 404 };
    }
    return { data: delivery };
  }

  async createSupplierDelivery(body: Record<string, unknown>, userId: string): ServiceResult {
    const { supplierId, isPaid, sessionId, items, paymentSource, amountPaidNow, notes } = body;
    const finalPaymentSource = (paymentSource === 'OWNER' ? 'OWNER' : 'DAILY_CASH') as any;

    if (!supplierId) {
      return { error: 'supplierId is required', status: 400 };
    }

    let targetSessionId = typeof sessionId === 'string' ? sessionId : undefined;
    const supp = await prisma.supplier.findUnique({ where: { id: supplierId as string } });
    const targetBranchId = (body.branchId as string) || supp?.branchId || null;

    if (!targetSessionId && supp?.branchId) {
      const activeSess = await prisma.dailySession.findFirst({
        where: { branchId: supp.branchId, status: { in: ['OPEN', 'PAUSED'] } },
      });
      if (activeSess) targetSessionId = activeSess.id;
    }

    // Handle Multi-Item creation
    if (Array.isArray(items) && items.length > 0) {
      const validItems = items.filter((i) => i.productId && Number(i.quantityReceived) > 0);
      if (validItems.length === 0) {
        return { error: 'At least one valid item is required', status: 400 };
      }

      // Calculate total cost of entire batch
      let totalBatchCost = 0;
      for (const item of validItems) {
        const qty = typeof item.quantityReceived === 'number' ? item.quantityReceived : parseInt(String(item.quantityReceived), 10);
        const retQty = item.returnedQuantity != null ? parseInt(String(item.returnedQuantity), 10) : 0;
        const netQty = Math.max(0, qty - retQty);
        totalBatchCost += netQty * decimalToNum(item.unitBuyPrice || 0);
      }

      // Determine batch payment allocation
      let remainingBatchPayment = amountPaidNow != null ? Math.max(0, decimalToNum(amountPaidNow)) : (isPaid ? totalBatchCost : 0);

      const createdDeliveries = await prisma.$transaction(async (tx) => {
        const results = [];
        for (const item of validItems) {
          const { productId, quantityReceived, unitBuyPrice, unitSellPrice, returnedQuantity, notes: itemNotes } = item;

          let sellPrice = unitSellPrice != null ? decimalToNum(unitSellPrice) : 0;
          if (!sellPrice && productId) {
            const p = await tx.product.findUnique({ where: { id: productId } });
            if (p) sellPrice = Number(p.basePrice);
          }

          const itemSource = (item.paymentSource === 'OWNER' || finalPaymentSource === 'OWNER') ? 'OWNER' : 'DAILY_CASH';
          const qty = typeof quantityReceived === 'number' ? quantityReceived : parseInt(String(quantityReceived), 10);
          const retQty = returnedQuantity != null ? parseInt(String(returnedQuantity), 10) : 0;
          const netQty = Math.max(0, qty - retQty);
          const itemCost = netQty * decimalToNum(unitBuyPrice || 0);

          let itemPaid = 0;
          if (item.paidAmount != null) {
            itemPaid = Math.min(itemCost, Math.max(0, decimalToNum(item.paidAmount)));
          } else if (remainingBatchPayment > 0) {
            itemPaid = Math.min(itemCost, remainingBatchPayment);
            remainingBatchPayment -= itemPaid;
          } else if (isPaid) {
            itemPaid = itemCost;
          }

          let itemStatus: 'PENDING' | 'PARTIAL' | 'PAID' = 'PENDING';
          let itemIsPaid = false;
          if (itemCost === 0 || itemPaid >= itemCost) {
            itemStatus = 'PAID';
            itemIsPaid = true;
          } else if (itemPaid > 0) {
            itemStatus = 'PARTIAL';
            itemIsPaid = false;
          }

          const del = await tx.supplierDelivery.create({
            data: {
              supplierId: supplierId as string,
              productId: productId as string,
              sessionId: targetSessionId || null,
              quantityReceived: qty,
              returnedQuantity: retQty,
              unitBuyPrice: decimalToNum(unitBuyPrice || 0),
              unitSellPrice: sellPrice,
              paidAmount: itemPaid,
              paymentStatus: itemStatus,
              isPaid: itemIsPaid,
              paymentSource: itemSource as any,
              notes: (itemNotes || notes || null) as string | null,
            },
            include: {
              supplier: true,
              product: true,
              payments: true,
            },
          });

          if (itemPaid > 0) {
            await tx.supplierDeliveryPayment.create({
              data: {
                deliveryId: del.id,
                amount: itemPaid,
                paymentSource: itemSource as any,
                notes: 'Initial payment upon delivery receipt',
              },
            });
          }

          results.push(del);
        }
        return results;
      });

      // Notification
      try {
        const unpaidList = createdDeliveries.filter((d) => !d.isPaid);
        if (unpaidList.length > 0) {
          const supplierName = unpaidList[0]?.supplier?.name || 'Supplier';
          const totalUnpaid = unpaidList.reduce((acc, d) => {
            const net = Math.max(0, d.quantityReceived - d.returnedQuantity);
            return acc + Math.max(0, net * Number(d.unitBuyPrice) - Number(d.paidAmount));
          }, 0);

          notificationsService.notifyAdminsAndOwners(
            targetBranchId,
            'UNPAID_DELIVERY',
            'notifications.unpaidDeliveryTitle',
            'notifications.unpaidDeliveryBody',
            {
              supplierName,
              totalAmount: totalUnpaid,
              count: unpaidList.length,
            },
            '/suppliers'
          ).catch((err) => console.error('[Notification] unpaid delivery error:', err));
        }
      } catch (err) {
        console.error('[Notification] unpaid delivery error:', err);
      }

      return { data: createdDeliveries };
    }

    // Single item creation
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
    const retQty = returnedQuantity != null ? parseInt(String(returnedQuantity), 10) : 0;
    const netQty = Math.max(0, qty - retQty);
    const itemCost = netQty * decimalToNum(unitBuyPrice);

    let itemPaid = 0;
    if (amountPaidNow != null || body.paidAmount != null) {
      itemPaid = Math.min(itemCost, Math.max(0, decimalToNum(amountPaidNow ?? body.paidAmount)));
    } else if (isPaid) {
      itemPaid = itemCost;
    }

    let itemStatus: 'PENDING' | 'PARTIAL' | 'PAID' = 'PENDING';
    let itemIsPaid = false;
    if (itemCost === 0 || itemPaid >= itemCost) {
      itemStatus = 'PAID';
      itemIsPaid = true;
    } else if (itemPaid > 0) {
      itemStatus = 'PARTIAL';
      itemIsPaid = false;
    }

    const delivery = await prisma.$transaction(async (tx) => {
      const del = await tx.supplierDelivery.create({
        data: {
          supplierId: supplierId as string,
          productId: productId as string,
          sessionId: targetSessionId || null,
          quantityReceived: qty,
          returnedQuantity: retQty,
          unitBuyPrice: decimalToNum(unitBuyPrice),
          unitSellPrice: sellPrice,
          paidAmount: itemPaid,
          paymentStatus: itemStatus,
          isPaid: itemIsPaid,
          paymentSource: finalPaymentSource,
          notes: (notes || null) as string | null,
        },
        include: { supplier: true, product: true, payments: true },
      });

      if (itemPaid > 0) {
        await tx.supplierDeliveryPayment.create({
          data: {
            deliveryId: del.id,
            amount: itemPaid,
            paymentSource: finalPaymentSource,
            notes: 'Initial payment upon delivery receipt',
          },
        });
      }
      return del;
    });

    if (!delivery.isPaid) {
      notificationsService.notifyAdminsAndOwners(
        targetBranchId,
        'UNPAID_DELIVERY',
        'notifications.unpaidDeliveryTitle',
        'notifications.unpaidDeliveryBody',
        {
          supplierName: delivery.supplier?.name || 'Supplier',
          productName: delivery.product?.name || 'Product',
          totalAmount: Math.max(0, itemCost - itemPaid),
        },
        '/suppliers'
      ).catch((err) => console.error('[Notification] unpaid delivery error:', err));
    }

    return { data: delivery };
  }

  async updateSupplierDelivery(
    id: string,
    body: {
      productId?: string;
      quantityReceived?: number;
      returnedQuantity?: number;
      unitBuyPrice?: number;
      unitSellPrice?: number;
      paidAmount?: number;
      paymentSource?: string;
      isPaid?: boolean;
      paymentStatus?: 'PENDING' | 'PARTIAL' | 'PAID';
      notes?: string;
    }
  ): ServiceResult {
    const existing = await prisma.supplierDelivery.findUnique({ where: { id } });
    if (!existing) {
      return { error: 'Delivery not found', status: 404 };
    }

    const qty = body.quantityReceived !== undefined ? body.quantityReceived : existing.quantityReceived;
    const retQty = body.returnedQuantity !== undefined ? body.returnedQuantity : existing.returnedQuantity;
    const netQty = Math.max(0, qty - retQty);
    const buyPrice = body.unitBuyPrice !== undefined ? decimalToNum(body.unitBuyPrice) : decimalToNum(existing.unitBuyPrice);
    const totalCost = netQty * buyPrice;

    let finalPaidAmount = decimalToNum(existing.paidAmount);
    if (body.paidAmount !== undefined) {
      finalPaidAmount = Math.min(totalCost, Math.max(0, decimalToNum(body.paidAmount)));
    } else if (body.isPaid !== undefined) {
      finalPaidAmount = body.isPaid ? totalCost : 0;
    }

    let finalStatus: 'PENDING' | 'PARTIAL' | 'PAID' = 'PENDING';
    let finalIsPaid = false;

    if (totalCost === 0 || finalPaidAmount >= totalCost) {
      finalStatus = 'PAID';
      finalIsPaid = true;
    } else if (finalPaidAmount > 0) {
      finalStatus = 'PARTIAL';
      finalIsPaid = false;
    }

    const delivery = await prisma.supplierDelivery.update({
      where: { id },
      data: {
        ...(body.productId !== undefined && { productId: body.productId }),
        ...(body.quantityReceived !== undefined && { quantityReceived: qty }),
        ...(body.returnedQuantity !== undefined && { returnedQuantity: retQty }),
        ...(body.unitBuyPrice !== undefined && { unitBuyPrice: buyPrice }),
        ...(body.unitSellPrice !== undefined && { unitSellPrice: decimalToNum(body.unitSellPrice) }),
        paidAmount: finalPaidAmount,
        paymentStatus: finalStatus,
        isPaid: finalIsPaid,
        ...(body.paymentSource !== undefined && { paymentSource: body.paymentSource as any }),
        ...(body.notes !== undefined && { notes: body.notes }),
      },
      include: {
        supplier: true,
        product: true,
        session: true,
        payments: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (body.returnedQuantity !== undefined && body.returnedQuantity > 0) {
      notificationsService.notifyAdminsAndOwners(
        delivery.session?.branchId,
        'DELIVERY_RETURN',
        'notifications.deliveryReturnTitle',
        'notifications.deliveryReturnBody',
        {
          supplierName: delivery.supplier?.name || 'Supplier',
          productName: delivery.product?.name || 'Product',
          returnedQuantity: body.returnedQuantity,
        },
        '/suppliers'
      ).catch((err) => console.error('[Notification] delivery return error:', err));
    }

    return { data: delivery };
  }

  async recordDeliveryPayment(
    deliveryId: string,
    body: {
      amount: number;
      paymentSource?: string;
      notes?: string;
    }
  ): ServiceResult {
    const paymentAmount = decimalToNum(body.amount);
    if (paymentAmount <= 0) {
      return { error: 'Payment amount must be greater than 0', status: 400 };
    }

    const delivery = await prisma.supplierDelivery.findUnique({
      where: { id: deliveryId },
      include: { supplier: true, product: true },
    });
    if (!delivery) {
      return { error: 'Delivery not found', status: 404 };
    }

    const netQty = Math.max(0, delivery.quantityReceived - delivery.returnedQuantity);
    const totalCost = Number((netQty * decimalToNum(delivery.unitBuyPrice)).toFixed(2));
    const currentPaid = Number(decimalToNum(delivery.paidAmount || 0).toFixed(2));
    const remainingBalance = Math.max(0, Number((totalCost - currentPaid).toFixed(2)));

    if (remainingBalance <= 0.001) {
      return { error: 'Delivery is already fully paid', status: 400 };
    }

    const actualPayAmount = Math.min(remainingBalance, paymentAmount);
    const newPaidAmount = Number((currentPaid + actualPayAmount).toFixed(2));
    const isNowPaid = newPaidAmount >= totalCost - 0.001;
    const newStatus: 'PENDING' | 'PARTIAL' | 'PAID' = isNowPaid ? 'PAID' : 'PARTIAL';
    const paySource = (body.paymentSource === 'OWNER' ? 'OWNER' : 'DAILY_CASH') as any;

    const result = await prisma.$transaction(async (tx) => {
      await tx.supplierDeliveryPayment.create({
        data: {
          deliveryId,
          amount: actualPayAmount,
          paymentSource: paySource,
          notes: body.notes?.trim() || null,
        },
      });

      return tx.supplierDelivery.update({
        where: { id: deliveryId },
        data: {
          paidAmount: newPaidAmount,
          paymentStatus: newStatus,
          isPaid: isNowPaid,
        },
        include: {
          supplier: true,
          product: true,
          payments: { orderBy: { createdAt: 'desc' } },
        },
      });
    });

    return { data: result };
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

