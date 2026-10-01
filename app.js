import app from './dist/app.js';

if (process.argv[1] && process.argv[1].endsWith('app.js')) {
  import('./dist/index.js');
}

export default app;
