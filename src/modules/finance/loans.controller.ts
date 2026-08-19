import { Router, Response } from 'express';
import { authMiddleware, requireRole, type AuthRequest } from '../../middleware/auth.js';
import { LoansService } from './loans.service.js';

export const loansRouter = Router();
const loansService = new LoansService();

loansRouter.use(authMiddleware);

loansRouter.get('/my', async (req: AuthRequest, res: Response) => {
  const result = await loansService.getMyLoans(req.user?.id);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

loansRouter.get('/', requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  const branchId = (req.query.branchId as string) || req.user?.branchId;
  const type = req.query.type as string | undefined;
  const status = req.query.status as string | undefined;
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  const result = await loansService.getLoans(branchId, type, status, from, to);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

loansRouter.get('/:id', requireRole('OWNER', 'ADMIN'), async (req, res: Response) => {
  const result = await loansService.getLoanById(req.params.id);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

loansRouter.post('/', requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  const result = await loansService.createLoan(req.body, req.user?.branchId);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.status(201).json(result.data);
});

loansRouter.post('/:id/pay', requireRole('OWNER', 'ADMIN'), async (req, res: Response) => {
  const result = await loansService.payLoan(req.params.id, req.body);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

loansRouter.delete('/:id', requireRole('OWNER', 'ADMIN'), async (req, res: Response) => {
  const result = await loansService.deleteLoan(req.params.id);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.status(204).send();
});
