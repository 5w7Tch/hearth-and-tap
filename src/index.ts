// Vercel entrypoint (zero-config Hono): the default export is the app.
// Vercel's Hono preset only accepts an entry file that imports 'hono', so the export is typed as one.
import type { Env, Hono } from 'hono';
import { createApp } from './app.js';
import { buildProductionDeps } from './deps.js';

const app: Hono<Env> = createApp(buildProductionDeps());
export default app;
