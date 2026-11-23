import { Router, Response } from 'express';
import { authMiddleware, requireRole, AuthRequest } from '../../middleware/auth.js';
import { DailyCashLogsService } from './daily-cash-logs.service.js';

export const dailyCashLogsRouter = Router();
const service = new DailyCashLogsService();

dailyCashLogsRouter.use(authMiddleware);
dailyCashLogsRouter.use(requireRole('OWNER', 'ADMIN'));

dailyCashLogsRouter.get('/', async (req: AuthRequest, res: Response) => {
  const branchId = (req.query.branchId as string) || (req.user?.role === 'OWNER' ? undefined : req.user?.branchId);
  const from = req.query.from as string;
  const to = req.query.to as string;
  const page = req.query.page ? parseInt(req.query.page as string, 10) : undefined;
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;

  const result = await service.getDailyCashLogs({ branchId, from, to, page, limit });
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  return res.json(result.data);
});

dailyCashLogsRouter.get('/:id', async (req: AuthRequest, res: Response) => {
  const result = await service.getDailyCashLogById(req.params.id);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  return res.json(result.data);
});

dailyCashLogsRouter.post('/', async (req: AuthRequest, res: Response) => {
  const result = await service.createOrUpsertDailyCashLog(req.body, req.user!.id);
  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  return res.status(201).json(result.data);
});

dailyCashLogsRouter.patch('/:id', async (req: AuthRequest, res: Response) => {
  const result = await service.updateDailyCashLog(req.params.id, req.body);
  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  return res.json(result.data);
});

dailyCashLogsRouter.delete('/:id', async (req: AuthRequest, res: Response) => {
  const result = await service.deleteDailyCashLog(req.params.id);
  if (result.error) {
    return res.status(result.status || 400).json({ error: result.error });
  }
  return res.json(result.data);
});
