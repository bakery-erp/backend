import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authMiddleware, requireRole, type AuthRequest } from '../middleware/auth.js';

export const suppliersRouter = Router();
suppliersRouter.use(authMiddleware);

suppliersRouter.get('/', async (req: AuthRequest, res) => {
  try {
    const branchId = (req.query.branchId as string) || req.user?.branchId;
    const type = req.query.type as string | undefined;
    const where: any = {};
    if (branchId) where.branchId = branchId;
    if (type) where.type = String(type).toUpperCase();
    const list = await prisma.supplier.findMany({
      where,
      orderBy: { name: 'asc' },
      include: { _count: { select: { deliveries: true } } },
    });
    res.json(list);
  } catch (err: any) {
    console.error('Fetch suppliers error:', err);
    res.status(500).json({ error: err?.message || 'Failed to fetch suppliers' });
  }
});

suppliersRouter.get('/:id', async (req, res) => {
  try {
    const supplier = await prisma.supplier.findUnique({
      where: { id: req.params.id },
      include: { branch: true, deliveries: { include: { product: true }, orderBy: { createdAt: 'desc' }, take: 50 } },
    });
    if (!supplier) return res.status(404).json({ error: 'Supplier not found' });
    res.json(supplier);
  } catch (err: any) {
    console.error('Fetch supplier by ID error:', err);
    res.status(500).json({ error: err?.message || 'Failed to fetch supplier' });
  }
});

suppliersRouter.post('/', requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res) => {
  try {
    const { branchId, name, phone, type } = req.body as { branchId?: string; name: string; phone?: string; type: string };
    let bid = branchId || req.user?.branchId;
    if (!bid) {
      const firstBranch = await prisma.branch.findFirst({ where: { isActive: true } });
      bid = firstBranch?.id;
    }

    if (!bid || !name?.trim() || !type) {
      return res.status(400).json({ error: 'branchId, name, and type are required' });
    }

    const normalizedType = String(type).toUpperCase();
    const validTypes = ['INJERA', 'MILK', 'GENERAL'];
    if (!validTypes.includes(normalizedType)) {
      return res.status(400).json({ error: `Invalid supplier type "${type}". Allowed values are: INJERA, MILK, GENERAL` });
    }

    const supplier = await prisma.supplier.create({
      data: { branchId: bid, name: name.trim(), phone: phone?.trim() || null, type: normalizedType as any },
    });
    res.status(201).json(supplier);
  } catch (err: any) {
    console.error('Create supplier error:', err);
    res.status(500).json({ error: err?.message || 'Failed to create supplier' });
  }
});

suppliersRouter.patch('/:id', requireRole('OWNER', 'ADMIN'), async (req, res) => {
  try {
    const { name, phone, type } = req.body as { name?: string; phone?: string; type?: string };
    let normalizedType: string | undefined;
    if (type !== undefined) {
      normalizedType = String(type).toUpperCase();
      const validTypes = ['INJERA', 'MILK', 'GENERAL'];
      if (!validTypes.includes(normalizedType)) {
        return res.status(400).json({ error: `Invalid supplier type "${type}". Allowed values are: INJERA, MILK, GENERAL` });
      }
    }

    const supplier = await prisma.supplier.update({
      where: { id: req.params.id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(phone !== undefined && { phone: phone?.trim() || null }),
        ...(normalizedType !== undefined && { type: normalizedType as any }),
      },
    });
    res.json(supplier);
  } catch (err: any) {
    console.error('Update supplier error:', err);
    res.status(500).json({ error: err?.message || 'Failed to update supplier' });
  }
});

suppliersRouter.delete('/:id', requireRole('OWNER', 'ADMIN'), async (req, res) => {
  try {
    const deliveryCount = await prisma.supplierDelivery.count({ where: { supplierId: req.params.id } });
    if (deliveryCount > 0) {
      return res.status(400).json({ error: 'Cannot delete a supplier that still has deliveries' });
    }
    await prisma.supplier.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err: any) {
    console.error('Delete supplier error:', err);
    res.status(500).json({ error: err?.message || 'Failed to delete supplier' });
  }
});
