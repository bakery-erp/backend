import { Router, Response } from 'express';
import { authMiddleware, requireRole } from '../../middleware/auth.js';
import { FinancialCategoriesService } from './financial-categories.service.js';

export const financialCategoriesRouter = Router();
const financialCategoriesService = new FinancialCategoriesService();

financialCategoriesRouter.use(authMiddleware);

financialCategoriesRouter.get('/', async (req, res: Response) => {
  const type = (req.query.type as string | undefined)?.toUpperCase();
  const result = await financialCategoriesService.getFinancialCategories(type);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

financialCategoriesRouter.get('/:id', async (req, res: Response) => {
  const result = await financialCategoriesService.getFinancialCategoryById(req.params.id);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

financialCategoriesRouter.post('/', requireRole('OWNER', 'ADMIN'), async (req, res: Response) => {
  const result = await financialCategoriesService.createFinancialCategory(req.body);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.status(201).json(result.data);
});

financialCategoriesRouter.patch('/:id', requireRole('OWNER', 'ADMIN'), async (req, res: Response) => {
  const result = await financialCategoriesService.updateFinancialCategory(req.params.id, req.body);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

financialCategoriesRouter.delete('/:id', requireRole('OWNER', 'ADMIN'), async (req, res: Response) => {
  const result = await financialCategoriesService.deleteFinancialCategory(req.params.id);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.status(204).send();
});
