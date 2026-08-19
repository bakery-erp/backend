import { Router, Response } from 'express';
import { authMiddleware, requireRole, type AuthRequest } from '../../middleware/auth.js';
import { SupplierDeliveriesService } from './supplier-deliveries.service.js';

export const supplierDeliveriesRouter = Router();
const supplierDeliveriesService = new SupplierDeliveriesService();

supplierDeliveriesRouter.use(authMiddleware);

supplierDeliveriesRouter.get('/', async (req: AuthRequest, res: Response) => {
  const supplierId = req.query.supplierId as string | undefined;
  const branchId = req.query.branchId as string | undefined;
  const isPaid = req.query.isPaid as string | undefined;
  const dateYmd = (req.query.date as string | undefined)?.trim();
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const result = await supplierDeliveriesService.getSupplierDeliveries(supplierId, branchId, isPaid, dateYmd, limit);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

supplierDeliveriesRouter.get('/:id', async (req, res: Response) => {
  const result = await supplierDeliveriesService.getSupplierDeliveryById(req.params.id);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

supplierDeliveriesRouter.post('/', requireRole('OWNER', 'ADMIN', 'SAMBUSA_WORKER'), async (req: AuthRequest, res: Response) => {
  const result = await supplierDeliveriesService.createSupplierDelivery(req.body, req.user!.id);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.status(201).json(result.data);
});

supplierDeliveriesRouter.patch('/:id', requireRole('OWNER', 'ADMIN'), async (req, res: Response) => {
  const result = await supplierDeliveriesService.updateSupplierDelivery(req.params.id, req.body);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

supplierDeliveriesRouter.delete('/:id', requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  const result = await supplierDeliveriesService.deleteSupplierDelivery(req.params.id, req.user!.id);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.status(204).send();
});
