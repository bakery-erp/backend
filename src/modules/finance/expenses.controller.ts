import { Router, Response } from 'express';
import { authMiddleware, requireRole, type AuthRequest } from '../../middleware/auth.js';
import { ExpensesService } from './expenses.service.js';
import { parsePagination } from '../../lib/pagination.js';

export const expensesRouter = Router();
const expensesService = new ExpensesService();

expensesRouter.use(authMiddleware);

expensesRouter.get('/', requireRole('OWNER', 'ADMIN', 'CASHIER'), async (req: AuthRequest, res: Response) => {
  const isCashier = req.user!.role === 'CASHIER';
  const admin = req.user!.role === 'OWNER' || req.user!.role === 'ADMIN';
  const branchId = admin
    ? ((req.query.branchId as string) || req.user?.branchId)
    : req.user?.branchId;
  let from = req.query.from as string | undefined;
  let to = req.query.to as string | undefined;
  const category = req.query.category as string | undefined;
  let type = req.query.type as string | undefined;
  const search = req.query.search as string | undefined;
  const { page, limit } = parsePagination(req.query, 20, 100);

  if (isCashier) {
    // Cashier can only see COMPANY operating expenses (never OWNER personal withdrawals)
    type = 'COMPANY';

    // Restrict cashier to today and yesterday in Ethiopian timezone (UTC+3)
    const now = new Date(Date.now() + 3 * 3600 * 1000);
    const todayStr = now.toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() + 3 * 3600 * 1000 - 24 * 3600 * 1000);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);

    if (from === yesterdayStr && to === yesterdayStr) {
      from = yesterdayStr;
      to = yesterdayStr;
    } else if (from === todayStr && to === todayStr) {
      from = todayStr;
      to = todayStr;
    } else {
      from = yesterdayStr;
      to = todayStr;
    }
  } else if (req.user!.role === 'ADMIN') {
    // Admin can only see COMPANY operating expenses
    type = 'COMPANY';

    // Admin is constrained to at most 1 week (7 days) of data
    const oneWeekAgo = new Date(Date.now() + 3 * 3600 * 1000 - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    if (!from || from < oneWeekAgo) {
      from = oneWeekAgo;
    }
  }

  const result = await expensesService.getExpenses(branchId, from, to, category, type, page, limit, search);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

expensesRouter.get('/:id', requireRole('OWNER', 'ADMIN', 'CASHIER'), async (req: AuthRequest, res: Response) => {
  const result = await expensesService.getExpenseById(req.params.id, req.user!.role, req.user?.branchId);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

expensesRouter.post('/', requireRole('OWNER', 'ADMIN', 'CASHIER'), async (req: AuthRequest, res: Response) => {
  const result = await expensesService.createExpense(req.body, req.user!.id, req.user!.role, req.user?.branchId);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.status(201).json(result.data);
});

expensesRouter.patch('/:id', requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  const result = await expensesService.updateExpense(req.params.id, req.body, req.user?.role);
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
