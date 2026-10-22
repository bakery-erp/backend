import { Router, Response } from 'express';
import { authMiddleware, type AuthRequest } from '../../middleware/auth.js';
import { notificationsService } from './notifications.service.js';

export const notificationsRouter = Router();

// Public endpoint to retrieve public VAPID key
notificationsRouter.get('/public-key', (_req, res: Response) => {
  res.json({
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY || '',
  });
});

// All following routes require authentication
notificationsRouter.use(authMiddleware);

notificationsRouter.get('/', async (req: AuthRequest, res: Response) => {
  const unreadOnly = req.query.unreadOnly === 'true';
  const page = parseInt(req.query.page as string, 10) || 1;
  const limit = parseInt(req.query.limit as string, 10) || 20;

  const result = await notificationsService.getNotifications(req.user!.id, {
    unreadOnly,
    page,
    limit,
  });

  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }

  res.json(result.data);
});

notificationsRouter.post('/subscribe', async (req: AuthRequest, res: Response) => {
  const { subscription } = req.body;
  const userAgent = req.headers['user-agent'];

  const result = await notificationsService.saveSubscription(
    req.user!.id,
    subscription,
    userAgent
  );

  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }

  res.status(201).json(result.data);
});

notificationsRouter.post('/unsubscribe', async (req: AuthRequest, res: Response) => {
  const { endpoint } = req.body;
  if (!endpoint) {
    return res.status(400).json({ error: 'Endpoint is required' });
  }

  const result = await notificationsService.removeSubscription(endpoint);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }

  res.json(result.data);
});

notificationsRouter.patch('/:id/read', async (req: AuthRequest, res: Response) => {
  const result = await notificationsService.markAsRead(req.user!.id, req.params.id);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }

  res.json(result.data);
});

notificationsRouter.post('/read-all', async (req: AuthRequest, res: Response) => {
  const result = await notificationsService.markAllAsRead(req.user!.id);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }

  res.json(result.data);
});
