import { Router, Request, Response } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';

export function createPortProxy(): Router {
  const router = Router();

  // Handle /preview/:port/* requests
  router.use('/:port', (req: Request, res: Response, next) => {
    const port = parseInt(req.params.port, 10);

    if (isNaN(port) || port < 1 || port > 65535) {
      res.status(400).json({ error: 'Invalid port number' });
      return;
    }

    // Create proxy middleware for this port
    const proxy = createProxyMiddleware({
      target: `http://127.0.0.1:${port}`,
      changeOrigin: true,
      pathRewrite: {
        [`^/preview/${port}`]: '',
      },
      ws: true,
      on: {
        error: (err, _req, res) => {
          if ('writeHead' in res) {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `Cannot connect to port ${port}`, details: err.message }));
          }
        },
      },
    });

    proxy(req, res, next);
  });

  return router;
}
