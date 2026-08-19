import { Router, Response } from 'express';
import { authMiddleware, requireRole, type AuthRequest } from '../../middleware/auth.js';
import { PayrollService } from './payroll.service.js';

export const payrollRouter = Router();
const payrollService = new PayrollService();

payrollRouter.use(authMiddleware);

payrollRouter.get('/my', async (req: AuthRequest, res: Response) => {
  const result = await payrollService.getMyPayroll(req.user?.id);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

payrollRouter.get('/', requireRole('OWNER', 'ADMIN'), async (req, res: Response) => {
  const userId = req.query.userId as string | undefined;
  const month = req.query.month as string | undefined;
  const year = req.query.year as string | undefined;
  const result = await payrollService.getPayroll(userId, month, year);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

payrollRouter.post('/', requireRole('OWNER', 'ADMIN'), async (req, res: Response) => {
  const result = await payrollService.createPayroll(req.body);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.status(201).json(result.data);
});

payrollRouter.get('/calculate/:userId', requireRole('OWNER', 'ADMIN'), async (req, res: Response) => {
  const { userId } = req.params;
  const { month, year } = req.query as { month: string; year: string };
  const result = await payrollService.calculatePayroll(userId, month, year);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

payrollRouter.get('/:id', requireRole('OWNER', 'ADMIN'), async (req, res: Response) => {
  const result = await payrollService.getPayrollById(req.params.id);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

payrollRouter.patch('/:id', requireRole('OWNER', 'ADMIN'), async (req, res: Response) => {
  const result = await payrollService.updatePayroll(req.params.id, req.body);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});
