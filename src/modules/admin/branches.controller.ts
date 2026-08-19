import { Router, Response } from 'express';
import { authMiddleware, requireRole, AuthRequest } from '../../middleware/auth.js';
import { tenantContext } from '../../middleware/tenant.js';
import { BranchesService } from './branches.service.js';

export const branchesRouter = Router();
const branchesService = new BranchesService();

branchesRouter.use(authMiddleware);
branchesRouter.use(tenantContext);

branchesRouter.get('/', requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  const result = await branchesService.getBranches(req.user);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

branchesRouter.get('/:id', requireRole('OWNER', 'ADMIN'), async (req: AuthRequest, res: Response) => {
  const result = await branchesService.getBranchById(req.params.id, req.user);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

branchesRouter.post('/', requireRole('OWNER'), async (req: AuthRequest, res: Response) => {
  const companyId = req.tenantId;
  if (!companyId) {
    return res.status(400).json({ error: 'companyId required (tenant context not resolved)' });
  }
  const result = await branchesService.createBranch(req.body, companyId);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.status(201).json(result.data);
});

branchesRouter.patch('/:id', requireRole('OWNER'), async (req: AuthRequest, res: Response) => {
  const result = await branchesService.updateBranch(req.params.id, req.body);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});
