import { Router, Response } from 'express';
import { authMiddleware, requireRole } from '../../middleware/auth.js';
import { ProductCategoriesService } from './product-categories.service.js';

export const productCategoriesRouter = Router();
const productCategoriesService = new ProductCategoriesService();

productCategoriesRouter.use(authMiddleware);

// GET /api/product-categories?tree=true  — full nested tree
// GET /api/product-categories            — flat list with parent info
productCategoriesRouter.get('/', async (req, res: Response) => {
  const tree = req.query.tree === 'true';
  const result = await productCategoriesService.getCategories(tree);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

// GET /api/product-categories/:id/subcategories — direct children of a category
productCategoriesRouter.get('/:id/subcategories', async (req, res: Response) => {
  const result = await productCategoriesService.getCategoryById(req.params.id);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  // Return only the children array for a lightweight subcategory list
  res.json((result.data as any).children ?? []);
});

productCategoriesRouter.get('/:id', async (req, res: Response) => {
  const result = await productCategoriesService.getCategoryById(req.params.id);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

productCategoriesRouter.post('/', requireRole('OWNER', 'ADMIN'), async (req, res: Response) => {
  const result = await productCategoriesService.createCategory(req.body);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.status(201).json(result.data);
});

productCategoriesRouter.patch('/:id', requireRole('OWNER', 'ADMIN'), async (req, res: Response) => {
  const result = await productCategoriesService.updateCategory(req.params.id, req.body);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

productCategoriesRouter.delete('/:id', requireRole('OWNER', 'ADMIN'), async (req, res: Response) => {
  const result = await productCategoriesService.deleteCategory(req.params.id);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.status(204).send();
});
