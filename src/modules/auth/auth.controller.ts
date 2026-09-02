import { Router, Response } from 'express';
import { authMiddleware, type AuthRequest } from '../../middleware/auth.js';
import { AuthService } from './auth.service.js';

export const authRouter = Router();
const authService = new AuthService();

authRouter.patch('/password', authMiddleware, async (req: AuthRequest, res: Response) => {
  const result = await authService.changePassword(req.user!.id, req.body);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

authRouter.post('/login', async (req, res: Response) => {
  try {
    const result = await authService.login(req.body);
    if (result.error) {
      return res.status(result.status || 500).json({ error: result.error });
    }
    res.json(result.data);
  } catch (err: any) {
    console.error('Login Endpoint Error:', err);
    res.status(500).json({ error: err?.message || 'Login failed due to an internal server error.' });
  }
});

authRouter.post('/logout', authMiddleware, (_req, res) => {
  res.json({ message: 'Logged out successfully' });
});

authRouter.get('/me', authMiddleware, async (req: AuthRequest, res: Response) => {
  const result = await authService.getCurrentUser(req.user!.id);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

// Public employee request for password reset
authRouter.post('/forgot-password', async (req, res: Response) => {
  const result = await authService.requestPasswordReset(req.body);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

// Protected (OWNER/ADMIN): List password reset requests
authRouter.get('/password-reset-requests', authMiddleware, async (req: AuthRequest, res: Response) => {
  const result = await authService.getPasswordResetRequests(req.user!.id);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

// Protected (OWNER/ADMIN): Generate new password for a specific employee or resolve request
authRouter.post('/admin-reset-password', authMiddleware, async (req: AuthRequest, res: Response) => {
  const result = await authService.adminResetEmployeePassword(req.user!.id, req.body);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});

// Protected (OWNER/ADMIN): Reject password reset request
authRouter.post('/password-reset-requests/:id/reject', authMiddleware, async (req: AuthRequest, res: Response) => {
  const result = await authService.rejectPasswordResetRequest(req.user!.id, req.params.id);
  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }
  res.json(result.data);
});
