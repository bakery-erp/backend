import { Router, Response } from 'express';
import { authMiddleware, requireRole, type AuthRequest } from '../../middleware/auth.js';
import { DashboardService } from './dashboard.service.js';

export const dashboardRouter = Router();
const dashboardService = new DashboardService();

dashboardRouter.use(authMiddleware);

dashboardRouter.get('/', requireRole('OWNER', 'ADMIN', 'BAKER', 'CASHIER', 'SAMBUSA_WORKER'), async (req: AuthRequest, res: Response) => {
  const branchId = (req.query.branchId as string) || req.user?.branchId;
  const result = await dashboardService.getDashboardStats(branchId);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});
