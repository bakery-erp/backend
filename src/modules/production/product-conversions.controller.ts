import { Router, Response } from 'express';
import { authMiddleware, requireRole, type AuthRequest } from '../../middleware/auth.js';
import { ProductConversionsService } from './product-conversions.service.js';

export const productConversionsRouter = Router();
const productConversionsService = new ProductConversionsService();

productConversionsRouter.use(authMiddleware);

productConversionsRouter.get('/', async (req: AuthRequest, res: Response) => {
  const branchId = (req.query.branchId as string) || req.user?.branchId;
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const result = await productConversionsService.getProductConversions(branchId, limit, from, to);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

productConversionsRouter.get('/:id', async (req, res: Response) => {
  const result = await productConversionsService.getProductConversionById(req.params.id);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

productConversionsRouter.post('/', requireRole('OWNER', 'ADMIN', 'BAKER', 'CASHIER'), async (req: AuthRequest, res: Response) => {
  const result = await productConversionsService.createProductConversion(req.body, req.user!.id, req.user?.branchId);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.status(201).json(result.data);
});

productConversionsRouter.patch('/:id', requireRole('OWNER', 'ADMIN', 'BAKER', 'CASHIER'), async (req, res: Response) => {
  const result = await productConversionsService.updateProductConversion(req.params.id, req.body);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

productConversionsRouter.put('/:id', requireRole('OWNER', 'ADMIN', 'BAKER', 'CASHIER'), async (req, res: Response) => {
  const result = await productConversionsService.updateProductConversion(req.params.id, req.body);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

productConversionsRouter.delete('/:id', requireRole('OWNER', 'ADMIN', 'BAKER', 'CASHIER'), async (req, res: Response) => {
  const result = await productConversionsService.deleteProductConversion(req.params.id);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.status(204).send();
});
