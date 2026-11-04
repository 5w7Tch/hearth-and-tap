// Vercel entrypoint (zero-config Hono): the default export is the app.
import { createApp } from './app.js';
import { buildProductionDeps } from './deps.js';

export default createApp(buildProductionDeps());
