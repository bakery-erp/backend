import { prisma } from '../../lib/prisma.js';
import type { ServiceResponse, ServiceResult } from '../../types/service-response.js';

function decimalToNum(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseFloat(v);
  return 0;
}

export class StockMovementsService {
  async getStockMovements(
    branchId?: string | null,
    stockItemId?: string,
    limit: number = 50,
    type?: string,
    from?: string,
    to?: string
  ): ServiceResult {
    const stockWhere = branchId ? { branchId } : {};
    const where: any = {};
    if (stockItemId) where.stockItemId = stockItemId;
    else if (branchId) where.stockItem = stockWhere;
    if (type) where.type = type;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) {
        const toDate = new Date(to);
        toDate.setUTCHours(23, 59, 59, 999);
        where.createdAt.lte = toDate;
      }
    }

    const list = await prisma.stockMovement.findMany({
      where,
      include: {
        stockItem: { select: { id: true, name: true, unitType: true, currentQuantity: true, unitPrice: true } },
        user: { select: { id: true, fullName: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return { data: list };
  }

  async getStockMovementById(id: string): ServiceResult {
    const movement = await prisma.stockMovement.findUnique({
      where: { id },
      include: { 
        stockItem: true, 
        user: { select: { id: true, fullName: true, phone: true } } 
      },
    });
    if (!movement) {
      return { error: 'Stock movement not found', status: 404 };
    }
    return { data: movement };
  }

  async createStockMovement(body: any, userId: string): ServiceResult {
    const { stockItemId, quantity, type, reason, adjustTo, unitPrice } = body;
    
    if (!stockItemId || quantity == null || !type) {
      return { 
        error: 'stockItemId, quantity, type (IN|OUT|ADJUSTMENT|PRODUCTION_USAGE) required', 
        status: 400 
      };
    }

    const qty = decimalToNum(quantity);
    if (!Number.isFinite(qty) || qty < 0) {
      return { error: 'Quantity must be a valid positive number', status: 400 };
    }

    const stockItem = await prisma.stockItem.findUnique({ where: { id: stockItemId } });
    if (!stockItem) {
      return { error: 'Stock item not found', status: 404 };
    }

    const current = Number(stockItem.currentQuantity);
    const itemUnitPrice = unitPrice != null ? decimalToNum(unitPrice) : Number(stockItem.unitPrice ?? 0);

    // Guard: OUT and PRODUCTION_USAGE cannot bring stock below zero
    if ((type === 'OUT' || type === 'PRODUCTION_USAGE') && qty > current) {
      return {
        error: `Insufficient stock. Current: ${current} ${stockItem.unitType}, requested: ${qty}`,
        status: 400,
      };
    }

    return await prisma.$transaction(async (tx) => {
      // Handle ADJUSTMENT with adjustTo
      if (type === 'ADJUSTMENT') {
        const adjQty = decimalToNum(adjustTo);
        if (adjQty != null && !Number.isNaN(adjQty)) {
          if (adjQty < 0) {
            throw new Error('Stock adjustment quantity cannot be negative');
          }
          await tx.stockItem.update({ 
            where: { id: stockItemId }, 
            data: { currentQuantity: adjQty } 
          });
          const deltaQty = Math.abs(adjQty - current);
          const movement = await tx.stockMovement.create({
            data: {
              stockItemId,
              userId,
              quantity: deltaQty,
              unitPrice: itemUnitPrice,
              totalValue: deltaQty * itemUnitPrice,
              type: 'ADJUSTMENT',
              reason: reason || `Adjusted to ${adjQty}`,
            },
            include: { 
              stockItem: true, 
              user: { select: { id: true, fullName: true } } 
            },
          });
          return { data: movement };
        }
      }

      const newQty = type === 'IN' ? current + qty : current - qty;
      await tx.stockItem.update({ 
        where: { id: stockItemId }, 
        data: { currentQuantity: newQty } 
      });

      const movement = await tx.stockMovement.create({
        data: {
          stockItemId,
          userId,
          quantity: qty,
          unitPrice: itemUnitPrice,
          totalValue: qty * itemUnitPrice,
          type: type as any,
          reason: reason || null,
        },
        include: {
          stockItem: { select: { id: true, name: true, unitType: true, currentQuantity: true, unitPrice: true } },
          user: { select: { id: true, fullName: true } },
        },
      });
      return { data: movement };
    }).catch((err) => {
      return { error: err.message || 'Transaction failed', status: 400 };
    });
  }

  // Per-item full movement history — used on stock item detail pages
  async getMovementsByStockItem(stockItemId: string, limit: number = 100): ServiceResult {
    const stockItem = await prisma.stockItem.findUnique({
      where: { id: stockItemId },
      include: { branch: { select: { id: true, name: true } } },
    });
    if (!stockItem) return { error: 'Stock item not found', status: 404 };

    const movements = await prisma.stockMovement.findMany({
      where: { stockItemId },
      include: { user: { select: { id: true, fullName: true, role: true } } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return {
      data: {
        stockItem,
        movements,
        totalIn: movements
          .filter((m) => m.type === 'IN')
          .reduce((s, m) => s + Number(m.quantity), 0),
        totalOut: movements
          .filter((m) => m.type === 'OUT' || m.type === 'PRODUCTION_USAGE')
          .reduce((s, m) => s + Number(m.quantity), 0),
      },
    };
  }

  // Inventory summary — used on web dashboard inventory widget
  async getStockSummary(branchId?: string | null): ServiceResult {
    if (!branchId) return { error: 'branchId required', status: 400 };

    const items = await prisma.stockItem.findMany({
      where: { branchId },
      orderBy: { name: 'asc' },
    });

    const totalItems = items.length;
    const outOfStock = items.filter((i) => Number(i.currentQuantity) <= 0).length;
    const lowStock = items.filter(
      (i) => i.minStockLevel != null && Number(i.currentQuantity) <= Number(i.minStockLevel)
    ).length;
    const healthy = totalItems - outOfStock;

    return {
      data: {
        branchId,
        totalItems,
        outOfStock,
        lowStock,
        healthy,
        items,
      },
    };
  }
}
