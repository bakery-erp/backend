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
const avatarsDir = path.join(uploadsDir, 'avatars');
const documentsDir = path.join(uploadsDir, 'documents');

for (const dir of [uploadsDir, avatarsDir, documentsDir]) {
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  } catch (e) {
    console.warn('[Uploads Directory]', e);
  }
}

async function saveUploadedFile(file?: Express.Multer.File, subfolder: 'avatars' | 'documents' = 'documents') {
  if (!file) return;
  const dataBuffer = file.buffer || (file.path && fs.existsSync(file.path) ? fs.readFileSync(file.path) : null);
  if (!dataBuffer) {
    throw new Error('Unable to read uploaded file data buffer');
  }
  const key = `${subfolder}/${file.filename}`;
  await prisma.uploadedFile.upsert({
    where: { filename: key },
    create: {
      filename: key,
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

// Multer storage with dynamic destination based on field name or route
const userDiskStorage = multer.diskStorage({
  destination: (req: any, file, cb) => {
    const isAvatar = file.fieldname === 'avatar' || (req.originalUrl && req.originalUrl.includes('profile-picture'));
    const dest = isAvatar ? avatarsDir : documentsDir;
    cb(null, dest);
  },
  filename: (req: any, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const rawExt = path.extname(file.originalname).toLowerCase();
    const isAvatar = file.fieldname === 'avatar' || (req.originalUrl && req.originalUrl.includes('profile-picture'));
    const fallbackExt = isAvatar ? '.jpg' : '.pdf';
    cb(null, uniqueSuffix + (rawExt || fallbackExt));
  }
});

const userUpload = multer({
  storage: userDiskStorage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req: any, file, cb) => {
    const isAvatar = file.fieldname === 'avatar' || (req.originalUrl && req.originalUrl.includes('profile-picture'));
    if (isAvatar) {
      const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
      const isImgExt = file.originalname.match(/\.(jpe?g|png|webp)$/i);
      if (allowed.includes(file.mimetype.toLowerCase()) || isImgExt) {
        cb(null, true);
      } else {
        cb(new Error('Unsupported avatar format. Please upload a JPG, PNG, or WebP image.'));
      }
    } else {
      // User data file: Allow BOTH PDF and Images (ID card scan, Kebele ID, passport, driving license, contract)
      const allowedMimes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
      const isAllowedExt = file.originalname.match(/\.(pdf|jpe?g|png|webp)$/i);
      if (allowedMimes.includes(file.mimetype.toLowerCase()) || isAllowedExt) {
        cb(null, true);
      } else {
        cb(new Error('Invalid document format. Identification file must be a PDF document or an image (JPG, PNG, WebP).'));
      }
    }
  },
});

function handleProfilePictureUpload(req: any, res: any, next: any) {
  userUpload.single('file')(req, res, (err: any) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'Profile picture upload error' });
    }
    next();
  });
}

function handleUserFormUpload(req: any, res: any, next: any) {
  userUpload.fields([
    { name: 'file', maxCount: 1 },    // User data document (PDF or Image)
    { name: 'avatar', maxCount: 1 },  // Profile picture (Image)
  ])(req, res, (err: any) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'File upload error' });
    }
    next();
  });
}

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

usersRouter.post('/me/profile-picture', handleProfilePictureUpload, async (req: AuthRequest, res: Response) => {
  if (!req.user?.id) return res.status(401).json({ error: 'Unauthorized' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  await saveUploadedFile(req.file, 'avatars');
  const fileUrl = `/uploads/avatars/${req.file.filename}`;
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

usersRouter.post('/', requireRole('OWNER', 'ADMIN'), handleUserFormUpload, async (req: AuthRequest, res: Response) => {
  const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
  const docFile = files?.file?.[0];
  const avatarFile = files?.avatar?.[0];

  if (!docFile && !req.body.filesUrl) {
    return res.status(400).json({ error: 'Identification document (PDF or Image) is mandatory when creating a new user.' });
  }

  let docFileUrl: string | undefined = req.body.filesUrl;
  if (docFile) {
    await saveUploadedFile(docFile, 'documents');
    docFileUrl = `/uploads/documents/${docFile.filename}`;
  }

  let avatarUrl: string | undefined = req.body.avatarUrl;
  if (avatarFile) {
    await saveUploadedFile(avatarFile, 'avatars');
    avatarUrl = `/uploads/avatars/${avatarFile.filename}`;
  }

  const result = await usersService.createUser({ ...req.body, avatarUrl }, docFileUrl);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.status(201).json(result.data);
});

usersRouter.patch('/:id', requireRole('OWNER', 'ADMIN'), handleUserFormUpload, async (req: AuthRequest, res: Response) => {
  const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
  const docFile = files?.file?.[0];
  const avatarFile = files?.avatar?.[0];

  let docFileUrl: string | undefined = undefined;
  if (docFile) {
    await saveUploadedFile(docFile, 'documents');
    docFileUrl = `/uploads/documents/${docFile.filename}`;
  }

  const bodyData = { ...req.body };
  if (avatarFile) {
    await saveUploadedFile(avatarFile, 'avatars');
    bodyData.avatarUrl = `/uploads/avatars/${avatarFile.filename}`;
  }

  const result = await usersService.updateUser(req.params.id, bodyData, docFileUrl);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});
