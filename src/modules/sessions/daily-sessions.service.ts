import { prisma } from '../../lib/prisma.js';
import { Prisma } from '@prisma/client';
import { businessDateUtcNoon, dateToYmdUtc, parseYmd, utcDayRangeInclusive } from '../../lib/businessDate.js';
import type { ServiceResponse, ServiceResult } from '../../types/service-response.js';

function decimalToNum(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseFloat(v);
  return 0;
}

export class DailySessionsService {
  async getDailySessions(branchId?: string | null, from?: string, to?: string, status?: string): ServiceResult {
    if (!branchId) {
      return { error: 'branchId required', status: 400 };
    }
    const where: any = { branchId };
    if (status) where.status = status;
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = new Date(from);
      if (to) where.date.lte = new Date(to);
    }
    const list = await prisma.dailySession.findMany({
      where,
      include: {
        _count: { select: { sales: true, leftoverRecords: true } },
      },
      orderBy: { date: 'desc' },
    });
    return { data: list };
  }

  async getDailySessionById(id: string): ServiceResult {
    const session = await prisma.dailySession.findUnique({
      where: { id },
      include: {
        branch: true,
        sales: { include: { user: true, items: { include: { product: true } } } },
        expenses: { include: { financialCategory: true, user: true } },
        leftoverRecords: { include: { product: true } },
        supplierDeliveries: { include: { supplier: true, product: true } },
      },
    });
    if (!session) {
      return { error: 'Session not found', status: 404 };
    }

    // Aggregate production totals per product for this session/date
    const batches = await prisma.productionBatch.findMany({
      where: {
        branchId: session.branchId,
        OR: [
          { sessionId: id },
          { date: session.date },
        ],
      },
      include: {
        items: {
          include: {
            product: {
              include: {
                category: { select: { id: true, name: true, type: true } },
              },
            },
          },
        },
        user: { select: { id: true, fullName: true, role: true } },
      },
    });

    const prodMap: Record<
      string,
      {
        productId: string;
        productName: string;
        unitType: string;
        categoryName: string;
        categoryType: string;
        totalProduced: number;
      }
    > = {};
    for (const b of batches) {
      for (const item of b.items) {
        if (!prodMap[item.productId]) {
          prodMap[item.productId] = {
            productId: item.productId,
            productName: item.product.name,
            unitType: item.product.unitType,
            categoryName: item.product.category?.name || 'Uncategorized',
            categoryType: item.product.category?.type || 'PRODUCED',
            totalProduced: 0,
          };
        }
        prodMap[item.productId].totalProduced += item.quantityProduced;
      }
    }
    const productionSummary = Object.values(prodMap);

    // Compute Sales and Max Available Stock per product for session validation
    const sales = await prisma.sale.findMany({
      where: { sessionId: id },
      include: { items: true },
    });
    const soldMap: Record<string, number> = {};
    for (const s of sales) {
      for (const item of s.items) {
        soldMap[item.productId] = (soldMap[item.productId] || 0) + item.quantity;
      }
    }

    const delivMap: Record<string, number> = {};
    for (const d of session.supplierDeliveries || []) {
      delivMap[d.productId] = (delivMap[d.productId] || 0) + d.quantityReceived;
    }

    // Compute Product Conversions in this session
    const conversions = await prisma.productConversion.findMany({
      where: { branchId: session.branchId, createdAt: { gte: session.date } },
    });
    const convertedOutMap: Record<string, number> = {};
    const convertedInMap: Record<string, number> = {};
    for (const c of conversions) {
      convertedOutMap[c.fromProductId] = (convertedOutMap[c.fromProductId] || 0) + c.fromQuantity;
      convertedInMap[c.toProductId] = (convertedInMap[c.toProductId] || 0) + c.toQuantity;
    }

    const availableStockSummary: Record<
      string,
      {
        productId: string;
        productName: string;
        unitType: string;
        categoryName: string;
        producedQty: number;
        deliveredQty: number;
        soldQty: number;
        convertedOutQty: number;
        convertedInQty: number;
        maxAvailable: number;
      }
    > = {};

    const allPids = new Set([
      ...Object.keys(prodMap),
      ...Object.keys(delivMap),
      ...Object.keys(soldMap),
      ...Object.keys(convertedOutMap),
      ...Object.keys(convertedInMap),
      ...(session.leftoverRecords || []).map((r) => r.productId),
    ]);

    for (const pid of allPids) {
      const prodItem = prodMap[pid];
      const delivQty = delivMap[pid] || 0;
      const prodQty = prodItem?.totalProduced || 0;
      const soldQty = soldMap[pid] || 0;
      const convertedOutQty = convertedOutMap[pid] || 0;
      const convertedInQty = convertedInMap[pid] || 0;
      const pName =
        prodItem?.productName ||
        session.leftoverRecords.find((r) => r.productId === pid)?.product?.name ||
        'Product';
      const uType =
        prodItem?.unitType ||
        session.leftoverRecords.find((r) => r.productId === pid)?.product?.unitType ||
        'Pcs';
      const catName = prodItem?.categoryName || 'Bakery';
      const maxAvailable = Math.max(0, prodQty + delivQty + convertedInQty - soldQty - convertedOutQty);

      availableStockSummary[pid] = {
        productId: pid,
        productName: pName,
        unitType: uType,
        categoryName: catName,
        producedQty: prodQty,
        deliveredQty: delivQty,
        soldQty,
        convertedOutQty,
        convertedInQty,
        maxAvailable,
      };
    }

    return {
      data: {
        ...session,
        productionBatches: batches,
        productionSummary,
        availableStockSummary,
      },
    };
  }

  async createDailySession(body: any, userBranchId?: string | null): ServiceResult {
    const { branchId, date, label } = body;
    let bid = branchId || userBranchId;
    if (!bid) {
      const defaultBranch = await prisma.branch.findFirst({ where: { isActive: true } });
      bid = defaultBranch?.id || null;
    }

    if (!bid || !date) {
      return { error: 'branchId and date required', status: 400 };
    }

    // Enforce constraint: No 2 active sessions (OPEN or PAUSED) at the same time
    const existingActiveSession = await prisma.dailySession.findFirst({
      where: {
        branchId: bid,
        status: { in: ['OPEN', 'PAUSED'] },
      },
    });

    if (existingActiveSession) {
      return {
        error: `An active daily session is currently ${existingActiveSession.status}. There cannot be 2 sessions at the same time for a branch.`,
        status: 400,
      };
    }

    const parts = parseYmd(date);
    if (!parts) {
      return { error: 'Invalid date format (YYYY-MM-DD)', status: 400 };
    }

    const { y, mo, day } = parts;
    const d = businessDateUtcNoon(y, mo, day);

    const existing = await prisma.dailySession.findFirst({
      where: {
        branchId: bid,
        date: d,
      },
    });

    if (existing) {
      if (existing.status === 'CLOSED') {
        return {
          error: "Session for today has already been closed. A new session can only be opened on the next calendar day.",
          status: 400,
        };
      }
      if (existing.status === 'PAUSED') {
        const reopened = await prisma.dailySession.update({
          where: { id: existing.id },
          data: { status: 'OPEN', ...(label ? { label: label.trim() } : {}) },
        });
        return { data: reopened };
      }
      return { data: existing };
    }

    const sessionLabel = label?.trim() || `Session - ${dateToYmdUtc(d)}`;

    try {
      // Find most recent closed session to seed opening float and leftover inventory
      const previousClosed = await prisma.dailySession.findFirst({
        where: {
          branchId: bid,
          status: 'CLOSED',
          date: { lt: d },
        },
        include: { leftoverRecords: true },
        orderBy: { date: 'desc' },
      });

      const carriedFloat = previousClosed?.cashLeftoverAmount != null
        ? decimalToNum(previousClosed.cashLeftoverAmount)
        : (previousClosed?.actualCashAmount != null ? decimalToNum(previousClosed.actualCashAmount) : 0);

      const openingFloatVal = body.openingCashFloat != null && body.openingCashFloat !== ''
        ? decimalToNum(body.openingCashFloat)
        : carriedFloat;

      const session = await prisma.dailySession.create({
        data: {
          branchId: bid,
          date: d,
          status: 'OPEN',
          label: sessionLabel,
          openingCashFloat: openingFloatVal,
        },
      });

      const carryRows = (previousClosed?.leftoverRecords ?? [])
        .filter((r) => r.quantityRemaining > 0)
        .map((r) => ({
          sessionId: session.id,
          productId: r.productId,
          quantityRemaining: r.quantityRemaining,
        }));

      if (carryRows.length > 0) {
        await prisma.leftoverRecord.createMany({
          data: carryRows,
          skipDuplicates: true,
        });
      }

      return { data: session };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const existingRec = await prisma.dailySession.findFirst({ where: { branchId: bid, date: d } });
        if (existingRec) {
          const reopened = await prisma.dailySession.update({
            where: { id: existingRec.id },
            data: { status: 'OPEN' },
          });
          return { data: reopened };
        }
        return { error: 'Session already exists for this branch and date', status: 400 };
      }
      throw e;
    }
  }

  private async checkLeftoverStockLimits(session: any, leftoverRecords: any[]): Promise<string | null> {
    if (!Array.isArray(leftoverRecords) || leftoverRecords.length === 0) return null;

    const batches = await prisma.productionBatch.findMany({
      where: {
        branchId: session.branchId,
        OR: [{ sessionId: session.id }, { date: session.date }],
        status: { in: ['STARTED', 'COMPLETED', 'PENDING_APPROVAL'] },
      },
      include: { items: true },
    });
    const producedMap: Record<string, number> = {};
    for (const b of batches) {
      for (const item of b.items) {
        producedMap[item.productId] = (producedMap[item.productId] || 0) + item.quantityProduced;
      }
    }

    const deliveries = await prisma.supplierDelivery.findMany({
      where: { sessionId: session.id },
    });
    const delivMap: Record<string, number> = {};
    for (const d of deliveries) {
      delivMap[d.productId] = (delivMap[d.productId] || 0) + d.quantityReceived;
    }

    const sales = await prisma.sale.findMany({
      where: { sessionId: session.id },
      include: { items: true },
    });
    const soldMap: Record<string, number> = {};
    for (const s of sales) {
      for (const item of s.items) {
        soldMap[item.productId] = (soldMap[item.productId] || 0) + item.quantity;
      }
    }

    for (const row of leftoverRecords) {
      const pid = typeof row.productId === 'string' ? row.productId.trim() : '';
      if (!pid) continue;
      const qRem = typeof row.quantityRemaining === 'number' ? row.quantityRemaining : parseInt(String(row.quantityRemaining ?? '0'), 10);
      if (qRem <= 0) continue;

      const prod = producedMap[pid] || 0;
      const deliv = delivMap[pid] || 0;
      const sold = soldMap[pid] || 0;
      const maxAvailable = Math.max(0, prod + deliv - sold);

      if (qRem > maxAvailable) {
        const prodObj = await prisma.product.findUnique({ where: { id: pid }, select: { name: true } });
        const name = prodObj?.name || 'Product';
        return `Cannot set leftover of ${qRem} Pcs for ${name}. Maximum available stock in this session is ${maxAvailable} Pcs (Produced/Delivered: ${prod + deliv}, Sold: ${sold}). Please correct the amount.`;
      }
    }

    return null;
  }

  async updateDailySession(id: string, body: any, userId?: string): ServiceResult {
    const {
      status,
      cashLeftoverAmount,
      actualCashAmount,
      actualCbeAmount,
      actualTelebirrAmount,
      notes,
      label,
      leftoverRecords,
      expenses,
    } = body;

    const existingSession = await prisma.dailySession.findUnique({ where: { id } });
    if (!existingSession) {
      return { error: 'Session not found', status: 404 };
    }

    // Lockout Enforcement: CLOSED or CLOSE_PENDING sessions cannot be edited
    const ethTodayYmd = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
    const sessionYmd = dateToYmdUtc(existingSession.date);
    if (sessionYmd < ethTodayYmd || existingSession.status === 'CLOSED' || existingSession.status === 'CLOSE_PENDING') {
      return { error: 'Session editing is locked after midnight or once closed/pending approval.', status: 400 };
    }

    // Stock Limit Validation for Leftover Products
    if (Array.isArray(leftoverRecords) && leftoverRecords.length > 0) {
      const stockErr = await this.checkLeftoverStockLimits(existingSession, leftoverRecords);
      if (stockErr) return { error: stockErr, status: 400 };
    }

    const data: any = {};
    if (status) data.status = status;
    if (label !== undefined) data.label = label ? String(label).trim() : null;
    if (notes !== undefined) data.notes = notes ? String(notes).trim() : null;
    if (cashLeftoverAmount !== undefined) {
      data.cashLeftoverAmount = cashLeftoverAmount === null || cashLeftoverAmount === '' ? null : decimalToNum(cashLeftoverAmount);
    }
    if (actualCashAmount !== undefined) {
      data.actualCashAmount = actualCashAmount === null || actualCashAmount === '' ? null : decimalToNum(actualCashAmount);
    }
    if (actualCbeAmount !== undefined) {
      data.actualCbeAmount = actualCbeAmount === null || actualCbeAmount === '' ? null : decimalToNum(actualCbeAmount);
    }
    if (actualTelebirrAmount !== undefined) {
      data.actualTelebirrAmount = actualTelebirrAmount === null || actualTelebirrAmount === '' ? null : decimalToNum(actualTelebirrAmount);
    }

    // 1. Save expenses if provided
    if (Array.isArray(expenses)) {
      for (const exp of expenses) {
        if (exp.id) {
          await prisma.expense.update({
            where: { id: exp.id },
            data: {
              amount: decimalToNum(exp.amount),
              category: exp.category || 'MISC',
              description: exp.description || null,
            },
          });
        } else if (exp.amount && Number(exp.amount) > 0) {
          await prisma.expense.create({
            data: {
              branchId: existingSession.branchId,
              userId: userId || existingSession.id,
              sessionId: id,
              date: existingSession.date,
              amount: decimalToNum(exp.amount),
              category: exp.category || 'MISC',
              description: exp.description || null,
              type: 'COMPANY',
            },
          });
        }
      }
    }

    // 2. Upsert Leftover records if provided
    if (Array.isArray(leftoverRecords)) {
      for (const row of leftoverRecords) {
        const pid = typeof row.productId === 'string' ? row.productId.trim() : '';
        if (!pid) continue;
        const qRem = typeof row.quantityRemaining === 'number' ? row.quantityRemaining : parseInt(String(row.quantityRemaining ?? '0'), 10);
        const qDam = typeof row.damagedQuantity === 'number' ? row.damagedQuantity : parseInt(String(row.damagedQuantity ?? '0'), 10);

        await prisma.leftoverRecord.upsert({
          where: { sessionId_productId: { sessionId: id, productId: pid } },
          create: {
            sessionId: id,
            productId: pid,
            quantityRemaining: Math.max(0, qRem || 0),
            damagedQuantity: Math.max(0, qDam || 0),
            damageReason: row.damageReason ? String(row.damageReason).trim() : null,
          },
          update: {
            quantityRemaining: Math.max(0, qRem || 0),
            damagedQuantity: Math.max(0, qDam || 0),
            damageReason: row.damageReason ? String(row.damageReason).trim() : null,
          },
        });
      }
    }

    const updatedSession = await prisma.dailySession.update({
      where: { id },
      data,
      include: {
        expenses: true,
        leftoverRecords: { include: { product: true } },
      },
    });

    return { data: updatedSession };
  }

  async submitCloseRequest(sessionId: string, body: any, userId: string): ServiceResult {
    const { actualCashAmount, actualCbeAmount, actualTelebirrAmount, cashLeftoverAmount, notes, label, leftoverRecords, expenses } = body;

    const session = await prisma.dailySession.findUnique({
      where: { id: sessionId },
      include: { leftoverRecords: true },
    });

    if (!session) {
      return { error: 'Session not found', status: 404 };
    }
    if (session.status === 'CLOSED' || session.status === 'CLOSE_PENDING') {
      return { error: `Session is already ${session.status === 'CLOSED' ? 'CLOSED' : 'submitted for closure'}. Cashiers cannot edit closed sessions.`, status: 400 };
    }

    if (Array.isArray(leftoverRecords) && leftoverRecords.length > 0) {
      const stockErr = await this.checkLeftoverStockLimits(session, leftoverRecords);
      if (stockErr) return { error: stockErr, status: 400 };
    }

    // 1. Upsert Leftover records
    if (Array.isArray(leftoverRecords)) {
      for (const row of leftoverRecords) {
        const pid = typeof row.productId === 'string' ? row.productId.trim() : '';
        if (!pid) continue;
        const qRem = typeof row.quantityRemaining === 'number' ? row.quantityRemaining : parseInt(String(row.quantityRemaining ?? '0'), 10);
        const qDam = typeof row.damagedQuantity === 'number' ? row.damagedQuantity : parseInt(String(row.damagedQuantity ?? '0'), 10);

        await prisma.leftoverRecord.upsert({
          where: { sessionId_productId: { sessionId, productId: pid } },
          create: {
            sessionId,
            productId: pid,
            quantityRemaining: Math.max(0, qRem || 0),
            damagedQuantity: Math.max(0, qDam || 0),
            damageReason: row.damageReason ? String(row.damageReason).trim() : null,
          },
          update: {
            quantityRemaining: Math.max(0, qRem || 0),
            damagedQuantity: Math.max(0, qDam || 0),
            damageReason: row.damageReason ? String(row.damageReason).trim() : null,
          },
        });
      }
    }

    // 2. Handle Expenses (create new or update existing)
    if (Array.isArray(expenses)) {
      for (const exp of expenses) {
        if (exp.id) {
          await prisma.expense.update({
            where: { id: exp.id },
            data: {
              amount: decimalToNum(exp.amount),
              category: exp.category || 'MISC',
              description: exp.description || null,
            },
          });
        } else if (exp.amount && Number(exp.amount) > 0) {
          await prisma.expense.create({
            data: {
              branchId: session.branchId,
              userId,
              sessionId,
              date: session.date,
              amount: decimalToNum(exp.amount),
              category: exp.category || 'MISC',
              description: exp.description || null,
              type: 'COMPANY',
            },
          });
        }
      }
    }

    // 3. Set status to CLOSE_PENDING with cash breakdown & optional label
    const updated = await prisma.dailySession.update({
      where: { id: sessionId },
      data: {
        status: 'CLOSE_PENDING',
        actualCashAmount: actualCashAmount != null ? decimalToNum(actualCashAmount) : undefined,
        actualCbeAmount: actualCbeAmount != null ? decimalToNum(actualCbeAmount) : undefined,
        actualTelebirrAmount: actualTelebirrAmount != null ? decimalToNum(actualTelebirrAmount) : undefined,
        notes: notes ? String(notes) : undefined,
        label: label ? String(label).trim() : undefined,
      },
      include: {
        expenses: true,
        leftoverRecords: { include: { product: true } },
      },
    });

    return { data: updated };
  }

  async finalizeDailySession(sessionId: string, body: any, userId: string): ServiceResult {
    const cashLeftoverAmountRaw = body.cashLeftoverAmount;
    const { leftoverRecords, actualCashAmount, actualCbeAmount, actualTelebirrAmount, notes, label, expenses } = body;

    const session = await prisma.dailySession.findUnique({
      where: { id: sessionId },
      include: { leftoverRecords: true },
    });

    if (!session) {
      return { error: 'Session not found', status: 404 };
    }
    if (session.status === 'CLOSED') {
      return { error: 'Session already closed', status: 400 };
    }

    // Process expenses if provided
    if (Array.isArray(expenses)) {
      for (const exp of expenses) {
        if (exp.id) {
          await prisma.expense.update({
            where: { id: exp.id },
            data: {
              amount: decimalToNum(exp.amount),
              category: exp.category || 'MISC',
              description: exp.description || null,
            },
          });
        } else if (exp.amount && Number(exp.amount) > 0) {
          await prisma.expense.create({
            data: {
              branchId: session.branchId,
              userId,
              sessionId,
              date: session.date,
              amount: decimalToNum(exp.amount),
              category: exp.category || 'MISC',
              description: exp.description || null,
              type: 'COMPANY',
            },
          });
        }
      }
    }

    const cashLeftoverAmount =
      cashLeftoverAmountRaw === undefined || cashLeftoverAmountRaw === null || cashLeftoverAmountRaw === ''
        ? null
        : decimalToNum(cashLeftoverAmountRaw);

    const sessionBusinessDate = session.date;

    // Upsert leftover records (including damaged quantities)
    for (const row of leftoverRecords) {
      const pid = typeof row.productId === 'string' ? row.productId.trim() : '';
      if (!pid) continue;
      const rawRem = row.quantityRemaining;
      const qRem = typeof rawRem === 'number' ? rawRem : parseInt(String(rawRem ?? '0'), 10);
      const quantityRemaining = Number.isFinite(qRem) ? Math.max(0, Math.floor(qRem)) : 0;

      const rawDam = row.damagedQuantity;
      const qDam = typeof rawDam === 'number' ? rawDam : parseInt(String(rawDam ?? '0'), 10);
      const damagedQuantity = Number.isFinite(qDam) ? Math.max(0, Math.floor(qDam)) : 0;

      const damageReason = typeof row.damageReason === 'string' ? row.damageReason.trim() : null;

      await prisma.leftoverRecord.upsert({
        where: {
          sessionId_productId: { sessionId, productId: pid },
        },
        create: {
          sessionId,
          productId: pid,
          quantityRemaining,
          damagedQuantity,
          damageReason,
        },
        update: { quantityRemaining, damagedQuantity, damageReason },
      });
    }

    // Opening leftovers from previous closed day
    const previousClosed = await prisma.dailySession.findFirst({
      where: {
        branchId: session.branchId,
        status: 'CLOSED',
        date: { lt: sessionBusinessDate },
      },
      include: { leftoverRecords: true },
      orderBy: { date: 'desc' },
    });

    const openingByProduct: Record<string, number> = {};
    for (const row of previousClosed?.leftoverRecords ?? []) {
      openingByProduct[row.productId] = (openingByProduct[row.productId] ?? 0) + row.quantityRemaining;
    }

    // Production totals for this session's calendar date
    const batches = await prisma.productionBatch.findMany({
      where: {
        branchId: session.branchId,
        date: sessionBusinessDate,
      },
      include: { items: { include: { product: true } } },
    });

    const producedByProduct: Record<string, number> = {};
    for (const batch of batches) {
      for (const item of batch.items) {
        producedByProduct[item.productId] = (producedByProduct[item.productId] ?? 0) + item.quantityProduced;
      }
    }

    // Supplier purchases received this calendar day
    const sessionYmd = dateToYmdUtc(sessionBusinessDate);
    const dayRange = utcDayRangeInclusive(sessionYmd);
    const boughtByProduct: Record<string, number> = {};

    if (dayRange) {
      const dayDeliveries = await prisma.supplierDelivery.findMany({
        where: {
          supplier: { branchId: session.branchId },
          createdAt: { gte: dayRange.start, lte: dayRange.end },
        },
      });

      for (const d of dayDeliveries) {
        const net = Math.max(0, d.quantityReceived - (d.returnedQuantity ?? 0));
        if (net <= 0) continue;
        boughtByProduct[d.productId] = (boughtByProduct[d.productId] ?? 0) + net;
      }
    }

    // Product conversions recorded during this session's calendar day
    const convertedInByProduct: Record<string, number> = {};
    const convertedOutByProduct: Record<string, number> = {};

    if (dayRange) {
      const dayConversions = await prisma.productConversion.findMany({
        where: {
          branchId: session.branchId,
          createdAt: { gte: dayRange.start, lte: dayRange.end },
        },
      });

      for (const c of dayConversions) {
        convertedOutByProduct[c.fromProductId] = (convertedOutByProduct[c.fromProductId] ?? 0) + c.fromQuantity;
        convertedInByProduct[c.toProductId] = (convertedInByProduct[c.toProductId] ?? 0) + c.toQuantity;
      }
    }

    // Keep rows for products that have opening stock, today's production, purchases, or conversions
    const eligibleForLeftovers = new Set([
      ...Object.keys(openingByProduct),
      ...Object.keys(producedByProduct),
      ...Object.keys(boughtByProduct),
      ...Object.keys(convertedInByProduct),
      ...Object.keys(convertedOutByProduct),
    ]);

    if (eligibleForLeftovers.size === 0) {
      await prisma.leftoverRecord.deleteMany({ where: { sessionId } });
    } else {
      await prisma.leftoverRecord.deleteMany({
        where: { sessionId, productId: { notIn: Array.from(eligibleForLeftovers) } },
      });
    }

    // Leftover totals after upsert + cleanup
    const leftovers = await prisma.leftoverRecord.findMany({
      where: { sessionId },
      include: { product: true },
    });

    const leftoverByProduct: Record<string, number> = {};
    const damagedByProduct: Record<string, number> = {};
    for (const r of leftovers) {
      leftoverByProduct[r.productId] = r.quantityRemaining;
      damagedByProduct[r.productId] = r.damagedQuantity ?? 0;
    }

    // Sold = (opening + produced + bought + convertedIn - convertedOut) - leftover - damaged (per product)
    const productIds = new Set([
      ...Object.keys(openingByProduct),
      ...Object.keys(producedByProduct),
      ...Object.keys(boughtByProduct),
      ...Object.keys(convertedInByProduct),
      ...Object.keys(convertedOutByProduct),
      ...Object.keys(leftoverByProduct),
    ]);

    const saleItems: { productId: string; quantity: number; unitPrice: number; subtotal: number }[] = [];
    let totalAmount = 0;
    const idList = Array.from(productIds);

    const products =
      idList.length > 0
        ? await prisma.product.findMany({
            where: { id: { in: idList } },
          })
        : [];

    const productMap = new Map(products.map((p) => [p.id, p]));

    for (const pid of productIds) {
      const opening = openingByProduct[pid] ?? 0;
      const produced = producedByProduct[pid] ?? 0;
      const bought = boughtByProduct[pid] ?? 0;
      const convertedIn = convertedInByProduct[pid] ?? 0;
      const convertedOut = convertedOutByProduct[pid] ?? 0;
      const available = opening + produced + bought + convertedIn - convertedOut;
      const leftover = leftoverByProduct[pid] ?? 0;
      const damaged = damagedByProduct[pid] ?? 0;
      const sold = Math.max(0, available - leftover - damaged);

      if (sold <= 0) continue;

      const product = productMap.get(pid);
      const unitPrice = product ? Number(product.basePrice) : 0;
      const subtotal = unitPrice * sold;
      totalAmount += subtotal;

      saleItems.push({ productId: pid, quantity: sold, unitPrice, subtotal });
    }

    // Delete existing derived sale, then create one Sale with items
    await prisma.saleItem.deleteMany({ where: { sale: { sessionId } } });
    await prisma.sale.deleteMany({ where: { sessionId } });

    if (saleItems.length > 0) {
      await prisma.sale.create({
        data: {
          sessionId,
          userId,
          totalAmount: new Prisma.Decimal(Math.round(totalAmount * 100) / 100),
          paymentMethod: 'CASH',
          items: {
            create: saleItems.map((i) => ({
              productId: i.productId,
              quantity: i.quantity,
              unitPrice: new Prisma.Decimal(i.unitPrice.toFixed(2)),
              subtotal: new Prisma.Decimal(i.subtotal.toFixed(2)),
            })),
          },
        },
      });
    }

    // Close session
    await prisma.dailySession.update({
      where: { id: sessionId },
      data: {
        status: 'CLOSED',
        ...(cashLeftoverAmount !== null && { cashLeftoverAmount }),
        ...(actualCashAmount != null && { actualCashAmount: decimalToNum(actualCashAmount) }),
        ...(actualCbeAmount != null && { actualCbeAmount: decimalToNum(actualCbeAmount) }),
        ...(actualTelebirrAmount != null && { actualTelebirrAmount: decimalToNum(actualTelebirrAmount) }),
        ...(notes && { notes: String(notes) }),
        ...(label && { label: String(label).trim() }),
      },
    });

    const updated = await prisma.dailySession.findUnique({
      where: { id: sessionId },
      include: {
        sales: { include: { items: { include: { product: true } } } },
        leftoverRecords: { include: { product: true } },
      },
    });

    if (!updated) {
      return { error: 'Session reload failed after close', status: 500 };
    }

    const totalBrr = Math.round(totalAmount * 100) / 100;
    const openingLineItems = Object.values(openingByProduct).filter((q) => q > 0).length;
    const purchaseLineItems = Object.values(boughtByProduct).filter((q) => q > 0).length;

    const dayExpenses = await prisma.expense.findMany({
      where: {
        branchId: session.branchId,
        date: sessionBusinessDate,
        type: 'COMPANY',
      },
    });
    const totalCompanyExpense = dayExpenses.reduce((sum, e) => sum + Number(e.amount), 0);
    const openingFloat = Number(session.openingCashFloat ?? 0);
    const expectedCash = Math.round((openingFloat + totalBrr - totalCompanyExpense) * 100) / 100;

    return {
      data: {
        ...updated,
        _closeSummary: {
          productionBatchCount: batches.length,
          openingLineItems,
          purchaseLineItems,
          derivedLineItems: saleItems.length,
          totalBrr,
          openingCashFloat: openingFloat,
          totalCompanyExpense,
          expectedCash,
          cashLeftoverAmount,
        },
      },
    };
  }

  async getActiveSession(branchId?: string | null): ServiceResult {
    if (!branchId) {
      return { error: 'branchId required', status: 400 };
    }
    const session = await prisma.dailySession.findFirst({
      where: {
        branchId,
        status: 'OPEN',
      },
      include: {
        leftoverRecords: { include: { product: true } },
        _count: { select: { sales: true } },
      },
      orderBy: { date: 'desc' },
    });
    return { data: session };
  }

  async pauseDailySession(id: string): ServiceResult {
    const session = await prisma.dailySession.findUnique({ where: { id } });
    if (!session) {
      return { error: 'Session not found', status: 404 };
    }
    if (session.status === 'CLOSED') {
      return { error: 'Cannot pause a closed session', status: 400 };
    }
    if (session.status === 'PAUSED') {
      return { error: 'Session is already paused', status: 400 };
    }
    const updated = await prisma.dailySession.update({
      where: { id },
      data: { status: 'PAUSED' },
    });
    return { data: updated };
  }

  async reopenDailySession(id: string): ServiceResult {
    const session = await prisma.dailySession.findUnique({ where: { id } });
    if (!session) {
      return { error: 'Session not found', status: 404 };
    }
    if (session.status === 'OPEN') {
      return { error: 'Session is already open', status: 400 };
    }

    const existingActive = await prisma.dailySession.findFirst({
      where: {
        branchId: session.branchId,
        status: { in: ['OPEN', 'PAUSED'] },
        id: { not: id },
      },
    });

    if (existingActive) {
      return {
        error: `Another daily session is currently ${existingActive.status} for this branch. There cannot be 2 active sessions at the same time.`,
        status: 400,
      };
    }

    const updated = await prisma.dailySession.update({
      where: { id },
      data: { status: 'OPEN' },
    });
    return { data: updated };
  }

  async deleteDailySession(id: string): ServiceResult {
    try {
      await prisma.dailySession.delete({
        where: { id },
      });
      return { data: { message: 'Daily session deleted successfully' } };
    } catch (e) {
      return { error: 'Failed to delete session (it may have linked sales or leftover records)', status: 400 };
    }
  }

  static async autoCloseExpiredSessions() {
    try {
      const now = new Date();
      // Ethiopian timezone offset UTC+3
      const ethDateStr = new Date(now.getTime() + 3 * 3600 * 1000).toISOString().slice(0, 10);
      const parts = parseYmd(ethDateStr);
      if (!parts) return;
      const todayUtcNoon = businessDateUtcNoon(parts.y, parts.mo, parts.day);

      // 1. Auto-close any open/paused session prior to today
      const expired = await prisma.dailySession.findMany({
        where: {
          status: { in: ['OPEN', 'PAUSED'] },
          date: { lt: todayUtcNoon },
        },
      });

      for (const sess of expired) {
        await prisma.dailySession.update({
          where: { id: sess.id },
          data: {
            status: 'CLOSED',
            notes: sess.notes
              ? `${sess.notes}\n[System Auto-Closed at Midnight]`
              : '[System Auto-Closed at Midnight]',
          },
        });
        console.log(`[AutoClose] Automatically closed expired daily session ${sess.id}`);
      }

      // 2. Auto-open a new session for today for each active branch if none exists
      const branches = await prisma.branch.findMany({ where: { isActive: true } });
      for (const branch of branches) {
        const todaySession = await prisma.dailySession.findFirst({
          where: {
            branchId: branch.id,
            date: todayUtcNoon,
          },
        });

        if (!todaySession) {
          const previousClosed = await prisma.dailySession.findFirst({
            where: { branchId: branch.id, status: 'CLOSED' },
            orderBy: { date: 'desc' },
          });

          const carriedFloat = previousClosed?.cashLeftoverAmount != null
            ? decimalToNum(previousClosed.cashLeftoverAmount)
            : (previousClosed?.actualCashAmount != null ? decimalToNum(previousClosed.actualCashAmount) : 0);

          await prisma.dailySession.create({
            data: {
              branchId: branch.id,
              date: todayUtcNoon,
              status: 'OPEN',
              label: `Session - ${ethDateStr}`,
              openingCashFloat: carriedFloat,
              notes: carriedFloat > 0
                ? `[System Auto-Opened at Midnight with Carried Starter Cash: ${carriedFloat.toFixed(2)} ETB]`
                : '[System Auto-Opened at Midnight]',
            },
          });
          console.log(`[AutoOpen] Automatically opened new session for branch ${branch.name} (${branch.id}) for date ${ethDateStr} with opening float ${carriedFloat}`);
        }
      }
    } catch (err) {
      console.error('[AutoClose/AutoOpen] Error during midnight session rollover:', err);
    }
  }
}
