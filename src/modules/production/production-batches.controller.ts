import { Router, Response } from 'express';
import { authMiddleware, requireRole, type AuthRequest } from '../../middleware/auth.js';
import { ProductionBatchesService } from './production-batches.service.js';

export const productionBatchesRouter = Router();
const productionBatchesService = new ProductionBatchesService();

productionBatchesRouter.use(authMiddleware);

productionBatchesRouter.get('/', async (req: AuthRequest, res: Response) => {
  const branchId = (req.query.branchId as string) || req.user?.branchId;
  const date = req.query.date as string;
  const status = req.query.status as string | undefined;
  const result = await productionBatchesService.getProductionBatches(branchId, date, status);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

productionBatchesRouter.get('/daily-product-history/all', async (req: AuthRequest, res: Response) => {
  const branchId = (req.query.branchId as string) || req.user?.branchId;
  const startDate = req.query.startDate as string | undefined;
  const endDate = req.query.endDate as string | undefined;
  const type = req.query.type as string | undefined;
  const supplierId = req.query.supplierId as string | undefined;
  const productId = req.query.productId as string | undefined;
  const search = req.query.search as string | undefined;

  const result = await productionBatchesService.getDailyProductHistory({
    branchId,
    startDate,
    endDate,
    type,
    supplierId,
    productId,
    search,
  });

  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

productionBatchesRouter.patch('/items/:itemId/return', async (req: AuthRequest, res: Response) => {
  const { returnedQuantity } = req.body;
  const result = await productionBatchesService.updateProductionItemReturn(req.params.itemId, returnedQuantity);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

productionBatchesRouter.get('/:id', async (req, res: Response) => {
  const result = await productionBatchesService.getProductionBatchById(req.params.id);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

productionBatchesRouter.post('/', requireRole('OWNER', 'ADMIN', 'BAKER', 'SAMBUSA_WORKER'), async (req: AuthRequest, res: Response) => {
  const result = await productionBatchesService.createProductionBatch(req.body, req.user!.id, req.user?.branchId);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.status(201).json(result.data);
});

productionBatchesRouter.post('/:id/approve', requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  const result = await productionBatchesService.approveProductionBatch(req.params.id, req.user!.id);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

productionBatchesRouter.post('/:id/reject', requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  const result = await productionBatchesService.rejectProductionBatch(req.params.id, req.user!.id);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

productionBatchesRouter.patch('/:id', requireRole('OWNER', 'ADMIN', 'BAKER', 'SAMBUSA_WORKER'), async (req, res: Response) => {
  const result = await productionBatchesService.updateProductionBatch(req.params.id, req.body);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

productionBatchesRouter.delete('/:id', requireRole('OWNER', 'ADMIN'), async (req, res: Response) => {
  const result = await productionBatchesService.deleteProductionBatch(req.params.id);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});
