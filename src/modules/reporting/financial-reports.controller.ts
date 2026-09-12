import { Router, Response } from 'express';
import { authMiddleware, requireRole, type AuthRequest } from '../../middleware/auth.js';
import { FinancialReportsService } from './financial-reports.service.js';

export const financialReportsRouter = Router();
const financialReportsService = new FinancialReportsService();

financialReportsRouter.use(authMiddleware);
financialReportsRouter.use(requireRole('OWNER', 'ADMIN'));

financialReportsRouter.get('/range', async (req: AuthRequest, res: Response) => {
  try {
    const branchId = (req.query.branchId as string) || req.user?.branchId;
    const from = (req.query.from as string | undefined)?.trim();
    const to = (req.query.to as string | undefined)?.trim();
    const date = (req.query.date as string | undefined)?.trim();
    const result = await financialReportsService.getRangeReport(branchId, from, to, date);
    if (result.error) {
      return res.status(result.status || 500).json({ error: result.error });
    }
    res.json(result.data);
  } catch (err: any) {
    console.error('financialReportsRouter /range unhandled error:', err);
    res.status(500).json({ error: err?.message || 'Failed to fetch financial report range' });
  }
});

financialReportsRouter.get('/period/:period', async (req: AuthRequest, res: Response) => {
  const branchId = (req.query.branchId as string) || req.user?.branchId;
  const period = req.params.period as any;
  const result = await financialReportsService.getPeriodReport(period, branchId, req.query);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

financialReportsRouter.get('/gained-details', async (req: AuthRequest, res: Response) => {
  const branchId = (req.query.branchId as string) || req.user?.branchId;
  const from = (req.query.from as string | undefined)?.trim();
  const to = (req.query.to as string | undefined)?.trim();
  const date = (req.query.date as string | undefined)?.trim();
  const result = await financialReportsService.getGainedDetails(branchId, from, to, date);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

financialReportsRouter.get('/expensed-details', async (req: AuthRequest, res: Response) => {
  const branchId = (req.query.branchId as string) || req.user?.branchId;
  const from = (req.query.from as string | undefined)?.trim();
  const to = (req.query.to as string | undefined)?.trim();
  const date = (req.query.date as string | undefined)?.trim();
  const result = await financialReportsService.getExpensedDetails(branchId, from, to, date);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});
