import { Router, Response } from 'express';
import { authMiddleware, requireRole, type AuthRequest } from '../../middleware/auth.js';
import { LeftoverRecordsService } from './leftover-records.service.js';

export const leftoverRecordsRouter = Router();
const leftoverRecordsService = new LeftoverRecordsService();

leftoverRecordsRouter.use(authMiddleware);

leftoverRecordsRouter.get('/', async (req, res: Response) => {
  const sessionId = req.query.sessionId as string | undefined;
  const result = await leftoverRecordsService.getLeftoverRecords(sessionId);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

leftoverRecordsRouter.post('/', requireRole('OWNER', 'ADMIN', 'CASHIER', 'BAKER', 'CAKE_WORKER'), async (req: AuthRequest, res: Response) => {
  const result = await leftoverRecordsService.createLeftoverRecords(req.body);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.status(201).json(result.data);
});

leftoverRecordsRouter.put('/session/:sessionId', requireRole('OWNER', 'ADMIN', 'CASHIER', 'BAKER', 'CAKE_WORKER'), async (req, res: Response) => {
  const result = await leftoverRecordsService.updateLeftoverRecords(req.params.sessionId, req.body);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

leftoverRecordsRouter.delete('/session/:sessionId/product/:productId', requireRole('OWNER', 'ADMIN', 'CASHIER', 'BAKER', 'CAKE_WORKER'), async (req, res: Response) => {
  const result = await leftoverRecordsService.deleteLeftoverRecord(req.params.sessionId, req.params.productId);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.status(204).send();
});
