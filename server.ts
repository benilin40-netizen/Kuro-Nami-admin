import 'dotenv/config';
import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { initializeDatabase } from './src/server/db';
import { LogSeverity } from './src/shared/types';
import { recordSystemLog, requestTelemetryMiddleware } from './src/server/monitoring';
import { createRateLimiter } from './src/server/security';
import { authRouter } from './src/server/routes/authRoutes';
import { catalogRouter } from './src/server/routes/catalogRoutes';
import { infraRouter } from './src/server/routes/infraRoutes';
import { opsRouter } from './src/server/routes/opsRoutes';
import { paymentRouter } from './src/server/routes/paymentRoutes';
import { syncRouter } from './src/server/routes/syncRoutes';

async function startServer() {
  initializeDatabase();

  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // CORS and Security Headers for Live KURO NAMI Website Origin (https://kuro-name-v1.vercel.app/)
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    const allowedOrigins = ['https://kuro-name-v1.vercel.app', 'https://kuro-nami-v1.vercel.app'];

    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }

    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-CSRF-Token, verif-hash');
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  app.use(express.json({ limit: '2mb' }));
  app.use(requestTelemetryMiddleware);

  // Global API rate limiter
  app.use(
    '/api/v1',
    createRateLimiter({
      keyPrefix: 'api_global',
      windowMs: 60_000,
      maxRequests: 300,
    })
  );

  // Public diagnostic liveness probe (never exposes secrets or workspace data)
  app.get('/api/v1/health', (_req, res) => {
    res.json({
      service: 'kuro-nami-admin',
      status: 'operational',
      websiteIntegrationOrigin: 'https://kuro-name-v1.vercel.app/',
      timestamp: new Date().toISOString(),
    });
  });

  // Mount versioned administrative & payment API modules
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1', catalogRouter);
  app.use('/api/v1', infraRouter);
  app.use('/api/v1', opsRouter);
  app.use('/api/v1', paymentRouter);
  app.use('/api/v1', syncRouter);

  // Unknown API route handler
  app.use('/api/{*splat}', (_req, res) => {
    res.status(404).json({ error: 'Administrative API endpoint not found.' });
  });

  // Global error handler ensuring no stack traces or secrets leak
  app.use(
    (
      err: Error,
      req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      recordSystemLog({
        workspaceId: req.admin?.workspaceId || null,
        severity: LogSeverity.ERROR,
        component: 'ExpressRuntime',
        message: err.message || 'Unhandled server error',
      });
      res.status(500).json({ error: 'Internal server error.' });
    }
  );

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('{*splat}', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    recordSystemLog({
      severity: LogSeverity.INFO,
      component: 'Bootstrap',
      message: `KURO NAMI ADMIN server listening on port ${PORT}`,
    });
    console.log(`KURO NAMI ADMIN running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
