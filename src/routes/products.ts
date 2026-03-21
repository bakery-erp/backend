import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';

async function validateProductFinancialCategory(financialCategoryId: string | null | undefined) {
  if (financialCategoryId == null || financialCategoryId === '') return null;
  const fc = await prisma.financialCategory.findUnique({ where: { id: financialCategoryId } });
  if (!fc) return 'financialCategoryId: category not found';
  if (fc.type !== 'REVENUE') return 'financialCategoryId must reference a REVENUE financial category';
  return null;
}

function decimalToNum(v: unknown) {
  if (v == null) return undefined;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseFloat(v);
  return undefined;
}

export const productsRouter = Router();
productsRouter.use(authMiddleware);

productsRouter.get('/', async (req, res) => {
  const categoryId = req.query.categoryId as string | undefined;
  const where = categoryId ? { categoryId } : {};
  const list = await prisma.product.findMany({
    where,
    include: {
      category: { select: { id: true, name: true, type: true } },
      financialCategory: { select: { id: true, name: true, type: true } },
    },
    orderBy: [{ category: { name: 'asc' } }, { name: 'asc' }],
  });
  res.json(list);
});

productsRouter.get('/:id', async (req, res) => {
  const product = await prisma.product.findUnique({
    where: { id: req.params.id },
    include: { category: true, financialCategory: true },
  });
  if (!product) return res.status(404).json({ error: 'Product not found' });
  res.json(product);
});

productsRouter.post('/', requireRole('OWNER', 'ADMIN'), async (req, res) => {
  const { categoryId, name, flavor, unitType, basePrice, buyPrice, financialCategoryId } = req.body as Record<
    string,
    unknown
  >;
  if (!categoryId || !name || !unitType || basePrice == null) {
    return res.status(400).json({ error: 'categoryId, name, unitType, basePrice required' });
  }
  const fcErr = await validateProductFinancialCategory(financialCategoryId as string | undefined);
  if (fcErr) return res.status(400).json({ error: fcErr });
  const product = await prisma.product.create({
    data: {
      categoryId: categoryId as string,
      financialCategoryId:
        financialCategoryId != null && String(financialCategoryId).trim() !== ''
          ? String(financialCategoryId)
          : null,
      name: String(name).trim(),
      flavor: flavor ? String(flavor).trim() : null,
      unitType: unitType as any,
      basePrice: decimalToNum(basePrice) ?? 0,
      buyPrice: buyPrice != null ? decimalToNum(buyPrice) ?? null : null,
    },
    include: { category: true, financialCategory: true },
  });
  res.status(201).json(product);
});

productsRouter.patch('/:id', requireRole('OWNER', 'ADMIN'), async (req, res) => {
  const { categoryId, name, flavor, unitType, basePrice, buyPrice, isActive, financialCategoryId } = req.body as Record<
    string,
    unknown
  >;
  if (financialCategoryId !== undefined) {
    const fcErr = await validateProductFinancialCategory(
      financialCategoryId === null || financialCategoryId === '' ? null : String(financialCategoryId)
    );
    if (fcErr) return res.status(400).json({ error: fcErr });
  }
  const data: Record<string, unknown> = {};
  if (categoryId != null) data.categoryId = categoryId;
  if (name != null) data.name = String(name).trim();
  if (flavor !== undefined) data.flavor = flavor ? String(flavor).trim() : null;
  if (unitType != null) data.unitType = unitType;
  if (basePrice != null) data.basePrice = decimalToNum(basePrice);
  if (buyPrice !== undefined) data.buyPrice = buyPrice != null ? decimalToNum(buyPrice) : null;
  if (typeof isActive === 'boolean') data.isActive = isActive;
  if (financialCategoryId !== undefined) {
    data.financialCategoryId =
      financialCategoryId === null || financialCategoryId === '' ? null : String(financialCategoryId);
  }
  const product = await prisma.product.update({
    where: { id: req.params.id },
    data: data as any,
    include: { category: true, financialCategory: true },
  });
  res.json(product);
});
