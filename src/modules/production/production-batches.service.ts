import { prisma } from '../../lib/prisma.js';
import { businessDateFromYmdString, businessDateUtcNoon, parseYmd, utcDayRangeInclusive } from '../../lib/businessDate.js';
import type { ServiceResponse, ServiceResult } from '../../types/service-response.js';
import { ProductsService } from '../catalog/products.service.js';

function decimalToNum(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseFloat(v);
  return 0;
}

export class ProductionBatchesService {
  async getProductionBatches(
    branchId?: string | null,
    date?: string,
    status?: string,
    shift?: string,
    role?: string,
    userId?: string,
    seenFilter?: string,
    callerRole?: string,
    callerUserId?: string,
    page?: number,
    limit?: number
  ): ServiceResult {
    if (!branchId) {
      return { error: 'branchId required', status: 400 };
    }

    const where: any = { branchId };
    if (status) where.status = status;
    if (shift) where.shift = shift;
    if (userId) where.userId = userId;

    const isGlobalAdmin = callerRole === 'ADMIN' || callerRole === 'OWNER';
    if (!isGlobalAdmin && callerUserId) {
      where.userId = callerUserId;
      // If no explicit date requested by worker, default to last 2 days (Yesterday and Today)
      if (!date) {
        const ethNow = new Date(Date.now() + 3 * 3600 * 1000);
        const yesterdayYmd = new Date(ethNow.getTime() - 24 * 3600 * 1000).toISOString().slice(0, 10);
        const range = utcDayRangeInclusive(yesterdayYmd);
        if (range) {
          where.date = { gte: range.start };
        }
      }
    }

    if (date) {
      const p = parseYmd(date);
      if (p) where.date = businessDateUtcNoon(p.y, p.mo, p.day);
    }

    if (role) {
      where.user = { role };
    }

    if (seenFilter === 'FLAGGED') {
      where.isFlagged = true;
    } else if (seenFilter === 'UNSEEN') {
      if (callerRole === 'ADMIN') {
        where.adminSeenAt = null;
      } else if (callerRole === 'OWNER') {
        where.ownerSeenAt = null;
      }
    } else if (seenFilter === 'SEEN') {
      if (callerRole === 'ADMIN') {
        where.adminSeenAt = { not: null };
      } else if (callerRole === 'OWNER') {
        where.ownerSeenAt = { not: null };
      }
    }

    const pageNum = page ? Math.max(1, Number(page)) : 1;
    const limitNum = limit ? Math.max(1, Number(limit)) : undefined;
    const skip = limitNum ? (pageNum - 1) * limitNum : undefined;

    const [total, list] = await Promise.all([
      prisma.productionBatch.count({ where }),
      prisma.productionBatch.findMany({
        where,
        include: {
          user: { select: { id: true, fullName: true, role: true } },
          items: { include: { product: { select: { id: true, name: true, unitType: true, basePrice: true } } } },
          materialUsages: { include: { stockItem: { select: { id: true, name: true, unitType: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
      }),
    ]);

    if (page || limit) {
      return {
        data: {
          batches: list,
          total,
          page: pageNum,
          limit: limitNum || total,
          hasMore: limitNum ? (skip! + list.length) < total : false,
        },
      };
    }
    return { data: list };
  }

  async getProductionBatchById(id: string, user?: { id: string; role: string }): ServiceResult {
    let batch = await prisma.productionBatch.findUnique({
      where: { id },
      include: {
        branch: true,
        user: true,
        items: { include: { product: true } },
        materialUsages: { include: { stockItem: true } },
      },
    });
    if (!batch) {
      return { error: 'Production batch not found', status: 404 };
    }

    // Worker role restriction: non-admin workers can only access their own batches within the 2-day window
    if (user && user.role !== 'ADMIN' && user.role !== 'OWNER') {
      if (batch.userId !== user.id) {
        return { error: 'Access denied: You can only view your own production batches.', status: 403 };
      }
      const ethNow = new Date(Date.now() + 3 * 3600 * 1000);
      const yesterdayYmd = new Date(ethNow.getTime() - 24 * 3600 * 1000).toISOString().slice(0, 10);
      const batchYmd = (batch.date || batch.createdAt).toISOString().slice(0, 10);
      if (batchYmd < yesterdayYmd) {
        return { error: 'Access denied: Workers can only view batches from today or yesterday.', status: 403 };
      }
    }

    if (user?.role === 'ADMIN' && !batch.adminSeenAt) {
      batch = await prisma.productionBatch.update({
        where: { id },
        data: { adminSeenAt: new Date() },
        include: {
          branch: true,
          user: true,
          items: { include: { product: true } },
          materialUsages: { include: { stockItem: true } },
        },
      });
    } else if (user?.role === 'OWNER' && !batch.ownerSeenAt) {
      batch = await prisma.productionBatch.update({
        where: { id },
        data: { ownerSeenAt: new Date() },
        include: {
          branch: true,
          user: true,
          items: { include: { product: true } },
          materialUsages: { include: { stockItem: true } },
        },
      });
    }

    return { data: batch };
  }

  async createProductionBatch(body: any, userId: string, userBranchId?: string | null): ServiceResult {
    const { branchId, date, shift, items, materialUsages } = body;
    const bid = branchId || userBranchId;

    if (!bid) {
      return { error: 'branchId required', status: 400 };
    }
    if (!items?.length) {
      return { error: 'items array required', status: 400 };
    }

    let batchDate = businessDateFromYmdString(new Date().toISOString().slice(0, 10)) ?? new Date();
    if (date) {
      const p = parseYmd(date);
      if (p) batchDate = businessDateUtcNoon(p.y, p.mo, p.day);
    }

    // Pre-validate that stock items exist if material usages are provided
    for (const m of materialUsages || []) {
      const used = decimalToNum(m.quantityUsed);
      if (used <= 0) {
        return { error: `Invalid material quantity for stock item ${m.stockItemId}`, status: 400 };
      }
      const item = await prisma.stockItem.findUnique({ where: { id: m.stockItemId } });
      if (!item) {
        return { error: `Stock item not found: ${m.stockItemId}`, status: 404 };
      }
    }

    // Optional active session lookup (production is no longer blocked if session is closed)
    const activeSession = await prisma.dailySession.findFirst({
      where: {
        branchId: bid,
      },
      orderBy: { date: 'desc' },
    });



    // Creator seen timestamp
    const creator = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    const now = new Date();
    const seenData: any = {};
    if (creator?.role === 'ADMIN') {
      seenData.adminSeenAt = now;
    } else if (creator?.role === 'OWNER') {
      seenData.ownerSeenAt = now;
    }

    // Execute atomic transaction for batch creation
    const result = await prisma.$transaction(async (tx) => {
      const batch = await tx.productionBatch.create({
        data: {
          branchId: bid,
          userId,
          sessionId: activeSession?.id || null,
          date: batchDate,
          shift: (shift as any) || null,
          status: 'COMPLETED',
          ...seenData,
          items: {
            create: items.map((i: any) => ({
              productId: i.productId,
              quantityProduced: typeof i.quantityProduced === 'number' ? i.quantityProduced : parseInt(String(i.quantityProduced), 10),
            })),
          },
          materialUsages: materialUsages?.length
            ? {
              create: materialUsages.map((m: any) => ({
                stockItemId: m.stockItemId,
                quantityUsed: decimalToNum(m.quantityUsed),
              })),
            }
            : undefined,
        },
        include: {
          user: { select: { id: true, fullName: true } },
          items: { include: { product: true } },
          materialUsages: { include: { stockItem: true } },
        },
      });

      return batch;
    }, { maxWait: 10000, timeout: 20000 });

    ProductsService.clearCache();
    return { data: result };
  }

  async approveProductionBatch(id: string, adminUserId: string): ServiceResult {
    const batch = await prisma.productionBatch.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, fullName: true, role: true } },
        items: { include: { product: { select: { name: true } } } },
        materialUsages: { include: { stockItem: true } },
      },
    });

    if (!batch) {
      return { error: 'Production batch not found', status: 404 };
    }
    if (batch.status !== 'PENDING_APPROVAL') {
      return { error: `Batch cannot be approved because current status is ${batch.status}`, status: 400 };
    }

    const adminUser = await prisma.user.findUnique({
      where: { id: adminUserId },
      select: { fullName: true, role: true },
    });

    const updated = await prisma.$transaction(async (tx) => {

      const now = new Date();
      const seenUpdate: any = {};
      if (adminUser?.role === 'ADMIN') {
        seenUpdate.adminSeenAt = now;
      } else if (adminUser?.role === 'OWNER') {
        seenUpdate.ownerSeenAt = now;
        if (!batch.adminSeenAt) seenUpdate.adminSeenAt = now;
      }

      return await tx.productionBatch.update({
        where: { id },
        data: {
          status: 'COMPLETED',
          ...seenUpdate,
        },
        include: {
          user: { select: { id: true, fullName: true } },
          items: { include: { product: true } },
          materialUsages: { include: { stockItem: true } },
        },
      });
    }, { maxWait: 10000, timeout: 20000 });

    ProductsService.clearCache();
    return { data: updated };
  }

  async rejectProductionBatch(id: string, adminUserId: string): ServiceResult {
    const batch = await prisma.productionBatch.findUnique({ where: { id } });
    if (!batch) {
      return { error: 'Production batch not found', status: 404 };
    }
    if (batch.status !== 'PENDING_APPROVAL') {
      return { error: `Batch cannot be rejected because current status is ${batch.status}`, status: 400 };
    }

    const adminUser = await prisma.user.findUnique({
      where: { id: adminUserId },
      select: { fullName: true, role: true },
    });
    const now = new Date();
    const seenUpdate: any = {};
    if (adminUser?.role === 'ADMIN') {
      seenUpdate.adminSeenAt = now;
    } else if (adminUser?.role === 'OWNER') {
      seenUpdate.ownerSeenAt = now;
    }

    const updated = await prisma.productionBatch.update({
      where: { id },
      data: {
        status: 'REJECTED',
        ...seenUpdate,
      },
      include: {
        user: { select: { id: true, fullName: true } },
        items: { include: { product: true } },
        materialUsages: { include: { stockItem: true } },
      },
    });

    return { data: updated };
  }

  async markBatchSeen(id: string, user: { id: string; role: string; fullName?: string }): ServiceResult {
    const batch = await prisma.productionBatch.findUnique({ where: { id } });
    if (!batch) {
      return { error: 'Production batch not found', status: 404 };
    }

    const now = new Date();
    const data: any = {};
    if (user.role === 'ADMIN') {
      data.adminSeenAt = now;
    } else if (user.role === 'OWNER') {
      data.ownerSeenAt = now;
    } else {
      return { data: batch };
    }

    const updated = await prisma.productionBatch.update({
      where: { id },
      data,
      include: {
        user: { select: { id: true, fullName: true, role: true } },
        items: { include: { product: true } },
        materialUsages: { include: { stockItem: true } },
      },
    });

    return { data: updated };
  }

  async toggleBatchFlag(
    id: string,
    isFlagged: boolean,
    reason?: string,
    user?: { id: string; role: string; fullName?: string }
  ): ServiceResult {
    const batch = await prisma.productionBatch.findUnique({ where: { id } });
    if (!batch) {
      return { error: 'Production batch not found', status: 404 };
    }

    const now = new Date();
    const data: any = {
      isFlagged: Boolean(isFlagged),
      flagReason: isFlagged ? (reason?.trim() || 'Flagged for clarification') : null,
      flaggedBy: isFlagged ? (user?.fullName || user?.role || 'Management') : null,
      flaggedAt: isFlagged ? now : null,
    };

    const updated = await prisma.productionBatch.update({
      where: { id },
      data,
      include: {
        user: { select: { id: true, fullName: true, role: true } },
        items: { include: { product: true } },
        materialUsages: { include: { stockItem: true } },
      },
    });

    return { data: updated };
  }

  async updateProductionBatch(id: string, body: any, user?: { id: string; role: string }): ServiceResult {
    const { date, shift, status, items, materialUsages } = body;
    const existing = await prisma.productionBatch.findUnique({
      where: { id },
      include: {
        items: { include: { product: true } },
        materialUsages: { include: { stockItem: true } },
      },
    });
    if (!existing) {
      return { error: 'Production batch not found', status: 404 };
    }

    const isAdminOrOwner = user?.role === 'ADMIN' || user?.role === 'OWNER';
    const isCreator = user?.id === existing.userId;

    // Permissions: Only Admin/Owner or the batch creator can edit
    if (!isAdminOrOwner && !isCreator) {
      return {
        error: 'You do not have permission to edit this production batch.',
        status: 403,
      };
    }

    // Workers can only edit today's batches
    if (!isAdminOrOwner) {
      const ethNow = new Date(Date.now() + 3 * 3600 * 1000);
      const todayYmd = ethNow.toISOString().slice(0, 10);
      const batchDateYmd = existing.date
        ? existing.date.toISOString().slice(0, 10)
        : existing.createdAt.toISOString().slice(0, 10);
      if (batchDateYmd !== todayYmd) {
        return {
          error: 'Workers can only edit production batches created for today.',
          status: 403,
        };
      }
    }

    // Producer roles cannot directly change status to COMPLETED or REJECTED
    if (!isAdminOrOwner && status && (status === 'COMPLETED' || status === 'REJECTED')) {
      return {
        error: 'Producer roles cannot approve or reject production batches directly.',
        status: 403,
      };
    }

    let batchDate: Date | undefined = undefined;
    if (date) {
      const p = parseYmd(date);
      if (p) batchDate = businessDateUtcNoon(p.y, p.mo, p.day);
    }

    // 1. Calculate Product Changes (Before & After Diffs)
    const productChanges: Array<{
      productId: string;
      productName: string;
      unitType: string;
      oldQty: number;
      newQty: number;
      diff: number;
    }> = [];

    if (items && Array.isArray(items)) {
      const oldItemMap = new Map<string, { qty: number; name: string; unit: string }>();
      for (const item of existing.items) {
        oldItemMap.set(item.productId, {
          qty: item.quantityProduced,
          name: item.product?.name || 'Product',
          unit: item.product?.unitType || 'unit',
        });
      }

      const newItemMap = new Map<string, number>();
      for (const i of items) {
        const qty = typeof i.quantityProduced === 'number' ? i.quantityProduced : parseInt(String(i.quantityProduced), 10);
        newItemMap.set(i.productId, qty);
      }

      for (const [prodId, oldData] of oldItemMap.entries()) {
        const newQty = newItemMap.get(prodId) ?? 0;
        if (oldData.qty !== newQty) {
          productChanges.push({
            productId: prodId,
            productName: oldData.name,
            unitType: oldData.unit,
            oldQty: oldData.qty,
            newQty,
            diff: newQty - oldData.qty,
          });
        }
      }

      for (const i of items) {
        if (!oldItemMap.has(i.productId)) {
          const qty = typeof i.quantityProduced === 'number' ? i.quantityProduced : parseInt(String(i.quantityProduced), 10);
          if (qty > 0) {
            const prod = await prisma.product.findUnique({ where: { id: i.productId }, select: { name: true, unitType: true } });
            productChanges.push({
              productId: i.productId,
              productName: prod?.name || 'Product',
              unitType: prod?.unitType || 'unit',
              oldQty: 0,
              newQty: qty,
              diff: qty,
            });
          }
        }
      }
    }

    // 2. Calculate Material Usage Changes (Before & After Diffs)
    const materialChanges: Array<{
      stockItemId: string;
      materialName: string;
      unitType: string;
      oldQty: number;
      newQty: number;
      diff: number;
    }> = [];

    if (materialUsages && Array.isArray(materialUsages)) {
      const oldMatMap = new Map<string, { qty: number; name: string; unit: string }>();
      for (const usage of existing.materialUsages) {
        oldMatMap.set(usage.stockItemId, {
          qty: Number(usage.quantityUsed),
          name: usage.stockItem?.name || 'Raw Material',
          unit: usage.stockItem?.unitType || 'unit',
        });
      }

      const newMatMap = new Map<string, number>();
      for (const m of materialUsages) {
        const qty = decimalToNum(m.quantityUsed);
        newMatMap.set(m.stockItemId, qty);
      }

      for (const [stockId, oldData] of oldMatMap.entries()) {
        const newQty = newMatMap.get(stockId) ?? 0;
        if (oldData.qty !== newQty) {
          materialChanges.push({
            stockItemId: stockId,
            materialName: oldData.name,
            unitType: oldData.unit,
            oldQty: oldData.qty,
            newQty,
            diff: Number((newQty - oldData.qty).toFixed(3)),
          });
        }
      }

      for (const m of materialUsages) {
        if (!oldMatMap.has(m.stockItemId)) {
          const qty = decimalToNum(m.quantityUsed);
          if (qty > 0) {
            const stock = await prisma.stockItem.findUnique({ where: { id: m.stockItemId }, select: { name: true, unitType: true } });
            materialChanges.push({
              stockItemId: m.stockItemId,
              materialName: stock?.name || 'Raw Material',
              unitType: stock?.unitType || 'unit',
              oldQty: 0,
              newQty: qty,
              diff: qty,
            });
          }
        }
      }
    }

    const hasChanges = productChanges.length > 0 || materialChanges.length > 0;
    let updatedHistory = Array.isArray(existing.editHistory) ? [...(existing.editHistory as any[])] : [];

    if (hasChanges) {
      const editor = user ? await prisma.user.findUnique({ where: { id: user.id }, select: { id: true, fullName: true, role: true } }) : null;
      const newHistoryEntry = {
        editedAt: new Date().toISOString(),
        editedBy: {
          id: editor?.id || user?.id || 'unknown',
          fullName: editor?.fullName || 'Employee',
          role: editor?.role || user?.role || 'BAKER',
        },
        productChanges,
        materialChanges,
      };
      updatedHistory.unshift(newHistoryEntry);
    }

    const updated = await prisma.$transaction(async (tx) => {

      if (items && Array.isArray(items)) {
        await tx.productionItem.deleteMany({ where: { batchId: id } });
      }
      if (materialUsages && Array.isArray(materialUsages)) {
        await tx.productionMaterialUsage.deleteMany({ where: { batchId: id } });
      }

      return await tx.productionBatch.update({
        where: { id },
        data: {
          ...(batchDate ? { date: batchDate } : {}),
          ...(shift ? { shift: shift as any } : {}),
          ...(status ? { status: status as any } : {}),
          isEdited: hasChanges ? true : existing.isEdited,
          editedAt: hasChanges ? new Date() : existing.editedAt,
          editHistory: updatedHistory,
          ...(items && Array.isArray(items)
            ? {
              items: {
                create: items.map((i: any) => ({
                  productId: i.productId,
                  quantityProduced: typeof i.quantityProduced === 'number' ? i.quantityProduced : parseInt(String(i.quantityProduced), 10),
                })),
              },
            }
            : {}),
          ...(materialUsages && Array.isArray(materialUsages)
            ? {
              materialUsages: {
                create: materialUsages.map((m: any) => ({
                  stockItemId: m.stockItemId,
                  quantityUsed: decimalToNum(m.quantityUsed),
                })),
              },
            }
            : {}),
        },
        include: {
          user: { select: { id: true, fullName: true, role: true } },
          items: { include: { product: true } },
          materialUsages: { include: { stockItem: true } },
        },
      });
    }, { maxWait: 10000, timeout: 20000 });

    ProductsService.clearCache();
    return { data: updated };
  }

  async deleteProductionBatch(id: string): ServiceResult {
    try {
      const batch = await prisma.productionBatch.findUnique({
        where: { id },
        include: { materialUsages: true },
      });

      if (!batch) {
        return { error: 'Production batch not found', status: 404 };
      }

      await prisma.$transaction(async (tx) => {
        await tx.productionBatch.delete({
          where: { id },
        });
      });

      ProductsService.clearCache();
      return { data: { message: 'Production batch deleted successfully' } };
    } catch (e: any) {
      return { error: e.message || 'Failed to delete production batch', status: 400 };
    }
  }

  async getDailyProductHistory(params: {
    branchId?: string | null;
    startDate?: string;
    endDate?: string;
    type?: string;
    supplierId?: string;
    productId?: string;
    search?: string;
  }): ServiceResult {
    try {
      const { branchId, startDate, endDate, supplierId, productId } = params;
      const typeFilter = ((params.type as string) || 'ALL').toUpperCase();
      const search = ((params.search as string) || '').trim().toLowerCase();

      let dateWhere: any = {};
      if (startDate && endDate) {
        const pStart = parseYmd(startDate);
        const pEnd = parseYmd(endDate);
        if (pStart && pEnd) {
          dateWhere = {
            gte: businessDateUtcNoon(pStart.y, pStart.mo, pStart.day),
            lte: businessDateUtcNoon(pEnd.y, pEnd.mo, pEnd.day),
          };
        }
      }

      const records: any[] = [];

      // 1. Fetch Production Items (Bakery Produced Products) - skip if supplier specified
      if ((typeFilter === 'ALL' || typeFilter === 'PRODUCED') && !supplierId) {
        const batchWhere: any = {};
        if (branchId) batchWhere.branchId = branchId;
        if (Object.keys(dateWhere).length > 0) batchWhere.date = dateWhere;

        const items = await prisma.productionItem.findMany({
          where: {
            batch: batchWhere,
            ...(productId && { productId }),
          },
          include: {
            product: true,
            batch: {
              include: {
                branch: true,
                user: { select: { id: true, fullName: true, role: true } },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 500,
        });

        for (const item of items) {
          const returnedQty = item.returnedQuantity || 0;
          const netQty = Math.max(0, item.quantityProduced - returnedQty);
          const subtotal = Number(item.product.basePrice) * netQty;

          records.push({
            id: `prod_${item.id}`,
            rawId: item.id,
            date: item.batch.date,
            createdAt: item.createdAt,
            type: 'PRODUCED',
            productId: item.productId,
            productName: item.product.name,
            unitType: item.product.unitType,
            basePrice: Number(item.product.basePrice),
            quantity: item.quantityProduced,
            returnedQuantity: returnedQty,
            netQuantity: netQty,
            subtotal,
            sourceName: item.batch.user?.fullName || 'Bakery Staff',
            userRole: item.batch.user?.role || '',
            userId: item.batch.userId || '',
            sessionId: item.batch.sessionId || null,
            branchName: item.batch.branch?.name || '',
            notes: item.batch.shift ? `Shift: ${item.batch.shift}` : 'Daily Batch',
          });
        }
      }

      // 2. Fetch Supplier Deliveries (Resell Products)
      if (typeFilter === 'ALL' || typeFilter === 'RESELL') {
        const delWhere: any = {};
        if (supplierId) {
          delWhere.supplierId = supplierId;
        }
        if (branchId) {
          delWhere.supplier = { branchId };
        }
        if (productId) delWhere.productId = productId;
        if (startDate && endDate) {
          delWhere.createdAt = {
            gte: new Date(`${startDate}T00:00:00.000`),
            lte: new Date(`${endDate}T23:59:59.999`),
          };
        }

        const deliveries = await prisma.supplierDelivery.findMany({
          where: delWhere,
          include: {
            product: true,
            supplier: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 500,
        });

        for (const del of deliveries) {
          const returnedQty = del.returnedQuantity || 0;
          const netQty = Math.max(0, del.quantityReceived - returnedQty);
          const subtotal = Number(del.unitSellPrice) * netQty;

          records.push({
            id: `resell_${del.id}`,
            rawId: del.id,
            date: del.createdAt,
            createdAt: del.createdAt,
            type: 'RESELL',
            productId: del.productId,
            productName: del.product.name,
            unitType: del.product.unitType,
            basePrice: Number(del.unitSellPrice),
            unitBuyPrice: Number(del.unitBuyPrice),
            quantity: del.quantityReceived,
            returnedQuantity: returnedQty,
            netQuantity: netQty,
            subtotal,
            sourceName: del.supplier?.name || 'External Supplier',
            sessionId: del.sessionId || null,
            branchName: '',
            notes: del.isPaid ? 'Paid Cash' : 'Supplier Credit',
          });
        }
      }

      // Sort combined records by date descending
      records.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      // Filter by search query if provided
      const filteredRecords = search
        ? records.filter(
            (r) =>
              r.productName.toLowerCase().includes(search) ||
              r.sourceName.toLowerCase().includes(search) ||
              r.type.toLowerCase().includes(search)
          )
        : records;

      const totalProducedQuantity = filteredRecords
        .filter((r) => r.type === 'PRODUCED')
        .reduce((sum, r) => sum + r.netQuantity, 0);

      const totalResellQuantity = filteredRecords
        .filter((r) => r.type === 'RESELL')
        .reduce((sum, r) => sum + r.netQuantity, 0);

      const totalValuation = filteredRecords.reduce((sum, r) => sum + r.subtotal, 0);

      return {
        data: {
          records: filteredRecords,
          summary: {
            totalProducedQuantity,
            totalResellQuantity,
            totalValuation,
            count: filteredRecords.length,
          },
        },
      };
    } catch (err: any) {
      return { error: err.message || 'Failed to fetch daily product history', status: 500 };
    }
  }

  async updateProductionItemReturn(itemId: string, returnedQuantity: number, user?: { id: string; role: string }): ServiceResult {
    try {
      const item = await prisma.productionItem.findUnique({
        where: { id: itemId },
        include: { batch: true },
      });
      if (!item) {
        return { error: 'Production item not found', status: 404 };
      }

      const isAdminOrOwner = user?.role === 'ADMIN' || user?.role === 'OWNER';
      if (!isAdminOrOwner && (item.batch.status === 'COMPLETED' || item.batch.status === 'REJECTED')) {
        return {
          error: `Item returns for ${item.batch.status.toLowerCase()} production batches cannot be modified by producers.`,
          status: 403,
        };
      }

      const updated = await prisma.productionItem.update({
        where: { id: itemId },
        data: { returnedQuantity: Math.max(0, parseInt(String(returnedQuantity), 10) || 0) },
      });
      return { data: updated };
    } catch (e: any) {
      return { error: e.message || 'Failed to update item returns', status: 500 };
    }
  }
}
