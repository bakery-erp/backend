import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authMiddleware, requireRole, type AuthRequest } from '../middleware/auth.js';
import { asyncHandler } from '../lib/routeUtils.js';

export const leftoverRecordsRouter = Router();
leftoverRecordsRouter.use(authMiddleware);

leftoverRecordsRouter.get('/', async (req, res) => {
  const sessionId = req.query.sessionId as string | undefined;
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
  const list = await prisma.leftoverRecord.findMany({
    where: { sessionId },
    include: { product: { select: { id: true, name: true, unitType: true } } },
  });
  res.json(list);
});

/** Coerce API / JSON leftovers to safe integers; dedupe by productId (last wins). */
function normalizeLeftoverRows(
  records: unknown
): { productId: string; quantityRemaining: number }[] | null {
  if (!Array.isArray(records)) return null;
  const map = new Map<string, number>();
  for (const r of records as { productId?: unknown; quantityRemaining?: unknown }[]) {
    const pid = typeof r.productId === 'string' ? r.productId.trim() : '';
    if (!pid) continue;
    const raw = r.quantityRemaining;
    const q =
      typeof raw === 'number' ? raw : parseInt(String(raw ?? '0'), 10);
    const qty = Number.isFinite(q) ? Math.max(0, Math.floor(q)) : 0;
    map.set(pid, qty);
  }
  return Array.from(map.entries()).map(([productId, quantityRemaining]) => ({
    productId,
    quantityRemaining,
  }));
}

leftoverRecordsRouter.post(
  '/',
  requireRole('OWNER', 'ADMIN', 'CASHIER', 'BAKER'),
  asyncHandler(async (req: AuthRequest, res) => {
    const { sessionId, records } = req.body as {
      sessionId: string;
      records: { productId: string; quantityRemaining: number }[];
    };
    if (!sessionId) {
      res.status(400).json({ error: 'sessionId required' });
      return;
    }
    const normalized = normalizeLeftoverRows(records);
    if (normalized === null || normalized.length === 0) {
      res.status(400).json({ error: 'sessionId and non-empty records array required' });
      return;
    }

    const session = await prisma.dailySession.findUnique({ where: { id: sessionId } });
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    if (session.status !== 'OPEN') {
      res.status(400).json({ error: 'Session is closed; cannot add leftovers' });
      return;
    }

    const ids = normalized.map((x) => x.productId);
    const found = await prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true } });
    const ok = new Set(found.map((p) => p.id));
    const missing = ids.filter((id) => !ok.has(id));
    if (missing.length) {
      res.status(400).json({ error: `Unknown productId(s): ${missing.slice(0, 5).join(', ')}` });
      return;
    }

    await prisma.leftoverRecord.createMany({
      data: normalized.map((r) => ({
        sessionId,
        productId: r.productId,
        quantityRemaining: r.quantityRemaining,
      })),
      skipDuplicates: true,
    });

    const list = await prisma.leftoverRecord.findMany({
      where: { sessionId },
      include: { product: true },
    });
    res.status(201).json(list);
  })
);

leftoverRecordsRouter.put(
  '/session/:sessionId',
  requireRole('OWNER', 'ADMIN', 'CASHIER', 'BAKER'),
  asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const { records } = req.body as { records: { productId: string; quantityRemaining: number }[] };
    const normalized = normalizeLeftoverRows(records);
    if (normalized === null) {
      res.status(400).json({ error: 'records must be an array' });
      return;
    }
    if (normalized.length === 0) {
      res.status(400).json({ error: 'records required (at least one product row)' });
      return;
    }

    const session = await prisma.dailySession.findUnique({ where: { id: sessionId } });
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    if (session.status !== 'OPEN') {
      res.status(400).json({ error: 'Session is closed; cannot update leftovers' });
      return;
    }

    const ids = normalized.map((x) => x.productId);
    const found = await prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true } });
    const ok = new Set(found.map((p) => p.id));
    const missing = ids.filter((id) => !ok.has(id));
    if (missing.length) {
      res.status(400).json({ error: `Unknown productId(s): ${missing.slice(0, 5).join(', ')}` });
      return;
    }

    await prisma.$transaction([
      prisma.leftoverRecord.deleteMany({ where: { sessionId } }),
      prisma.leftoverRecord.createMany({
        data: normalized.map((r) => ({
          sessionId,
          productId: r.productId,
          quantityRemaining: r.quantityRemaining,
        })),
      }),
    ]);

    const list = await prisma.leftoverRecord.findMany({
      where: { sessionId },
      include: { product: true },
    });
    res.json(list);
  })
);
