/**
 * Startup validation for required configuration.
 * Warns if configuration is missing, allowing server to boot and report health.
 */
export function validateEnv(): void {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const isProd = nodeEnv === 'production';

  if (!process.env.DATABASE_URL?.trim()) {
    console.error('CRITICAL WARNING: DATABASE_URL is not set in environment or .env!');
  }

  const jwt = process.env.JWT_SECRET?.trim();
  if (isProd) {
    if (!jwt || jwt === 'dev-secret' || jwt === 'dev-secret-change-in-production') {
      console.warn('WARNING: In production, set a strong JWT_SECRET.');
    }
  }
}
