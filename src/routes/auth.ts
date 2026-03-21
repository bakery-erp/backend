import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma.js';
import { toAuthUserDto } from '../lib/authUser.js';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';

export const authRouter = Router();
const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret';

authRouter.post('/login', async (req, res) => {
  const { phone, password } = req.body as { phone?: string; password?: string };
  const phoneTrim = phone?.trim();
  if (!phoneTrim || !password) {
    return res.status(400).json({ error: 'Phone and password required' });
  }
  const user = await prisma.user.findUnique({
    where: { phone: phoneTrim, isActive: true },
    include: { branch: { select: { id: true, name: true } } },
  });
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign(
    { userId: user.id, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
  res.json({
    token,
    user: toAuthUserDto(user),
  });
});

authRouter.get('/me', authMiddleware, async (req: AuthRequest, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: {
      id: true,
      fullName: true,
      phone: true,
      role: true,
      branchId: true,
      branch: { select: { id: true, name: true } },
    },
  });
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(toAuthUserDto(user));
});
