import { prisma } from '../../lib/prisma.js';
import { businessDateFromYmdString, businessDateUtcNoon, parseYmd } from '../../lib/businessDate.js';
import type { ServiceResponse, ServiceResult } from '../../types/service-response.js';

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
    userId?: string
  ): ServiceResult {
    if (!branchId) {
      return { error: 'branchId required', status: 400 };
    }

    const where: any = { branchId };
    if (status) where.status = status;
    if (shift) where.shift = shift;
    if (userId) where.userId = userId;

    if (date) {
      const p = parseYmd(date);
      if (p) where.date = businessDateUtcNoon(p.y, p.mo, p.day);
    }

    if (role) {
      where.user = { role };
    }

    const list = await prisma.productionBatch.findMany({
      where,
      include: {
        user: { select: { id: true, fullName: true, role: true } },
        items: { include: { product: { select: { id: true, name: true, unitType: true, basePrice: true } } } },
        materialUsages: { include: { stockItem: { select: { id: true, name: true, unitType: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return { data: list };
  }

  async getProductionBatchById(id: string): ServiceResult {
    const batch = await prisma.productionBatch.findUnique({
      where: { id },
      include: {
        branch: true,
        user: true,
        items: { include: { product: true } },
        materialUsages: { include: { stockItem: true } },
      },
    });
    if (!batch) {
      return { error: 'Batch not found', status: 404 };
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

    // Pre-validate stock availability if material usages are provided
    for (const m of materialUsages || []) {
      const used = decimalToNum(m.quantityUsed);
      if (used <= 0) {
        return { error: `Invalid material quantity for stock item ${m.stockItemId}`, status: 400 };
      }
      const item = await prisma.stockItem.findUnique({ where: { id: m.stockItemId } });
      if (!item) {
        return { error: `Stock item not found: ${m.stockItemId}`, status: 404 };
      }
      if (Number(item.currentQuantity) < used) {
        return {
          error: `Insufficient stock for '${item.name}'. Available: ${item.currentQuantity} ${item.unitType}, required: ${used}`,
          status: 400,
        };
      }
    }

    // Check active session status for branch
    const activeSession = await prisma.dailySession.findFirst({
      where: {
        branchId: bid,
        status: { in: ['OPEN', 'PAUSED', 'CLOSE_PENDING', 'CLOSED'] },
      },
      orderBy: { date: 'desc' },
    });

    if (!activeSession || activeSession.status !== 'OPEN') {
      const statusLabel = activeSession ? activeSession.status : 'CLOSED';
      return {
        error: `Daily session is currently ${statusLabel}. Production cannot be logged when a session is paused or closed.`,
        status: 400,
      };
    }

    // Check creator role for automatic approval vs pending approval
    const creator = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    const isAutoApproved = creator?.role === 'OWNER' || creator?.role === 'ADMIN';
    const initialStatus = isAutoApproved ? 'COMPLETED' : 'PENDING_APPROVAL';

    // Pre-fetch product names for human readable stock movement reason
    const itemProductIds = items.map((i: any) => i.productId);
    const itemProducts = await prisma.product.findMany({
      where: { id: { in: itemProductIds } },
      select: { id: true, name: true },
    });
    const productNamesSummary = itemProducts.map((p) => p.name).join(', ') || 'Batch';

    // Execute atomic transaction for batch creation
    const result = await prisma.$transaction(async (tx) => {
      const batch = await tx.productionBatch.create({
        data: {
          branchId: bid,
          userId,
          sessionId: activeSession?.id || null,
          date: batchDate,
          shift: (shift as any) || null,
          status: initialStatus,
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

      // Deduct stock & log movement ledger ONLY if auto-approved by Owner/Admin
      if (isAutoApproved) {
        for (const m of materialUsages || []) {
          const used = decimalToNum(m.quantityUsed);
          await tx.stockItem.update({
            where: { id: m.stockItemId },
            data: { currentQuantity: { decrement: used } },
          });
          await tx.stockMovement.create({
            data: {
              stockItemId: m.stockItemId,
              userId,
              quantity: used,
              type: 'PRODUCTION_USAGE',
              reason: `Production Usage (${productNamesSummary})`,
            },
          });
        }
      }

      return batch;
    });

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

    // Check stock availability
    for (const m of batch.materialUsages) {
      const used = Number(m.quantityUsed);
      const stock = Number(m.stockItem.currentQuantity);
      if (stock < used) {
        return {
          error: `Insufficient stock for '${m.stockItem.name}'. Available: ${stock} ${m.stockItem.unitType}, required: ${used}`,
          status: 400,
        };
      }
    }

    const adminUser = await prisma.user.findUnique({
      where: { id: adminUserId },
      select: { fullName: true, role: true },
    });

    const productNamesSummary = batch.items.map((i) => i.product.name).join(', ') || 'Batch';

    const updated = await prisma.$transaction(async (tx) => {
      // Deduct stock & create movement records
      for (const m of batch.materialUsages) {
        const used = Number(m.quantityUsed);
        await tx.stockItem.update({
          where: { id: m.stockItemId },
          data: { currentQuantity: { decrement: used } },
        });

        const itemUnitPrice = Number(m.stockItem.unitPrice ?? 0);

        // Log movement attributed to the person who used/produced the item (batch.userId)
        await tx.stockMovement.create({
          data: {
            stockItemId: m.stockItemId,
            userId: batch.userId,
            quantity: used,
            unitPrice: itemUnitPrice,
            totalValue: used * itemUnitPrice,
            type: 'PRODUCTION_USAGE',
            reason: `Production Usage (${productNamesSummary}) [Used by ${batch.user?.fullName || 'Worker'}${adminUser ? `, Approved by ${adminUser.fullName}` : ''}]`,
          },
        });
      }

      return await tx.productionBatch.update({
        where: { id },
        data: { status: 'COMPLETED' },
        include: {
          user: { select: { id: true, fullName: true } },
          items: { include: { product: true } },
          materialUsages: { include: { stockItem: true } },
        },
      });
    });

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

    const updated = await prisma.productionBatch.update({
      where: { id },
      data: { status: 'REJECTED' },
      include: {
        user: { select: { id: true, fullName: true } },
        items: { include: { product: true } },
        materialUsages: { include: { stockItem: true } },
      },
    });

    return { data: updated };
  }

  async updateProductionBatch(id: string, body: any, user?: { id: string; role: string }): ServiceResult {
    const { date, shift, status, items, materialUsages } = body;
    const existing = await prisma.productionBatch.findUnique({ where: { id } });
    if (!existing) {
      return { error: 'Production batch not found', status: 404 };
    }

    const isAdminOrOwner = user?.role === 'ADMIN' || user?.role === 'OWNER';

    // Lockout Enforcement: Producer roles (BAKER, CAKE_WORKER, SAMBUSA_WORKER) cannot edit an approved/completed or rejected batch
    if (!isAdminOrOwner && (existing.status === 'COMPLETED' || existing.status === 'REJECTED')) {
      return {
        error: `Production batch is already ${existing.status.toLowerCase()} and cannot be modified by producer roles.`,
        status: 403,
      };
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
          user: { select: { id: true, fullName: true } },
          items: { include: { product: true } },
          materialUsages: { include: { stockItem: true } },
        },
      });
    });

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
        for (const usage of batch.materialUsages) {
          const qty = Number(usage.quantityUsed);
          if (qty > 0) {
            await tx.stockItem.update({
              where: { id: usage.stockItemId },
              data: { currentQuantity: { increment: qty } },
            });
            await tx.stockMovement.create({
              data: {
                stockItemId: usage.stockItemId,
                userId: batch.userId,
                quantity: qty,
                type: 'IN',
                reason: `Reverted production batch deletion (${id})`,
              },
            });
          }
        }
        await tx.productionBatch.delete({
          where: { id },
        });
      });

      return { data: { message: 'Production batch deleted and stock restored successfully' } };
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
