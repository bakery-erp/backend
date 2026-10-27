import { prisma } from '../../lib/prisma.js';
import { Role } from '@prisma/client';
import { buildPaginatedResponse } from '../../lib/pagination.js';
import { utcDayRangeInclusive } from '../../lib/businessDate.js';
import type { ServiceResponse, ServiceResult } from '../../types/service-response.js';
import { notificationsService } from '../notifications/notifications.service.js';

function decimalToNum(v: unknown) {
  if (v == null) return undefined;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseFloat(v);
  return undefined;
}

export class StockItemsService {
  async getStockItems(
    branchId?: string | null,
    search?: string,
    unitType?: string,
    lowStockOnly?: boolean
  ): ServiceResult {
    if (!branchId) {
      return { error: 'branchId required', status: 400 };
    }

    const where: any = { branchId };
    if (unitType) where.unitType = unitType;
    if (search?.trim()) where.name = { contains: search.trim() };

    const list = await prisma.stockItem.findMany({
      where,
      include: {
        _count: { select: { movements: true } },
      },
      orderBy: { name: 'asc' },
    });

    // Optional in-memory filter for lowStockOnly (avoids complex Prisma column comparison)
    const result = lowStockOnly
      ? list.filter(
          (i) => i.minStockLevel != null && Number(i.currentQuantity) <= Number(i.minStockLevel)
        )
      : list;

    return { data: result };
  }

  async getStockItemById(id: string): ServiceResult {
    const item = await prisma.stockItem.findUnique({
      where: { id },
      include: {
        branch: { select: { id: true, name: true } },
        movements: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: { user: { select: { id: true, fullName: true, role: true } } },
        },
        _count: { select: { movements: true } },
      },
    });
    if (!item) {
      return { error: 'Stock item not found', status: 404 };
    }
    return { data: item };
  }

  async createStockItem(body: Record<string, unknown>, userId: string, userBranchId?: string | null): ServiceResult {
    const { branchId, name, unitType, currentQuantity, minStockLevel, unitPrice, loanInfo } = body;
    let bid = (branchId as string) || userBranchId || undefined;
    if (!bid) {
      const defaultBranch = await prisma.branch.findFirst({ select: { id: true } });
      if (defaultBranch) bid = defaultBranch.id;
    }
    
    if (!bid || !name || !unitType) {
      return { error: 'branchId, name, unitType required', status: 400 };
    }

    const initQty = decimalToNum(currentQuantity) ?? 0;
    const price = unitPrice != null ? decimalToNum(unitPrice) ?? 0 : 0;

    const result = await prisma.$transaction(async (tx) => {
      const item = await tx.stockItem.create({
        data: {
          branchId: bid,
          name: String(name).trim(),
          unitType: unitType as any,
          currentQuantity: initQty,
          unitPrice: price,
          minStockLevel: minStockLevel != null ? decimalToNum(minStockLevel) : null,
        },
      });

      if (initQty > 0) {
        const totalValue = initQty * price;
        const movement = await tx.stockMovement.create({
          data: {
            stockItemId: item.id,
            userId,
            quantity: initQty,
            unitPrice: price,
            totalValue,
            type: 'IN',
            reason: 'Initial stock item creation',
          },
        });

        const loan = loanInfo as { isLoan?: boolean; paidAmount?: number; supplierName?: string } | undefined;
        if (loan && loan.isLoan) {
          const paidAmount = Math.max(0, Math.min(totalValue, decimalToNum(loan.paidAmount) ?? 0));
          const remainingBalance = totalValue - paidAmount;
          const status = remainingBalance <= 0 ? 'PAID' : (paidAmount > 0 ? 'PARTIAL' : 'UNPAID');

          await tx.stockPurchaseLoan.create({
            data: {
              stockMovementId: movement.id,
              stockItemId: item.id,
              branchId: bid,
              supplierName: loan.supplierName ? String(loan.supplierName).trim() : null,
              totalAmount: totalValue,
              paidAmount,
              remainingBalance,
              status,
            },
          });
        }
      }

      return item;
    });

    return { data: result };
  }

  async updateStockItem(id: string, userId: string, body: Record<string, unknown>): ServiceResult {
    const existing = await prisma.stockItem.findUnique({ where: { id } });
    if (!existing) {
      return { error: 'Stock item not found', status: 404 };
    }

    const { name, unitType, currentQuantity, minStockLevel, unitPrice } = body;
    const data: Record<string, unknown> = {};
    
    if (name != null) data.name = String(name).trim();
    if (unitType != null) data.unitType = unitType;
    if (currentQuantity != null) data.currentQuantity = decimalToNum(currentQuantity);
    if (unitPrice != null) data.unitPrice = decimalToNum(unitPrice);
    if (minStockLevel !== undefined) data.minStockLevel = minStockLevel != null ? decimalToNum(minStockLevel) : null;

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.stockItem.update({
        where: { id },
        data: data as any,
      });

      const effectivePrice = Number(updated.unitPrice ?? existing.unitPrice ?? 0);

      if (currentQuantity != null) {
        const oldQty = Number(existing.currentQuantity);
        const newQty = Number(updated.currentQuantity);
        const diff = newQty - oldQty;

        if (diff !== 0) {
          const absDiff = Math.abs(diff);
          await tx.stockMovement.create({
            data: {
              stockItemId: id,
              userId,
              quantity: absDiff,
              unitPrice: effectivePrice,
              totalValue: absDiff * effectivePrice,
              type: diff > 0 ? 'IN' : 'OUT',
              reason: `Stock updated via edit (changed from ${oldQty} to ${newQty} ${updated.unitType})`,
            },
          });
        }
      }

      return updated;
    });

    this.checkStockAndNotify(result).catch((err) =>
      console.error('[Notification] updateStockItem checkStock error:', err)
    );

    return { data: result };
  }

  async getItemHistory(
    id: string,
    page: number = 1,
    limit: number = 20,
    type?: string,
    date?: string
  ): ServiceResult {
    const stockItem = await prisma.stockItem.findUnique({
      where: { id },
      include: { branch: { select: { id: true, name: true } } },
    });
    if (!stockItem) return { error: 'Stock item not found', status: 404 };

    const where: any = { stockItemId: id };
    if (type && type !== 'ALL') {
      where.type = type;
    }
    if (date && date.trim()) {
      const range = utcDayRangeInclusive(date.trim());
      if (range) {
        where.createdAt = {
          gte: range.start,
          lte: range.end,
        };
      }
    }

    const skip = (page - 1) * limit;

    const [total, movements, allMovementsSummary] = await Promise.all([
      prisma.stockMovement.count({ where }),
      prisma.stockMovement.findMany({
        where,
        include: { 
          user: { select: { id: true, fullName: true, role: true } },
          purchaseLoan: {
            include: {
              payments: {
                include: { user: { select: { id: true, fullName: true } } },
                orderBy: { createdAt: 'desc' },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.stockMovement.groupBy({
        by: ['type'],
        where: { stockItemId: id },
        _sum: {
          quantity: true,
          totalValue: true,
        },
      }),
    ]);

    let totalIn = 0;
    let totalOut = 0;
    let totalValueIn = 0;
    let totalValueOut = 0;

    for (const group of allMovementsSummary) {
      const q = Number(group._sum.quantity || 0);
      const v = Number(group._sum.totalValue || 0);
      if (group.type === 'IN') {
        totalIn += q;
        totalValueIn += v;
      } else if (group.type === 'OUT' || group.type === 'PRODUCTION_USAGE') {
        totalOut += q;
        totalValueOut += v;
      }
    }

    const currentValuation = Number(stockItem.currentQuantity) * Number(stockItem.unitPrice ?? 0);
    const paginatedMovements = buildPaginatedResponse(movements, total, page, limit);

    return {
      data: {
        stockItem,
        movements: paginatedMovements.data,
        pagination: paginatedMovements.pagination,
        total,
        page,
        limit,
        totalPages: paginatedMovements.totalPages,
        totalIn,
        totalOut,
        totalValueIn,
        totalValueOut,
        currentValuation,
      },
    };
  }

  async getLowStockAlerts(branchId?: string | null): ServiceResult {
    if (!branchId) {
      return { error: 'branchId required', status: 400 };
    }
    const items = await prisma.stockItem.findMany({
      where: {
        branchId,
        minStockLevel: { not: null },
      },
      orderBy: { name: 'asc' },
    });
    
    // Filter items where currentQuantity <= minStockLevel
    const lowStockItems = items.filter(item => {
      const current = Number(item.currentQuantity);
      const min = Number(item.minStockLevel);
      return current <= min;
    });

    return { data: lowStockItems };
  }

  async addStockItem(
    id: string, 
    userId: string, 
    quantityToAdd: number, 
    reason?: string,
    loanInfo?: { isLoan?: boolean; paidAmount?: number; supplierName?: string },
    newUnitPrice?: number | string,
    autoConfirm: boolean = false
  ): ServiceResult {
    const qty = Number(quantityToAdd);
    if (isNaN(qty) || qty <= 0) {
      return { error: 'Valid positive quantity required for addition', status: 400 };
    }

    const item = await prisma.stockItem.findUnique({ where: { id } });
    if (!item) {
      return { error: 'Stock item not found', status: 404 };
    }

    const parsedPrice = newUnitPrice !== undefined && newUnitPrice !== null && newUnitPrice !== ''
      ? Number(newUnitPrice)
      : undefined;
    const price = (parsedPrice !== undefined && !isNaN(parsedPrice) && parsedPrice >= 0)
      ? parsedPrice
      : Number(item.unitPrice ?? 0);
    const totalValue = qty * price;

    const result = await prisma.$transaction(async (tx) => {
      let updatedItem = item;
      if (autoConfirm) {
        const updateData: any = { currentQuantity: { increment: qty } };
        if (parsedPrice !== undefined && !isNaN(parsedPrice) && parsedPrice >= 0) {
          updateData.unitPrice = parsedPrice;
        }

        updatedItem = await tx.stockItem.update({
          where: { id },
          data: updateData,
        });
      }

      const movement = await tx.stockMovement.create({
        data: {
          stockItemId: id,
          userId,
          quantity: qty,
          unitPrice: price,
          totalValue,
          type: 'IN',
          status: autoConfirm ? 'CONFIRMED' : 'PENDING_CONFIRMATION',
          reason: reason?.trim() || 'Manual Stock Addition',
          ...(autoConfirm ? { confirmedAt: new Date(), confirmedById: userId } : {}),
        },
      });

      if (loanInfo && loanInfo.isLoan) {
        const paidAmount = Math.max(0, Math.min(totalValue, decimalToNum(loanInfo.paidAmount) ?? 0));
        const remainingBalance = totalValue - paidAmount;
        const status = remainingBalance <= 0 ? 'PAID' : (paidAmount > 0 ? 'PARTIAL' : 'UNPAID');

        await tx.stockPurchaseLoan.create({
          data: {
            stockMovementId: movement.id,
            stockItemId: id,
            branchId: item.branchId,
            supplierName: loanInfo.supplierName ? String(loanInfo.supplierName).trim() : null,
            totalAmount: totalValue,
            paidAmount,
            remainingBalance,
            status,
          },
        });
      }

      return { stockItem: updatedItem, movement };
    });

    // Notify Stock Keeper that new inward stock was added awaiting their physical confirmation
    prisma.user.findUnique({
      where: { id: userId },
      select: { fullName: true, role: true },
    }).then((user) => {
      const addedBy = user ? `${user.fullName} (${user.role})` : 'Management';
      notificationsService.notifyBranchRoles(
        item.branchId,
        [Role.STOCK_KEEPER],
        'STOCK_INWARD_ADDED',
        'notifications.stockInwardTitle',
        'notifications.stockInwardBody',
        {
          itemName: item.name,
          quantity: qty,
          unit: item.unitType,
          addedBy,
          reason: reason?.trim() || '',
        },
        '/stock-movements'
      ).catch((err) => console.error('[Notification] addStockItem notifyStockKeeper error:', err));
    }).catch(() => {});

    if (loanInfo && loanInfo.isLoan) {
      notificationsService.notifyAdminsAndOwners(
        item.branchId,
        'STOCK_PURCHASE_LOAN',
        'notifications.stockPurchaseLoanTitle',
        'notifications.stockPurchaseLoanBody',
        {
          itemName: item.name,
          amount: totalValue,
          supplierName: loanInfo.supplierName || 'Supplier',
        },
        '/owner-loans'
      ).catch((err) => console.error('[Notification] addStockItem loan error:', err));
    }

    return { data: result };
  }

  async reduceStockItem(id: string, userId: string, quantityToReduce: number, reason?: string, receivedBy?: string): ServiceResult {
    const qty = Number(quantityToReduce);
    if (isNaN(qty) || qty <= 0) {
      return { error: 'Valid positive quantity required for reduction', status: 400 };
    }

    const item = await prisma.stockItem.findUnique({ where: { id } });
    if (!item) {
      return { error: 'Stock item not found', status: 404 };
    }

    const current = Number(item.currentQuantity);
    if (current < qty) {
      return {
        error: `Cannot reduce stock item below 0. Current available: ${current} ${item.unitType}`,
        status: 400,
      };
    }

    const price = Number(item.unitPrice ?? 0);

    const result = await prisma.$transaction(async (tx) => {
      const updatedItem = await tx.stockItem.update({
        where: { id },
        data: { currentQuantity: { decrement: qty } },
      });

      const movement = await tx.stockMovement.create({
        data: {
          stockItemId: id,
          userId,
          quantity: qty,
          unitPrice: price,
          totalValue: qty * price,
          type: 'OUT',
          status: 'CONFIRMED',
          receivedBy: receivedBy?.trim() || null,
          reason: reason?.trim() || 'Manual stock reduction / material issuance',
        },
      });

      return { stockItem: updatedItem, movement };
    });

    // Notify management & stock keeper that material was taken from warehouse
    prisma.user.findUnique({
      where: { id: userId },
      select: { fullName: true, role: true },
    }).then((user) => {
      const takenBy = receivedBy?.trim() || (user ? `${user.fullName} (${user.role})` : 'Staff');
      notificationsService.notifyBranchRoles(
        item.branchId,
        [Role.OWNER, Role.ADMIN, Role.STOCK_KEEPER],
        'STOCK_OUTWARD',
        'notifications.stockOutwardTitle',
        'notifications.stockOutwardBody',
        {
          itemName: item.name,
          quantity: qty,
          unit: item.unitType,
          takenBy,
          reason: reason?.trim() || 'Material usage / issuance',
          remaining: Number(result.stockItem.currentQuantity),
        },
        '/stock'
      ).catch((err) => console.error('[Notification] reduceStockItem outward error:', err));
    }).catch(() => {});

    this.checkStockAndNotify(result.stockItem).catch((err) =>
      console.error('[Notification] reduceStockItem checkStock error:', err)
    );

    return { data: result };
  }

  private async checkStockAndNotify(item: { id: string; name: string; unitType: string; branchId: string; currentQuantity: any; minStockLevel: any }) {
    try {
      const remaining = Number(item.currentQuantity);
      const min = Number(item.minStockLevel);

      if (remaining <= 0) {
        await notificationsService.notifyBranchRoles(
          item.branchId,
          [Role.OWNER, Role.ADMIN, Role.STOCK_KEEPER],
          'OUT_OF_STOCK',
          'notifications.outOfStockTitle',
          'notifications.outOfStockBody',
          {
            itemName: item.name,
            quantity: remaining,
            unit: item.unitType,
          },
          '/stock'
        );
      } else if (remaining <= min) {
        await notificationsService.notifyBranchRoles(
          item.branchId,
          [Role.OWNER, Role.ADMIN, Role.STOCK_KEEPER],
          'LOW_STOCK',
          'notifications.lowStockTitle',
          'notifications.lowStockBody',
          {
            itemName: item.name,
            quantity: remaining,
            minLevel: min,
            unit: item.unitType,
          },
          '/stock'
        );
      }
    } catch (err) {
      console.error('[Notification] checkStockAndNotify error:', err);
    }
  }

  async deleteStockItem(id: string): ServiceResult {
    try {
      await prisma.stockItem.delete({
        where: { id },
      });
      return { data: { message: 'Stock item deleted successfully' } };
    } catch (e) {
      return { error: 'Failed to delete stock item (it may be referenced by movements or production)', status: 400 };
    }
  }
}
