import { Router, Response } from 'express';
import { authMiddleware, requireRole, type AuthRequest } from '../../middleware/auth.js';
import { ExpensesService } from './expenses.service.js';

export const expensesRouter = Router();
const expensesService = new ExpensesService();

expensesRouter.use(authMiddleware);

expensesRouter.get('/', requireRole('OWNER', 'ADMIN', 'CASHIER', 'BAKER', 'CAKE_WORKER'), async (req: AuthRequest, res: Response) => {
  const admin = req.user!.role === 'OWNER' || req.user!.role === 'ADMIN';
  const branchId = admin
    ? ((req.query.branchId as string) || req.user?.branchId)
    : req.user?.branchId;
  const from = req.query.from as string;
  const to = req.query.to as string;
  const category = req.query.category as string | undefined;
  const result = await expensesService.getExpenses(branchId, from, to, category);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

expensesRouter.get('/:id', requireRole('OWNER', 'ADMIN', 'CASHIER', 'BAKER', 'CAKE_WORKER'), async (req: AuthRequest, res: Response) => {
  const result = await expensesService.getExpenseById(req.params.id, req.user!.role, req.user?.branchId);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

expensesRouter.post('/', requireRole('OWNER', 'ADMIN', 'CASHIER', 'BAKER', 'CAKE_WORKER'), async (req: AuthRequest, res: Response) => {
  const result = await expensesService.createExpense(req.body, req.user!.id, req.user!.role, req.user?.branchId);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.status(201).json(result.data);
});

expensesRouter.patch('/:id', requireRole('OWNER', 'ADMIN'), async (req, res: Response) => {
  const result = await expensesService.updateExpense(req.params.id, req.body);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

expensesRouter.delete('/:id', requireRole('OWNER', 'ADMIN'), async (req, res: Response) => {
  const result = await expensesService.deleteExpense(req.params.id);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.status(204).send();
});
