/**
 * Startup validation for required configuration.
 * Call before listening so production never runs with unsafe defaults.
 */
export function validateEnv(): void {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const isProd = nodeEnv === 'production';

  if (!process.env.DATABASE_URL?.trim()) {
    console.error('FATAL: DATABASE_URL is required');
    process.exit(1);
  }

  const jwt = process.env.JWT_SECRET?.trim();
  if (isProd) {
    if (!jwt || jwt === 'dev-secret' || jwt === 'dev-secret-change-in-production') {
      console.error('FATAL: In production, set a strong JWT_SECRET (not the dev default).');
      process.exit(1);
    }
  }
}
