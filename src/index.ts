import 'dotenv/config';
import { validateEnv } from './lib/env.js';
import { app } from './app.js';
const PORT = process.env.PORT ?? 3003;

validateEnv();

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`Swagger at http://localhost:${PORT}/api-docs`);
});
