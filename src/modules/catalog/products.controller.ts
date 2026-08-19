import { Router, Response } from 'express';
import { authMiddleware, requireRole } from '../../middleware/auth.js';
import { ProductsService } from './products.service.js';

export const productsRouter = Router();
const productsService = new ProductsService();

productsRouter.use(authMiddleware);

// GET /api/products?categoryId=...&includeSubcategories=true&search=cake&type=PRODUCED&isActive=true
productsRouter.get('/', async (req, res: Response) => {
  const categoryId = req.query.categoryId as string | undefined;
  const includeSubcategories = req.query.includeSubcategories === 'true';
  const search = req.query.search as string | undefined;
  const type = req.query.type as string | undefined;
  const isActiveParam = req.query.isActive as string | undefined;
  const isActive = isActiveParam === 'true' ? true : isActiveParam === 'false' ? false : undefined;

  const result = await productsService.getProducts(categoryId, includeSubcategories, search, type, isActive);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

productsRouter.get('/:id', async (req, res: Response) => {
  const result = await productsService.getProductById(req.params.id);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

productsRouter.post('/', requireRole('OWNER', 'ADMIN'), async (req, res: Response) => {
  const result = await productsService.createProduct(req.body);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.status(201).json(result.data);
});

productsRouter.patch('/:id', requireRole('OWNER', 'ADMIN'), async (req, res: Response) => {
  const result = await productsService.updateProduct(req.params.id, req.body);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

// DELETE /api/products/:id — soft-deactivates if product has history, hard-deletes if clean
productsRouter.delete('/:id', requireRole('OWNER', 'ADMIN'), async (req, res: Response) => {
  const result = await productsService.deleteProduct(req.params.id);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});
