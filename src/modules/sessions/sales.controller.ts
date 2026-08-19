import { Router, Response } from 'express';
import { authMiddleware, requireRole, type AuthRequest } from '../../middleware/auth.js';
import { SalesService } from './sales.service.js';

export const salesRouter = Router();
const salesService = new SalesService();

salesRouter.use(authMiddleware);

salesRouter.get('/', requireRole('OWNER', 'ADMIN', 'CASHIER'), async (req: AuthRequest, res: Response) => {
  const sessionId = req.query.sessionId as string | undefined;
  const branchId = req.query.branchId as string | undefined;
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const result = await salesService.getSales(sessionId, branchId, limit);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

salesRouter.get('/:id', requireRole('OWNER', 'ADMIN', 'CASHIER'), async (req, res: Response) => {
  const result = await salesService.getSaleById(req.params.id);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

salesRouter.post('/', requireRole('OWNER', 'ADMIN', 'CASHIER'), async (req: AuthRequest, res: Response) => {
  const result = await salesService.createSale(req.body, req.user!.id);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.status(201).json(result.data);
});
