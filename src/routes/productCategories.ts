import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';

export const productCategoriesRouter = Router();
productCategoriesRouter.use(authMiddleware);

async function resolveParentCategory(parentId: string | null | undefined, childId?: string) {
  if (parentId == null || parentId === '') return null;

  const parent = await prisma.productCategory.findUnique({
    where: { id: parentId },
    select: { id: true, type: true, parentId: true },
  });

  if (!parent) return 'parentId: category not found';
  if (childId && parent.id === childId) return 'parentId cannot reference itself';

  return parent;
}

productCategoriesRouter.get('/', async (_req, res) => {
  const list = await prisma.productCategory.findMany({
    orderBy: [{ parentId: 'asc' }, { name: 'asc' }],
    include: {
      parent: { select: { id: true, name: true, type: true } },
      _count: { select: { products: true, children: true } },
    },
  });
  res.json(list);
});

productCategoriesRouter.get('/:id', async (req, res) => {
  const cat = await prisma.productCategory.findUnique({
    where: { id: req.params.id },
    include: {
      parent: { select: { id: true, name: true, type: true } },
      children: { include: { _count: { select: { products: true } } }, orderBy: { name: 'asc' } },
      products: true,
    },
  });
  if (!cat) return res.status(404).json({ error: 'Category not found' });
  res.json(cat);
});

productCategoriesRouter.post('/', requireRole('OWNER', 'ADMIN'), async (req, res) => {
  const { name, type, parentId } = req.body as { name: string; type: string; parentId?: string | null };
  if (!name?.trim() || !type) return res.status(400).json({ error: 'name and type (PRODUCED|RESELL) required' });
  const parent = await resolveParentCategory(parentId);
  if (typeof parent === 'string') return res.status(400).json({ error: parent });
  if (parent && parent.type !== type) {
    return res.status(400).json({ error: 'parent category must have the same type' });
  }
  const category = await prisma.productCategory.create({
    data: {
      name: name.trim(),
      type: type as any,
      parentId: parent ? parent.id : null,
    },
    include: {
      parent: { select: { id: true, name: true, type: true } },
      _count: { select: { products: true, children: true } },
    },
  });
  res.status(201).json(category);
});

productCategoriesRouter.patch('/:id', requireRole('OWNER', 'ADMIN'), async (req, res) => {
  const { name, type, parentId } = req.body as { name?: string; type?: string; parentId?: string | null };
  const parent = parentId !== undefined ? await resolveParentCategory(parentId, req.params.id) : null;
  if (typeof parent === 'string') return res.status(400).json({ error: parent });
  if (parent && type && parent.type !== type) {
    return res.status(400).json({ error: 'parent category must have the same type' });
  }
  const category = await prisma.productCategory.update({
    where: { id: req.params.id },
    data: {
      ...(name !== undefined && { name: name.trim() }),
      ...(type !== undefined && { type: type as any }),
      ...(parentId !== undefined && { parentId: parent ? parent.id : null }),
    },
    include: {
      parent: { select: { id: true, name: true, type: true } },
      _count: { select: { products: true, children: true } },
    },
  });
  res.json(category);
});

productCategoriesRouter.delete('/:id', requireRole('OWNER', 'ADMIN'), async (req, res) => {
  const category = await prisma.productCategory.findUnique({
    where: { id: req.params.id },
    include: { _count: { select: { products: true, children: true } } },
  });
  if (!category) return res.status(404).json({ error: 'Category not found' });
  if (category._count.products > 0) {
    return res.status(400).json({ error: 'Cannot delete a category that still has products' });
  }
  await prisma.productCategory.delete({ where: { id: req.params.id } });
  res.status(204).send();
});
