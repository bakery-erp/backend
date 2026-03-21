import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';

export const financialCategoriesRouter = Router();
financialCategoriesRouter.use(authMiddleware);

financialCategoriesRouter.get('/', async (req, res) => {
  const type = (req.query.type as string | undefined)?.toUpperCase();
  const where =
    type === 'REVENUE' || type === 'EXPENSE' ? { type: type as 'REVENUE' | 'EXPENSE' } : {};
  const list = await prisma.financialCategory.findMany({
    where,
    orderBy: [{ type: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { products: true, expenses: true } } },
  });
  res.json(list);
});

financialCategoriesRouter.get('/:id', async (req, res) => {
  const row = await prisma.financialCategory.findUnique({
    where: { id: req.params.id },
    include: { _count: { select: { products: true, expenses: true } } },
  });
  if (!row) return res.status(404).json({ error: 'Financial category not found' });
  res.json(row);
});

financialCategoriesRouter.post('/', requireRole('OWNER', 'ADMIN'), async (req, res) => {
  const { name, type } = req.body as { name?: string; type?: string };
  const t = type?.toUpperCase();
  if (!name?.trim() || (t !== 'REVENUE' && t !== 'EXPENSE')) {
    return res.status(400).json({ error: 'name and type (REVENUE|EXPENSE) required' });
  }
  try {
    const created = await prisma.financialCategory.create({
      data: { name: name.trim(), type: t },
    });
    res.status(201).json(created);
  } catch {
    res.status(409).json({ error: 'Category with this name and type may already exist' });
  }
});

financialCategoriesRouter.patch('/:id', requireRole('OWNER', 'ADMIN'), async (req, res) => {
  const { name, type } = req.body as { name?: string; type?: string };
  const t = type?.toUpperCase();
  const data: { name?: string; type?: 'REVENUE' | 'EXPENSE' } = {};
  if (name !== undefined) data.name = name.trim();
  if (type !== undefined) {
    if (t !== 'REVENUE' && t !== 'EXPENSE') {
      return res.status(400).json({ error: 'type must be REVENUE or EXPENSE' });
    }
    data.type = t;
  }
  if (Object.keys(data).length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }
  try {
    const updated = await prisma.financialCategory.update({
      where: { id: req.params.id },
      data,
    });
    res.json(updated);
  } catch {
    res.status(404).json({ error: 'Financial category not found' });
  }
});

financialCategoriesRouter.delete('/:id', requireRole('OWNER', 'ADMIN'), async (req, res) => {
  try {
    await prisma.financialCategory.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch {
    res.status(404).json({ error: 'Financial category not found' });
  }
});
