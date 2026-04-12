import { Router } from 'express';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import path from 'path';
import { prisma } from '../lib/prisma.js';
import { authMiddleware, requireRole, type AuthRequest } from '../middleware/auth.js';

export const usersRouter = Router();
usersRouter.use(authMiddleware);

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

usersRouter.get('/roles', requireRole('OWNER', 'ADMIN'), (req, res) => {
  res.json(['OWNER', 'ADMIN', 'BAKER', 'CASHIER', 'SAMBUSA_WORKER']);
});

const userSelect = { id: true, fullName: true, phone: true, role: true, branchId: true, isActive: true, createdAt: true, salary: true, startDate: true, lastPaidDate: true, shift: true, filesUrl: true } as const;

usersRouter.get('/', requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res) => {
  const branchId = req.query.branchId as string | undefined;
  const where = branchId ? { branchId } : {};
  const list = await prisma.user.findMany({
    where,
    select: { ...userSelect, branch: { select: { name: true } } },
    orderBy: { fullName: 'asc' },
  });
  res.json(list);
});

usersRouter.get('/:id', requireRole('OWNER', 'ADMIN'), async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: { ...userSelect, branch: true },
  });
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

function toDecimal(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') { const n = parseFloat(v); return Number.isNaN(n) ? null : n; }
  return null;
}

usersRouter.post('/', requireRole('OWNER', 'ADMIN'), upload.single('file'), async (req, res) => {
  const { fullName, phone, password, role, branchId, salary, startDate, lastPaidDate, shift } = req.body as {
    fullName: string;
    phone: string;
    password: string;
    role: string;
    branchId?: string;
    salary?: number | string;
    startDate?: string;
    lastPaidDate?: string;
    shift?: string;
  };
  
  let filesUrl = req.body.filesUrl as string | undefined;
  if (req.file) {
    filesUrl = `/uploads/${req.file.filename}`;
  }

  const phoneTrim = phone?.trim();
  if (!fullName?.trim() || !phoneTrim || !password) {
    return res.status(400).json({ error: 'fullName, phone, password required' });
  }
  const existing = await prisma.user.findUnique({ where: { phone: phoneTrim } });
  if (existing) return res.status(400).json({ error: 'Phone already exists' });
  const passwordHash = await bcrypt.hash(password, 10);
  const salaryNum = toDecimal(salary);
  const user = await prisma.user.create({
    data: {
      fullName: fullName.trim(),
      phone: phoneTrim,
      passwordHash,
      role: role as any,
      branchId: branchId || null,
      salary: salaryNum ?? undefined,
      startDate: startDate ? new Date(startDate) : undefined,
      lastPaidDate: lastPaidDate ? new Date(lastPaidDate) : undefined,
      shift: shift === 'DAY' || shift === 'NIGHT' ? shift : undefined,
      filesUrl: filesUrl?.trim() || undefined,
    },
    select: { ...userSelect, branch: { select: { name: true } } },
  });
  res.status(201).json(user);
});

usersRouter.patch('/:id', requireRole('OWNER', 'ADMIN'), upload.single('file'), async (req, res) => {
  const { fullName, phone, password, role, branchId, isActive, salary, startDate, lastPaidDate, shift } = req.body as Record<string, unknown>;
  
  let filesUrl = req.body.filesUrl as string | undefined;
  if (req.file) {
    filesUrl = `/uploads/${req.file.filename}`;
  }

  const data: Record<string, unknown> = {};
  if (typeof fullName === 'string') data.fullName = fullName.trim();
  if (typeof phone === 'string') data.phone = phone?.trim() || null;
  if (typeof role === 'string') data.role = role;
  if (branchId !== undefined) data.branchId = branchId || null;
  if (typeof isActive === 'boolean') data.isActive = isActive;
  if (salary !== undefined) data.salary = toDecimal(salary);
  if (startDate !== undefined) data.startDate = startDate ? new Date(startDate as string) : null;
  if (lastPaidDate !== undefined) data.lastPaidDate = lastPaidDate ? new Date(lastPaidDate as string) : null;
  if (shift === 'DAY' || shift === 'NIGHT') data.shift = shift;
  else if (shift === null || shift === '') data.shift = null;
  if (filesUrl !== undefined) data.filesUrl = typeof filesUrl === 'string' ? filesUrl.trim() || null : null;
  if (typeof password === 'string' && password) {
    data.passwordHash = await bcrypt.hash(password, 10);
  }
  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: data as any,
    select: { ...userSelect, branch: { select: { name: true } } },
  });
  res.json(user);
});
