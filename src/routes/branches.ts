import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';

export const branchesRouter = Router();
branchesRouter.use(authMiddleware);

branchesRouter.get('/', requireRole('OWNER', 'ADMIN'), async (_req, res) => {
  const list = await prisma.branch.findMany({ orderBy: { name: 'asc' } });
  res.json(list);
});

branchesRouter.get('/:id', requireRole('OWNER', 'ADMIN'), async (req, res) => {
  const branch = await prisma.branch.findUnique({
    where: { id: req.params.id },
    include: { users: { select: { id: true, fullName: true, phone: true, role: true } } },
  });
  if (!branch) return res.status(404).json({ error: 'Branch not found' });
  res.json(branch);
});

branchesRouter.post('/', requireRole('OWNER', 'ADMIN'), async (req, res) => {
  const { name, address } = req.body as { name: string; address?: string };
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
  const branch = await prisma.branch.create({
    data: { name: name.trim(), address: address?.trim() || null },
  });
  res.status(201).json(branch);
});

branchesRouter.patch('/:id', requireRole('OWNER', 'ADMIN'), async (req, res) => {
  const { name, address, isActive } = req.body as { name?: string; address?: string; isActive?: boolean };
  const branch = await prisma.branch.update({
    where: { id: req.params.id },
    data: {
      ...(name !== undefined && { name: name.trim() }),
      ...(address !== undefined && { address: address?.trim() || null }),
      ...(isActive !== undefined && { isActive }),
    },
  });
  res.json(branch);
});
