import type { NextFunction, Request, Response, RequestHandler } from 'express';

/** Express 4: forwards rejected promises from async route handlers to `next(err)` so the client gets JSON errors instead of a bare 500. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void | Response>
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
