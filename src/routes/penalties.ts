import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';

function decimalToNum(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseFloat(v);
  return 0;
}

export const penaltiesRouter = Router();
penaltiesRouter.use(authMiddleware);

penaltiesRouter.get('/my', async (req: any, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const list = await prisma.penalty.findMany({
    where: { userId },
    include: { user: { select: { id: true, fullName: true, phone: true } } },
    orderBy: { date: 'desc' },
  });
  res.json(list);
});


penaltiesRouter.get('/', requireRole('OWNER', 'ADMIN'), async (req, res) => {
  const userId = req.query.userId as string | undefined;
  const isDeducted = req.query.isDeducted as string | undefined;
  const where: any = {};
  if (userId) where.userId = userId;
  if (isDeducted !== undefined) where.isDeducted = isDeducted === 'true';
  const list = await prisma.penalty.findMany({
    where,
    include: { user: { select: { id: true, fullName: true, phone: true, role: true } } },
    orderBy: { date: 'desc' },
  });
  res.json(list);
});

penaltiesRouter.post('/', requireRole('OWNER', 'ADMIN'), async (req, res) => {
  const { userId, amount, reason, date } = req.body as {
    userId: string;
    amount: number | string;
    reason: string;
    date?: string;
  };
  if (!userId || amount == null || !reason?.trim()) return res.status(400).json({ error: 'userId, amount, reason required' });
  const d = date ? new Date(date) : new Date();
  d.setHours(0, 0, 0, 0);
  const penalty = await prisma.penalty.create({
    data: {
      userId,
      amount: decimalToNum(amount),
      reason: reason.trim(),
      date: d,
    },
    include: { user: { select: { id: true, fullName: true, phone: true } } },
  });
  res.status(201).json(penalty);
});

penaltiesRouter.patch('/:id', requireRole('OWNER', 'ADMIN'), async (req, res) => {
  const { isDeducted, amount, reason, date, userId } = req.body as {
    isDeducted?: boolean;
    amount?: number | string;
    reason?: string;
    date?: string;
    userId?: string;
  };
  const data: any = {};
  if (isDeducted !== undefined) data.isDeducted = Boolean(isDeducted);
  if (amount !== undefined) data.amount = decimalToNum(amount);
  if (reason !== undefined) data.reason = String(reason).trim();
  if (date !== undefined) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    data.date = d;
  }
  if (userId !== undefined) data.userId = userId;

  const penalty = await prisma.penalty.update({
    where: { id: req.params.id },
    data,
    include: { user: { select: { id: true, fullName: true, phone: true } } },
  });
  res.json(penalty);
});
