import { Router, Response } from 'express';
import { authMiddleware, requireRole, type AuthRequest } from '../../middleware/auth.js';
import { DailySessionsService } from './daily-sessions.service.js';

export const dailySessionsRouter = Router();
const dailySessionsService = new DailySessionsService();

dailySessionsRouter.use(authMiddleware);

dailySessionsRouter.get('/', requireRole('OWNER', 'ADMIN', 'CASHIER'), async (req: AuthRequest, res: Response) => {
  const branchId = (req.query.branchId as string) || req.user?.branchId;
  const from = req.query.from as string;
  const to = req.query.to as string;
  const status = req.query.status as string | undefined;
  const result = await dailySessionsService.getDailySessions(branchId, from, to, status);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

dailySessionsRouter.get('/active', requireRole('OWNER', 'ADMIN', 'CASHIER'), async (req: AuthRequest, res: Response) => {
  const branchId = (req.query.branchId as string) || req.user?.branchId;
  const result = await dailySessionsService.getActiveSession(branchId);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

dailySessionsRouter.get('/:id', requireRole('OWNER', 'ADMIN', 'CASHIER'), async (req, res: Response) => {
  const result = await dailySessionsService.getDailySessionById(req.params.id);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

dailySessionsRouter.post('/', requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  const result = await dailySessionsService.createDailySession(req.body, req.user?.branchId);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.status(201).json(result.data);
});

dailySessionsRouter.patch('/:id', requireRole('OWNER', 'ADMIN'), async (req, res: Response) => {
  const result = await dailySessionsService.updateDailySession(req.params.id, req.body);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

dailySessionsRouter.post('/:id/finalize', requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  const result = await dailySessionsService.finalizeDailySession(req.params.id, req.body, req.user!.id);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

dailySessionsRouter.post('/:id/pause', requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  const result = await dailySessionsService.pauseDailySession(req.params.id);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

dailySessionsRouter.post('/:id/reopen', requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  const result = await dailySessionsService.reopenDailySession(req.params.id);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

dailySessionsRouter.delete('/:id', requireRole('OWNER', 'ADMIN'), async (req, res: Response) => {
  const result = await dailySessionsService.deleteDailySession(req.params.id);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});
