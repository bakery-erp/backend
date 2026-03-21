import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authMiddleware, requireRole, type AuthRequest } from '../middleware/auth.js';

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

dailySessionsRouter.post('/', requireRole('OWNER', 'ADMIN', 'CASHIER'), async (req: AuthRequest, res) => {
  const { branchId, date } = req.body as { branchId?: string; date: string };
  const bid = branchId || req.user?.branchId;
  if (!bid || !date) return res.status(400).json({ error: 'branchId and date required' });
  const [y, mo, day] = date.split('-').map(Number);
  if (!y || !mo || !day) return res.status(400).json({ error: 'Invalid date format (YYYY-MM-DD)' });
  const d = new Date(y, mo - 1, day);
  const existing = await prisma.dailySession.findUnique({
    where: { branchId_date: { branchId: bid, date: d } },
  });
  if (existing) return res.status(400).json({ error: 'Session already exists for this branch and date' });
  const session = await prisma.dailySession.create({
    data: { branchId: bid, date: d, status: 'OPEN' },
  });
  res.status(201).json(session);
});

dailySessionsRouter.patch('/:id', requireRole('OWNER', 'ADMIN', 'CASHIER'), async (req, res) => {
  const { status } = req.body as { status?: string };
  const data: any = {};
  if (status) data.status = status;
  const session = await prisma.dailySession.update({
    where: { id: req.params.id },
    data,
  });
  res.json(session);
});

// Finalize day: save leftovers, then compute sales = production - leftover per product, and register one Sale with items.
dailySessionsRouter.post('/:id/finalize', requireRole('OWNER', 'ADMIN', 'CASHIER'), async (req: AuthRequest, res) => {
  const sessionId = req.params.id;
  const { leftoverRecords } = req.body as {
    leftoverRecords: { productId: string; quantityRemaining: number }[];
  };
  const session = await prisma.dailySession.findUnique({
    where: { id: sessionId },
    include: { leftoverRecords: true },
  });
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.status === 'CLOSED') return res.status(400).json({ error: 'Session already closed' });
  if (!Array.isArray(leftoverRecords)) return res.status(400).json({ error: 'leftoverRecords array required' });

  const sessionDate = new Date(session.date);
  sessionDate.setHours(0, 0, 0, 0);

  // 1) Upsert leftover records
  for (const row of leftoverRecords) {
    if (!row.productId || typeof row.quantityRemaining !== 'number') continue;
    await prisma.leftoverRecord.upsert({
      where: {
        sessionId_productId: { sessionId, productId: row.productId },
      },
      create: {
        sessionId,
        productId: row.productId,
        quantityRemaining: row.quantityRemaining,
      },
      update: { quantityRemaining: row.quantityRemaining },
    });
  }

  // 2) Production totals for this session's date (same branch)
  const batches = await prisma.productionBatch.findMany({
    where: {
      branchId: session.branchId,
      date: sessionDate,
    },
    include: { items: { include: { product: true } } },
  });
  const producedByProduct: Record<string, number> = {};
  for (const batch of batches) {
    for (const item of batch.items) {
      producedByProduct[item.productId] = (producedByProduct[item.productId] ?? 0) + item.quantityProduced;
    }
  }

  // 3) Leftover totals (after upsert)
  const leftovers = await prisma.leftoverRecord.findMany({
    where: { sessionId },
    include: { product: true },
  });
  const leftoverByProduct: Record<string, number> = {};
  for (const r of leftovers) {
    leftoverByProduct[r.productId] = r.quantityRemaining;
  }

  // 4) Sold = produced - leftover (per product)
  const productIds = new Set([...Object.keys(producedByProduct), ...Object.keys(leftoverByProduct)]);
  const saleItems: { productId: string; quantity: number; unitPrice: number; subtotal: number }[] = [];
  let totalAmount = 0;
  const products = await prisma.product.findMany({
    where: { id: { in: Array.from(productIds) } },
  });
  const productMap = new Map(products.map((p) => [p.id, p]));
  for (const pid of productIds) {
    const produced = producedByProduct[pid] ?? 0;
    const leftover = leftoverByProduct[pid] ?? 0;
    const sold = Math.max(0, produced - leftover);
    if (sold <= 0) continue;
    const product = productMap.get(pid);
    const unitPrice = product ? Number(product.basePrice) : 0;
    const subtotal = unitPrice * sold;
    totalAmount += subtotal;
    saleItems.push({ productId: pid, quantity: sold, unitPrice, subtotal });
  }

  // 5) Delete any existing derived sale for this session (idempotent finalize), then create one Sale with items
  await prisma.saleItem.deleteMany({ where: { sale: { sessionId } } });
  await prisma.sale.deleteMany({ where: { sessionId } });
  if (saleItems.length > 0) {
    await prisma.sale.create({
      data: {
        sessionId,
        userId: req.user!.id,
        totalAmount,
        paymentMethod: 'CASH',
        items: {
          create: saleItems.map((i) => ({
            productId: i.productId,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            subtotal: i.subtotal,
          })),
        },
      },
    });
  }

  // 6) Close session
  await prisma.dailySession.update({
    where: { id: sessionId },
    data: { status: 'CLOSED' },
  });

  const updated = await prisma.dailySession.findUnique({
    where: { id: sessionId },
    include: {
      sales: { include: { items: { include: { product: true } } } },
      leftoverRecords: { include: { product: true } },
    },
  });
  res.json(updated);
});
