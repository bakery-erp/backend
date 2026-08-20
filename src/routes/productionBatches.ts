import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { businessDateFromYmdString, businessDateUtcNoon, parseYmd } from '../lib/businessDate.js';
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
  // Match finalize / day-close logic: filter by business `date` on the batch (not createdAt).
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
  res.json(list);
});

productionBatchesRouter.get('/daily-product-history/all', async (req: AuthRequest, res) => {
  try {
    const branchId = (req.query.branchId as string) || req.user?.branchId;
    const startDate = req.query.startDate as string | undefined;
    const endDate = req.query.endDate as string | undefined;
    const typeFilter = ((req.query.type as string) || 'ALL').toUpperCase();
    const productId = req.query.productId as string | undefined;
    const search = ((req.query.search as string) || '').trim().toLowerCase();

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

    // 1. Fetch Production Items (Bakery Produced Products)
    if (typeFilter === 'ALL' || typeFilter === 'PRODUCED') {
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
              user: { select: { id: true, fullName: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 500,
      });

      for (const item of items) {
        records.push({
          id: `prod_${item.id}`,
          date: item.batch.date,
          createdAt: item.createdAt,
          type: 'PRODUCED',
          productId: item.productId,
          productName: item.product.name,
          unitType: item.product.unitType,
          basePrice: Number(item.product.basePrice),
          quantity: item.quantityProduced,
          subtotal: Number(item.product.basePrice) * item.quantityProduced,
          sourceName: item.batch.user?.fullName || 'Bakery Staff',
          sessionId: item.batch.sessionId || null,
          branchName: item.batch.branch?.name || '',
          notes: item.batch.shift ? `Shift: ${item.batch.shift}` : 'Daily Batch',
        });
      }
    }

    // 2. Fetch Supplier Deliveries (Resell Products)
    if (typeFilter === 'ALL' || typeFilter === 'RESELL') {
      const delWhere: any = {};
      if (branchId) delWhere.supplier = { branchId };
      if (productId) delWhere.productId = productId;
      if (startDate && endDate) {
        const pStart = parseYmd(startDate);
        const pEnd = parseYmd(endDate);
        if (pStart && pEnd) {
          delWhere.createdAt = {
            gte: new Date(`${startDate}T00:00:00.000Z`),
            lte: new Date(`${endDate}T23:59:59.999Z`),
          };
        }
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
        records.push({
          id: `resell_${del.id}`,
          date: del.createdAt,
          createdAt: del.createdAt,
          type: 'RESELL',
          productId: del.productId,
          productName: del.product.name,
          unitType: del.product.unitType,
          basePrice: Number(del.unitSellPrice),
          unitBuyPrice: Number(del.unitBuyPrice),
          quantity: del.quantityReceived,
          subtotal: Number(del.unitSellPrice) * del.quantityReceived,
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
      .reduce((sum, r) => sum + r.quantity, 0);

    const totalResellQuantity = filteredRecords
      .filter((r) => r.type === 'RESELL')
      .reduce((sum, r) => sum + r.quantity, 0);

    const totalValuation = filteredRecords.reduce((sum, r) => sum + r.subtotal, 0);

    res.json({
      records: filteredRecords,
      summary: {
        totalProducedQuantity,
        totalResellQuantity,
        totalValuation,
        count: filteredRecords.length,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch daily product history' });
  }
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
  let batchDate = businessDateFromYmdString(new Date().toISOString().slice(0, 10)) ?? new Date();
  if (date) {
    const p = parseYmd(date);
    if (p) batchDate = businessDateUtcNoon(p.y, p.mo, p.day);
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

productionBatchesRouter.get('/daily-product-history/all', async (req: AuthRequest, res) => {
  try {
    const branchId = (req.query.branchId as string) || req.user?.branchId;
    const startDate = req.query.startDate as string | undefined;
    const endDate = req.query.endDate as string | undefined;
    const typeFilter = ((req.query.type as string) || 'ALL').toUpperCase();
    const productId = req.query.productId as string | undefined;
    const search = ((req.query.search as string) || '').trim().toLowerCase();

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

    // 1. Fetch Production Items (Bakery Produced Products)
    if (typeFilter === 'ALL' || typeFilter === 'PRODUCED') {
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
              user: { select: { id: true, fullName: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 500,
      });

      for (const item of items) {
        records.push({
          id: `prod_${item.id}`,
          date: item.batch.date,
          createdAt: item.createdAt,
          type: 'PRODUCED',
          productId: item.productId,
          productName: item.product.name,
          unitType: item.product.unitType,
          basePrice: Number(item.product.basePrice),
          quantity: item.quantityProduced,
          subtotal: Number(item.product.basePrice) * item.quantityProduced,
          sourceName: item.batch.user?.fullName || 'Bakery Staff',
          sessionId: item.batch.sessionId || null,
          branchName: item.batch.branch?.name || '',
          notes: item.batch.shift ? `Shift: ${item.batch.shift}` : 'Daily Batch',
        });
      }
    }

    // 2. Fetch Supplier Deliveries (Resell Products)
    if (typeFilter === 'ALL' || typeFilter === 'RESELL') {
      const delWhere: any = {};
      if (branchId) delWhere.supplier = { branchId };
      if (productId) delWhere.productId = productId;
      if (startDate && endDate) {
        const pStart = parseYmd(startDate);
        const pEnd = parseYmd(endDate);
        if (pStart && pEnd) {
          delWhere.createdAt = {
            gte: new Date(`${startDate}T00:00:00.000Z`),
            lte: new Date(`${endDate}T23:59:59.999Z`),
          };
        }
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
        records.push({
          id: `resell_${del.id}`,
          date: del.createdAt,
          createdAt: del.createdAt,
          type: 'RESELL',
          productId: del.productId,
          productName: del.product.name,
          unitType: del.product.unitType,
          basePrice: Number(del.unitSellPrice),
          unitBuyPrice: Number(del.unitBuyPrice),
          quantity: del.quantityReceived,
          subtotal: Number(del.unitSellPrice) * del.quantityReceived,
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
      .reduce((sum, r) => sum + r.quantity, 0);

    const totalResellQuantity = filteredRecords
      .filter((r) => r.type === 'RESELL')
      .reduce((sum, r) => sum + r.quantity, 0);

    const totalValuation = filteredRecords.reduce((sum, r) => sum + r.subtotal, 0);

    res.json({
      records: filteredRecords,
      summary: {
        totalProducedQuantity,
        totalResellQuantity,
        totalValuation,
        count: filteredRecords.length,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch daily product history' });
  }
});
