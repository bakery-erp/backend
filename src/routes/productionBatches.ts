import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authMiddleware, requireRole, type AuthRequest } from '../middleware/auth.js';

function decimalToNum(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseFloat(v);
  return 0;
}

export const productionBatchesRouter = Router();
productionBatchesRouter.use(authMiddleware);

productionBatchesRouter.get('/', async (req: AuthRequest, res) => {
  const branchId = (req.query.branchId as string) || req.user?.branchId;
  const date = req.query.date as string;
  const status = req.query.status as string | undefined;
  if (!branchId) return res.status(400).json({ error: 'branchId required' });
  const where: any = { branchId };
  if (status) where.status = status;
  if (date) {
    const d = new Date(date);
    const start = new Date(d);
    start.setHours(0, 0, 0, 0);
    const end = new Date(d);
    end.setHours(23, 59, 59, 999);
    where.createdAt = { gte: start, lte: end };
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
  res.json(list);
});

productionBatchesRouter.get('/:id', async (req, res) => {
  const batch = await prisma.productionBatch.findUnique({
    where: { id: req.params.id },
    include: {
      branch: true,
      user: true,
      items: { include: { product: true } },
      materialUsages: { include: { stockItem: true } },
    },
  });
  if (!batch) return res.status(404).json({ error: 'Batch not found' });
  res.json(batch);
});

productionBatchesRouter.post('/', requireRole('OWNER', 'ADMIN', 'BAKER', 'SAMBUSA_WORKER'), async (req: AuthRequest, res) => {
  const { branchId, date, shift, items, materialUsages } = req.body as {
    branchId?: string;
    date?: string;
    shift?: string;
    items: { productId: string; quantityProduced: number }[];
    materialUsages?: { stockItemId: string; quantityUsed: number | string }[];
  };
  const bid = branchId || req.user?.branchId;
  if (!bid) return res.status(400).json({ error: 'branchId required' });
  if (!items?.length) return res.status(400).json({ error: 'items array required' });
  let batchDate = new Date();
  if (date) {
    const [y, mo, day] = date.split('-').map(Number);
    if (y && mo && day) batchDate = new Date(y, mo - 1, day);
  }
  const batch = await prisma.productionBatch.create({
    data: {
      branchId: bid,
      userId: req.user!.id,
      date: batchDate,
      shift: (shift as any) || null,
      status: 'STARTED',
      items: {
        create: items.map((i) => ({
          productId: i.productId,
          quantityProduced: typeof i.quantityProduced === 'number' ? i.quantityProduced : parseInt(String(i.quantityProduced), 10),
        })),
      },
      materialUsages: materialUsages?.length
        ? {
            create: materialUsages.map((m) => ({
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
  for (const m of materialUsages || []) {
    const item = await prisma.stockItem.findUnique({ where: { id: m.stockItemId } });
    if (item) {
      const used = decimalToNum(m.quantityUsed);
      await prisma.stockItem.update({
        where: { id: m.stockItemId },
        data: { currentQuantity: Number(item.currentQuantity) - used },
      });
      await prisma.stockMovement.create({
        data: {
          stockItemId: m.stockItemId,
          userId: req.user!.id,
          quantity: used,
          type: 'PRODUCTION_USAGE',
          reason: `Production batch ${batch.id}`,
        },
      });
    }
  }
  res.status(201).json(batch);
});

productionBatchesRouter.patch('/:id', requireRole('OWNER', 'ADMIN', 'BAKER', 'SAMBUSA_WORKER'), async (req, res) => {
  const { status } = req.body as { status?: string };
  const batch = await prisma.productionBatch.update({
    where: { id: req.params.id },
    data: status ? { status: status as any } : {},
    include: {
      user: { select: { id: true, fullName: true } },
      items: { include: { product: true } },
      materialUsages: { include: { stockItem: true } },
    },
  });
  res.json(batch);
});
