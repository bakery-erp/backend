import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { authMiddleware, requireRole, type AuthRequest } from '../middleware/auth.js';
import { asyncHandler } from '../lib/routeUtils.js';
import { businessDateUtcNoon, dateToYmdUtc, parseYmd, utcDayRangeInclusive } from '../lib/businessDate.js';

function decimalToNum(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseFloat(v);
  return 0;
}

export const dailySessionsRouter = Router();
dailySessionsRouter.use(authMiddleware);

dailySessionsRouter.get('/', requireRole('OWNER', 'ADMIN', 'CASHIER'), async (req: AuthRequest, res) => {
  const branchId = (req.query.branchId as string) || req.user?.branchId;
  const from = req.query.from as string;
  const to = req.query.to as string;
  const status = req.query.status as string | undefined;
  if (!branchId) return res.status(400).json({ error: 'branchId required' });
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
  res.json(list);
});

dailySessionsRouter.get('/:id', requireRole('OWNER', 'ADMIN', 'CASHIER'), async (req, res) => {
  const session = await prisma.dailySession.findUnique({
    where: { id: req.params.id },
    include: {
      branch: true,
      sales: { include: { user: true, items: { include: { product: true } } } },
      leftoverRecords: { include: { product: true } },
    },
  });
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json(session);
});

dailySessionsRouter.post(
  '/',
  requireRole('OWNER', 'ADMIN', 'CASHIER'),
  asyncHandler(async (req: AuthRequest, res) => {
    const { branchId, date } = req.body as { branchId?: string; date: string };
    const bid = branchId || req.user?.branchId;
    if (!bid || !date) {
      res.status(400).json({ error: 'branchId and date required' });
      return;
    }
    const parts = parseYmd(date);
    if (!parts) {
      res.status(400).json({ error: 'Invalid date format (YYYY-MM-DD)' });
      return;
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
      res.status(400).json({ error: 'Session already exists for this branch and date' });
      return;
    }

    try {
      const session = await prisma.dailySession.create({
        data: { branchId: bid, date: d, status: 'OPEN' },
      });

      // Seed opening leftovers from the most recent closed session for this branch.
      // This gives staff a real starting stock to edit when closing the day.
      const previousClosed = await prisma.dailySession.findFirst({
        where: {
          branchId: bid,
          status: 'CLOSED',
          date: { lt: d },
        },
        include: { leftoverRecords: true },
        orderBy: { date: 'desc' },
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

      res.status(201).json(session);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        res.status(400).json({ error: 'Session already exists for this branch and date' });
        return;
      }
      throw e;
    }
  })
);

dailySessionsRouter.patch('/:id', requireRole('OWNER', 'ADMIN', 'CASHIER'), async (req, res) => {
  const { status, cashLeftoverAmount } = req.body as { status?: string; cashLeftoverAmount?: number | string | null };
  const data: any = {};
  if (status) data.status = status;
  if (cashLeftoverAmount !== undefined) {
    data.cashLeftoverAmount =
      cashLeftoverAmount === null || cashLeftoverAmount === ''
        ? null
        : decimalToNum(cashLeftoverAmount);
  }
  const session = await prisma.dailySession.update({
    where: { id: req.params.id },
    data,
  });
  res.json(session);
});

// Finalize day: save leftovers, then compute sales = production - leftover per product, and register one Sale with items.
dailySessionsRouter.post(
  '/:id/finalize',
  requireRole('OWNER', 'ADMIN', 'CASHIER'),
  asyncHandler(async (req: AuthRequest, res) => {
  const sessionId = req.params.id;
  const cashLeftoverAmountRaw = (req.body as { cashLeftoverAmount?: number | string | null }).cashLeftoverAmount;
  const { leftoverRecords } = req.body as {
    leftoverRecords: { productId: string; quantityRemaining: number | string }[];
  };
  const session = await prisma.dailySession.findUnique({
    where: { id: sessionId },
    include: { leftoverRecords: true },
  });
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  if (session.status === 'CLOSED') {
    res.status(400).json({ error: 'Session already closed' });
    return;
  }
  if (!Array.isArray(leftoverRecords)) {
    res.status(400).json({ error: 'leftoverRecords array required' });
    return;
  }
  const cashLeftoverAmount =
    cashLeftoverAmountRaw === undefined || cashLeftoverAmountRaw === null || cashLeftoverAmountRaw === ''
      ? null
      : decimalToNum(cashLeftoverAmountRaw);

  // Use the session's calendar date as stored in DB (avoid setHours() — it shifts the day in some timezones and skips production batches).
  const sessionBusinessDate = session.date;

  // 1) Upsert leftover records (coerce string quantities from JSON / clients)
  for (const row of leftoverRecords) {
    const pid = typeof row.productId === 'string' ? row.productId.trim() : '';
    if (!pid) continue;
    const raw = row.quantityRemaining;
    const q = typeof raw === 'number' ? raw : parseInt(String(raw ?? '0'), 10);
    if (!Number.isFinite(q)) continue;
    const quantityRemaining = Math.max(0, Math.floor(q));
    await prisma.leftoverRecord.upsert({
      where: {
        sessionId_productId: { sessionId, productId: pid },
      },
      create: {
        sessionId,
        productId: pid,
        quantityRemaining,
      },
      update: { quantityRemaining },
    });
  }

  // 2) Opening leftovers from the latest previous CLOSED day for this branch.
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

  // 3) Production totals for this session's calendar date (same branch) — batches must use the same business `date` as the session
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

  // 3b) Supplier purchases received this calendar day (branch) — same “available” pool as production
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

  // 3c) Keep rows for products that have opening stock, today's production, or today's purchases.
  const eligibleForLeftovers = new Set([
    ...Object.keys(openingByProduct),
    ...Object.keys(producedByProduct),
    ...Object.keys(boughtByProduct),
  ]);
  if (eligibleForLeftovers.size === 0) {
    await prisma.leftoverRecord.deleteMany({ where: { sessionId } });
  } else {
    await prisma.leftoverRecord.deleteMany({
      where: { sessionId, productId: { notIn: Array.from(eligibleForLeftovers) } },
    });
  }

  // 4) Leftover totals (after upsert + cleanup)
  const leftovers = await prisma.leftoverRecord.findMany({
    where: { sessionId },
    include: { product: true },
  });
  const leftoverByProduct: Record<string, number> = {};
  for (const r of leftovers) {
    leftoverByProduct[r.productId] = r.quantityRemaining;
  }

  // 5) Sold = (opening + produced + bought) - leftover (per product)
  const productIds = new Set([
    ...Object.keys(openingByProduct),
    ...Object.keys(producedByProduct),
    ...Object.keys(boughtByProduct),
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
    const available = opening + produced + bought;
    const leftover = leftoverByProduct[pid] ?? 0;
    const sold = Math.max(0, available - leftover);
    if (sold <= 0) continue;
    const product = productMap.get(pid);
    const unitPrice = product ? Number(product.basePrice) : 0;
    const subtotal = unitPrice * sold;
    totalAmount += subtotal;
    saleItems.push({ productId: pid, quantity: sold, unitPrice, subtotal });
  }

  // 6) Delete any existing derived sale for this session (idempotent finalize), then create one Sale with items
  await prisma.saleItem.deleteMany({ where: { sale: { sessionId } } });
  await prisma.sale.deleteMany({ where: { sessionId } });
  if (saleItems.length > 0) {
    await prisma.sale.create({
      data: {
        sessionId,
        userId: req.user!.id,
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

  // 7) Close session
  await prisma.dailySession.update({
    where: { id: sessionId },
    data: {
      status: 'CLOSED',
      ...(cashLeftoverAmount !== null && { cashLeftoverAmount }),
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
    res.status(500).json({ error: 'Session reload failed after close' });
    return;
  }

  const totalBrr = Math.round(totalAmount * 100) / 100;
  const openingLineItems = Object.values(openingByProduct).filter((q) => q > 0).length;
  const purchaseLineItems = Object.values(boughtByProduct).filter((q) => q > 0).length;
  res.json({
    ...updated,
    _closeSummary: {
      productionBatchCount: batches.length,
      openingLineItems,
      purchaseLineItems,
      derivedLineItems: saleItems.length,
      totalBrr,
      cashLeftoverAmount,
    },
  });
  })
);
