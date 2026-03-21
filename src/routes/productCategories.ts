import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';

export const productCategoriesRouter = Router();
productCategoriesRouter.use(authMiddleware);

productCategoriesRouter.get('/', async (_req, res) => {
  const list = await prisma.productCategory.findMany({
    orderBy: { name: 'asc' },
    include: { _count: { select: { products: true } } },
  });
  res.json(list);
});

productCategoriesRouter.get('/:id', async (req, res) => {
  const cat = await prisma.productCategory.findUnique({
    where: { id: req.params.id },
    include: { products: true },
  });
  if (!cat) return res.status(404).json({ error: 'Category not found' });
  res.json(cat);
});

productCategoriesRouter.post('/', requireRole('OWNER', 'ADMIN'), async (req, res) => {
  const { name, type } = req.body as { name: string; type: string };
  if (!name?.trim() || !type) return res.status(400).json({ error: 'name and type (PRODUCED|RESELL) required' });
  const category = await prisma.productCategory.create({
    data: { name: name.trim(), type: type as any },
  });
  res.status(201).json(category);
});

productCategoriesRouter.patch('/:id', requireRole('OWNER', 'ADMIN'), async (req, res) => {
  const { name, type } = req.body as { name?: string; type?: string };
  const category = await prisma.productCategory.update({
    where: { id: req.params.id },
    data: {
      ...(name !== undefined && { name: name.trim() }),
      ...(type !== undefined && { type: type as any }),
    },
  });
  res.json(category);
});
