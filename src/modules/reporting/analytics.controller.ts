import { Router, Response } from 'express';
import { authMiddleware, requireRole, type AuthRequest } from '../../middleware/auth.js';
import { AnalyticsService } from './analytics.service.js';

export const analyticsRouter = Router();
const analyticsService = new AnalyticsService();

analyticsRouter.use(authMiddleware);
analyticsRouter.use(requireRole('OWNER'));

analyticsRouter.get('/daily', async (req: AuthRequest, res: Response) => {
  const branchId = (req.query.branchId as string) || req.user?.branchId;
  const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);
  const result = await analyticsService.getDailyAnalytics(branchId, date);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

analyticsRouter.get('/weekly', async (req: AuthRequest, res: Response) => {
  const branchId = (req.query.branchId as string) || req.user?.branchId;
  const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);
  const result = await analyticsService.getWeeklyAnalytics(branchId, date);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

analyticsRouter.get('/monthly', async (req: AuthRequest, res: Response) => {
  const branchId = (req.query.branchId as string) || req.user?.branchId;
  const month = parseInt((req.query.month as string) || String(new Date().getUTCMonth() + 1), 10);
  const year = parseInt((req.query.year as string) || String(new Date().getUTCFullYear()), 10);
  const result = await analyticsService.getMonthlyAnalytics(branchId, month, year);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});
