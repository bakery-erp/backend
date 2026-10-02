import { Router, Response } from 'express';
import multer from 'multer';
import { authMiddleware, requireRole, type AuthRequest } from '../../middleware/auth.js';
import { UsersService } from './users.service.js';
import { prisma } from '../../lib/prisma.js';

import path from 'path';
import fs from 'fs';

export const usersRouter = Router();
const usersService = new UsersService();

usersRouter.use(authMiddleware);

const uploadsDir = process.env.VERCEL ? path.join('/tmp', 'uploads') : path.join(process.cwd(), 'uploads');
try {
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
} catch (e) {
  console.warn('[Uploads Directory]', e);
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '.' + (file.originalname.split('.').pop() || 'png'));
  }
});
const upload = multer({ storage });

async function saveUploadedFile(file?: Express.Multer.File) {
  if (!file) return;
  try {
    const dataBuffer = file.buffer || (file.path && fs.existsSync(file.path) ? fs.readFileSync(file.path) : null);
    if (dataBuffer) {
      await prisma.uploadedFile.upsert({
        where: { filename: file.filename },
        create: {
          filename: file.filename,
          mimeType: file.mimetype || 'application/octet-stream',
          size: file.size || dataBuffer.length,
          data: dataBuffer,
        },
        update: {
          mimeType: file.mimetype || 'application/octet-stream',
          size: file.size || dataBuffer.length,
          data: dataBuffer,
        },
      });
    }
  } catch (err) {
    console.warn('[UploadedFile DB Save Warning]:', err);
  }
}

const profilePictureUpload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
    if (allowed.includes(file.mimetype.toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file format. Please upload a JPG, PNG, or WebP image.'));
    }
  },
});

usersRouter.get('/roles', requireRole('OWNER', 'ADMIN'), (_req, res) => {
  res.json(['OWNER', 'ADMIN', 'BAKER', 'CAKE_WORKER', 'CASHIER', 'SAMBUSA_WORKER', 'EMPLOYEE']);
});

usersRouter.get('/me/dashboard', async (req: AuthRequest, res: Response) => {
  if (!req.user?.id) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const result = await usersService.getEmployeeDashboard(req.user.id);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

usersRouter.post('/me/change-password', async (req: AuthRequest, res: Response) => {
  if (!req.user?.id) return res.status(401).json({ error: 'Unauthorized' });
  const { currentPassword, newPassword } = req.body;
  const result = await usersService.changePassword(req.user.id, currentPassword, newPassword);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

usersRouter.post('/me/profile-picture', profilePictureUpload.single('file'), async (req: AuthRequest, res: Response) => {
  if (!req.user?.id) return res.status(401).json({ error: 'Unauthorized' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  await saveUploadedFile(req.file);
  const fileUrl = `/uploads/${req.file.filename}`;
  const result = await usersService.updateProfilePicture(req.user.id, fileUrl);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

usersRouter.get('/', requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  let branchId = req.query.branchId as string | undefined;
  if (req.user?.role !== 'OWNER') {
    branchId = req.user?.branchId || undefined;
  }
  const result = await usersService.getUsers(branchId);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

usersRouter.get('/:id', requireRole('OWNER', 'ADMIN'), async (req, res: Response) => {
  const result = await usersService.getUserById(req.params.id);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

usersRouter.post('/', requireRole('OWNER', 'ADMIN'), upload.single('file'), async (req: AuthRequest, res: Response) => {
  if (!req.file && !req.body.filesUrl) {
    return res.status(400).json({ error: 'Identification document is mandatory when creating a new user.' });
  }
  if (req.file) {
    await saveUploadedFile(req.file);
  }
  const fileUrl = req.file ? `/uploads/${req.file.filename}` : req.body.filesUrl;
  const result = await usersService.createUser(req.body, fileUrl);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.status(201).json(result.data);
});

usersRouter.patch('/:id', requireRole('OWNER', 'ADMIN'), upload.single('file'), async (req: AuthRequest, res: Response) => {
  if (req.file) {
    await saveUploadedFile(req.file);
  }
  const fileUrl = req.file ? `/uploads/${req.file.filename}` : undefined;
  const result = await usersService.updateUser(req.params.id, req.body, fileUrl);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});
