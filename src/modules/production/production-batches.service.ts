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
  async getProductionBatches(branchId?: string | null, date?: string, status?: string): ServiceResult {
    if (!branchId) {
      return { error: 'branchId required', status: 400 };
    }

    const where: any = { branchId };
    if (status) where.status = status;

    if (date) {
      const p = parseYmd(date);
      if (p) where.date = businessDateUtcNoon(p.y, p.mo, p.day);
    }

    const list = await prisma.productionBatch.findMany({
      where,
      include: {
        user: { select: { id: true, fullName: true } },
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

    // Find or automatically create/open an active DailySession for this branch & batchDate
    let activeSession = await prisma.dailySession.findFirst({
      where: {
        branchId: bid,
        status: 'OPEN',
      },
    });

    if (!activeSession) {
      activeSession = await prisma.dailySession.findFirst({
        where: {
          branchId: bid,
          date: batchDate,
        },
      });
    }

    if (activeSession && activeSession.status === 'CLOSED') {
      return {
        error: 'The business session for this date is CLOSED. Production cannot be added to a closed session.',
        status: 400,
      };
    }

    if (activeSession && activeSession.status === 'PAUSED') {
      return {
        error: 'The business session is currently PAUSED. Production cannot be added to a paused session.',
        status: 400,
      };
    }

    if (!activeSession) {
      // Auto-open a new daily session for this branch & date
      try {
        activeSession = await prisma.dailySession.create({
          data: {
            branchId: bid,
            date: batchDate,
            status: 'OPEN',
          },
        });
      } catch (err: any) {
        // Fallback if session was created concurrently
        activeSession = await prisma.dailySession.findFirst({
          where: { branchId: bid, date: batchDate },
        });
        if (activeSession && activeSession.status === 'CLOSED') {
          return {
            error: 'The business session for this date is CLOSED. Production cannot be added to a closed session.',
            status: 400,
          };
        }
      }
    }

    // Check creator role for automatic approval vs pending approval
    const creator = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    const isAutoApproved = creator?.role === 'OWNER' || creator?.role === 'ADMIN';
    const initialStatus = isAutoApproved ? 'COMPLETED' : 'PENDING_APPROVAL';

    // Enforce rule: No 2 production tasks running/pending at the same time for the same worker
    if (!isAutoApproved) {
      const activePendingTask = await prisma.productionBatch.findFirst({
        where: {
          branchId: bid,
          userId,
          status: { in: ['PENDING_APPROVAL', 'STARTED'] },
        },
      });

      if (activePendingTask) {
        return {
          error: 'You already have an active production task pending approval. There cannot be 2 tasks at the same time.',
          status: 400,
        };
      }
    }

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

        // Log movement attributed to the person who used/produced the item (batch.userId)
        await tx.stockMovement.create({
          data: {
            stockItemId: m.stockItemId,
            userId: batch.userId,
            quantity: used,
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

  async updateProductionBatch(id: string, body: { status?: string }): ServiceResult {
    const { status } = body;
    const batch = await prisma.productionBatch.update({
      where: { id },
      data: status ? { status: status as any } : {},
      include: {
        user: { select: { id: true, fullName: true } },
        items: { include: { product: true } },
        materialUsages: { include: { stockItem: true } },
      },
    });
    return { data: batch };
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
}
