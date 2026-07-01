import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authMiddleware, requireRole, type AuthRequest } from '../middleware/auth.js';

export const suppliersRouter = Router();
suppliersRouter.use(authMiddleware);

suppliersRouter.get('/', async (req: AuthRequest, res) => {
  const branchId = (req.query.branchId as string) || req.user?.branchId;
  const type = req.query.type as string | undefined;
  if (!branchId) return res.status(400).json({ error: 'branchId required' });
  const where: any = { branchId };
  if (type) where.type = type;
  const list = await prisma.supplier.findMany({
    where,
    orderBy: { name: 'asc' },
    include: { _count: { select: { deliveries: true } } },
  });
  res.json(list);
});

suppliersRouter.get('/:id', async (req, res) => {
  const supplier = await prisma.supplier.findUnique({
    where: { id: req.params.id },
    include: { branch: true, deliveries: { include: { product: true }, orderBy: { createdAt: 'desc' }, take: 50 } },
  });
  if (!supplier) return res.status(404).json({ error: 'Supplier not found' });
  res.json(supplier);
});

suppliersRouter.post('/', requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res) => {
  const { branchId, name, phone, type } = req.body as { branchId?: string; name: string; phone?: string; type: string };
  const bid = branchId || req.user?.branchId;
  if (!bid || !name?.trim() || !type) return res.status(400).json({ error: 'branchId, name, type required' });
  const supplier = await prisma.supplier.create({
    data: { branchId: bid, name: name.trim(), phone: phone?.trim() || null, type: type as any },
  });
  res.status(201).json(supplier);
});

suppliersRouter.patch('/:id', requireRole('OWNER', 'ADMIN'), async (req, res) => {
  const { name, phone, type } = req.body as { name?: string; phone?: string; type?: string };
  const supplier = await prisma.supplier.update({
    where: { id: req.params.id },
    data: {
      ...(name !== undefined && { name: name.trim() }),
      ...(phone !== undefined && { phone: phone?.trim() || null }),
      ...(type !== undefined && { type: type as any }),
    },
  });
  res.json(supplier);
});

suppliersRouter.delete('/:id', requireRole('OWNER', 'ADMIN'), async (req, res) => {
  const deliveryCount = await prisma.supplierDelivery.count({ where: { supplierId: req.params.id } });
  if (deliveryCount > 0) {
    return res.status(400).json({ error: 'Cannot delete a supplier that still has deliveries' });
  }
  await prisma.supplier.delete({ where: { id: req.params.id } });
  res.status(204).send();
});
