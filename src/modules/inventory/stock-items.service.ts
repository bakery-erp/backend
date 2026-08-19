import { prisma } from '../../lib/prisma.js';
import type { ServiceResponse, ServiceResult } from '../../types/service-response.js';

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
    const { branchId, name, unitType, currentQuantity, minStockLevel } = body;
    const bid = (branchId as string) || userBranchId;
    
    if (!bid || !name || !unitType) {
      return { error: 'branchId, name, unitType required', status: 400 };
    }

    const initQty = decimalToNum(currentQuantity) ?? 0;

    const result = await prisma.$transaction(async (tx) => {
      const item = await tx.stockItem.create({
        data: {
          branchId: bid,
          name: String(name).trim(),
          unitType: unitType as any,
          currentQuantity: initQty,
          minStockLevel: minStockLevel != null ? decimalToNum(minStockLevel) : null,
        },
      });

      if (initQty > 0) {
        await tx.stockMovement.create({
          data: {
            stockItemId: item.id,
            userId,
            quantity: initQty,
            type: 'IN',
            reason: 'Initial stock item creation',
          },
        });
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

    const { name, unitType, currentQuantity, minStockLevel } = body;
    const data: Record<string, unknown> = {};
    
    if (name != null) data.name = String(name).trim();
    if (unitType != null) data.unitType = unitType;
    if (currentQuantity != null) data.currentQuantity = decimalToNum(currentQuantity);
    if (minStockLevel !== undefined) data.minStockLevel = minStockLevel != null ? decimalToNum(minStockLevel) : null;

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.stockItem.update({
        where: { id },
        data: data as any,
      });

      if (currentQuantity != null) {
        const oldQty = Number(existing.currentQuantity);
        const newQty = Number(updated.currentQuantity);
        const diff = newQty - oldQty;

        if (diff !== 0) {
          await tx.stockMovement.create({
            data: {
              stockItemId: id,
              userId,
              quantity: Math.abs(diff),
              type: diff > 0 ? 'IN' : 'OUT',
              reason: `Stock updated via edit (changed from ${oldQty} to ${newQty} ${updated.unitType})`,
            },
          });
        }
      }

      return updated;
    });

    return { data: result };
  }

  async getItemHistory(id: string, limit: number = 100): ServiceResult {
    const stockItem = await prisma.stockItem.findUnique({
      where: { id },
      include: { branch: { select: { id: true, name: true } } },
    });
    if (!stockItem) return { error: 'Stock item not found', status: 404 };

    const movements = await prisma.stockMovement.findMany({
      where: { stockItemId: id },
      include: { user: { select: { id: true, fullName: true, role: true } } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    const totalIn = movements
      .filter((m) => m.type === 'IN')
      .reduce((s, m) => s + Number(m.quantity), 0);
    const totalOut = movements
      .filter((m) => m.type === 'OUT' || m.type === 'PRODUCTION_USAGE')
      .reduce((s, m) => s + Number(m.quantity), 0);

    return {
      data: {
        stockItem,
        movements,
        totalIn,
        totalOut,
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

  async addStockItem(id: string, userId: string, quantityToAdd: number, reason?: string): ServiceResult {
    const qty = Number(quantityToAdd);
    if (isNaN(qty) || qty <= 0) {
      return { error: 'Valid positive quantity required for addition', status: 400 };
    }

    const item = await prisma.stockItem.findUnique({ where: { id } });
    if (!item) {
      return { error: 'Stock item not found', status: 404 };
    }

    const result = await prisma.$transaction(async (tx) => {
      const updatedItem = await tx.stockItem.update({
        where: { id },
        data: { currentQuantity: { increment: qty } },
      });

      const movement = await tx.stockMovement.create({
        data: {
          stockItemId: id,
          userId,
          quantity: qty,
          type: 'IN',
          reason: reason?.trim() || 'Manual stock addition by Admin/Owner',
        },
      });

      return { stockItem: updatedItem, movement };
    });

    return { data: result };
  }

  async reduceStockItem(id: string, userId: string, quantityToReduce: number, reason?: string): ServiceResult {
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
          type: 'OUT',
          reason: reason?.trim() || 'Manual stock reduction by Admin/Owner',
        },
      });

      return { stockItem: updatedItem, movement };
    });

    return { data: result };
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
