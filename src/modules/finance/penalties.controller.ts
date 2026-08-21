import { Router, Response } from 'express';
import { authMiddleware, requireRole, type AuthRequest } from '../../middleware/auth.js';
import { PenaltiesService } from './penalties.service.js';

export const penaltiesRouter = Router();
const penaltiesService = new PenaltiesService();

penaltiesRouter.use(authMiddleware);

penaltiesRouter.get('/my', async (req: AuthRequest, res: Response) => {
  const result = await penaltiesService.getMyPenalties(req.user?.id);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

penaltiesRouter.get('/', requireRole('OWNER', 'ADMIN'), async (req, res: Response) => {
  const userId = req.query.userId as string | undefined;
  const isDeducted = req.query.isDeducted as string | undefined;
  const result = await penaltiesService.getPenalties(userId, isDeducted);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

penaltiesRouter.post('/', requireRole('OWNER', 'ADMIN'), async (req, res: Response) => {
  const result = await penaltiesService.createPenalty(req.body);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.status(201).json(result.data);
});

penaltiesRouter.post('/:id/approve', async (req: AuthRequest, res: Response) => {
  if (!req.user?.id) return res.status(401).json({ error: 'Unauthorized' });
  const result = await penaltiesService.approvePenalty(req.params.id, req.user.id);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

penaltiesRouter.post('/:id/reject', async (req: AuthRequest, res: Response) => {
  if (!req.user?.id) return res.status(401).json({ error: 'Unauthorized' });
  const result = await penaltiesService.rejectPenalty(req.params.id, req.user.id);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

penaltiesRouter.patch('/:id', requireRole('OWNER', 'ADMIN'), async (req, res: Response) => {
  const result = await penaltiesService.updatePenalty(req.params.id, req.body);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});
