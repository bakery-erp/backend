import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authMiddleware, requireRole, type AuthRequest } from '../middleware/auth.js';

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

leftoverRecordsRouter.post('/', requireRole('OWNER', 'ADMIN', 'CASHIER', 'BAKER'), async (req: AuthRequest, res) => {
  const { sessionId, records } = req.body as {
    sessionId: string;
    records: { productId: string; quantityRemaining: number }[];
  };
  if (!sessionId || !records?.length) return res.status(400).json({ error: 'sessionId and records required' });
  const session = await prisma.dailySession.findUnique({ where: { id: sessionId } });
  if (!session) return res.status(404).json({ error: 'Session not found' });
  await prisma.leftoverRecord.createMany({
    data: records.map((r) => ({
      sessionId,
      productId: r.productId,
      quantityRemaining: typeof r.quantityRemaining === 'number' ? r.quantityRemaining : parseInt(String(r.quantityRemaining), 10),
    })),
    skipDuplicates: true,
  });
  const list = await prisma.leftoverRecord.findMany({
    where: { sessionId },
    include: { product: true },
  });
  res.status(201).json(list);
});

leftoverRecordsRouter.put('/session/:sessionId', requireRole('OWNER', 'ADMIN', 'CASHIER', 'BAKER'), async (req, res) => {
  const { sessionId } = req.params;
  const { records } = req.body as { records: { productId: string; quantityRemaining: number }[] };
  if (!records?.length) return res.status(400).json({ error: 'records required' });
  await prisma.leftoverRecord.deleteMany({ where: { sessionId } });
  await prisma.leftoverRecord.createMany({
    data: records.map((r) => ({
      sessionId,
      productId: r.productId,
      quantityRemaining: typeof r.quantityRemaining === 'number' ? r.quantityRemaining : parseInt(String(r.quantityRemaining), 10),
    })),
  });
  const list = await prisma.leftoverRecord.findMany({
    where: { sessionId },
    include: { product: true },
  });
  res.json(list);
});
