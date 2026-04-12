import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma.js';
import { toAuthUserDto } from '../lib/authUser.js';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';

export const authRouter = Router();

authRouter.patch('/password', authMiddleware, async (req: AuthRequest, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current password and new password are required' });
  }
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) return res.status(404).json({ error: 'User not found' });
  
  const ok = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: 'Incorrect current password' });
  }
  
  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: { id: req.user!.id },
    data: { passwordHash },
  });
  
  res.json({ message: 'Password updated successfully' });
});

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret';

authRouter.post('/login', async (req, res) => {
  const { phone, password } = req.body as { phone?: string; password?: string };
  const phoneTrim = phone?.trim();
  if (!phoneTrim || !password) {
    return res.status(400).json({ error: 'Phone and password required' });
  }
  const user = await prisma.user.findUnique({
    where: { phone: phoneTrim, isActive: true },
    include: { branch: { select: { id: true, name: true, isActive: true } } },
  });
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  if (user.branch && !user.branch.isActive) {
    return res.status(403).json({
      error: 'Log in denied: Your assigned branch is currently inactive.',
    });
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

authRouter.post('/logout', authMiddleware, (req, res) => {
  res.json({ message: 'Logged out successfully' });
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
      filesUrl: true,
      shift: true,
      salary: true,
      startDate: true,
      isActive: true,
    },
  });
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(toAuthUserDto(user));
});
