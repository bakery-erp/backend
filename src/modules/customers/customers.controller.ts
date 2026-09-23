import { Router, Response } from 'express';
import { authMiddleware, requireRole, type AuthRequest } from '../../middleware/auth.js';
import { CustomersService } from './customers.service.js';

export const customersRouter = Router();
const customersService = new CustomersService();

customersRouter.use(authMiddleware);

// --- CREDIT TRANSACTIONS (Specific routes before :id) ---

customersRouter.get('/credits', async (req: AuthRequest, res: Response) => {
  const branchId = (req.query.branchId as string) || req.user?.branchId;
  const customerId = req.query.customerId as string | undefined;
  const status = req.query.status as string | undefined;
  const search = req.query.search as string | undefined;
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;

  const result = await customersService.getCredits({
    branchId: req.user?.role === 'OWNER' ? (req.query.branchId as string) : branchId,
    customerId,
    status,
    search,
    from,
    to,
  });

  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

customersRouter.post('/credits', async (req: AuthRequest, res: Response) => {
  const result = await customersService.createCredit(
    req.body,
    req.user?.branchId
  );
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.status(201).json(result.data);
});

customersRouter.get('/credits/:id', async (req, res: Response) => {
  const result = await customersService.getCreditById(req.params.id);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

customersRouter.post('/credits/:id/pay', async (req, res: Response) => {
  const result = await customersService.payCredit(req.params.id, req.body);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

customersRouter.delete('/credits/:id', requireRole('OWNER', 'ADMIN'), async (req, res: Response) => {
  const result = await customersService.deleteCredit(req.params.id);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

// --- CUSTOMERS DIRECTORY ---

customersRouter.get('/', async (req: AuthRequest, res: Response) => {
  const branchId = (req.query.branchId as string) || req.user?.branchId;
  const search = req.query.search as string | undefined;
  const companyId = req.query.companyId as string | undefined;

  const result = await customersService.getCustomers({
    branchId: req.user?.role === 'OWNER' ? (req.query.branchId as string) : branchId,
    companyId,
    search,
  });

  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

customersRouter.post('/', async (req: AuthRequest, res: Response) => {
  const result = await customersService.createCustomer({
    ...req.body,
    branchId: req.body.branchId || req.user?.branchId,
  });
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.status(201).json(result.data);
});

customersRouter.get('/:id', async (req, res: Response) => {
  const result = await customersService.getCustomerById(req.params.id);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

customersRouter.patch('/:id', async (req, res: Response) => {
  const result = await customersService.updateCustomer(req.params.id, req.body);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

customersRouter.delete('/:id', requireRole('OWNER', 'ADMIN'), async (req, res: Response) => {
  const result = await customersService.deleteCustomer(req.params.id);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});
