import { Router, Request, Response } from 'express';
import { createProxyMiddleware, responseInterceptor } from 'http-proxy-middleware';
import type { RequestHandler } from 'http-proxy-middleware';
import { getAuthToken } from './auth.js';

// Cache proxy middlewares per port to avoid creating new listeners on each request
const proxyCache = new Map<number, RequestHandler>();

function getOrCreateProxy(port: number): RequestHandler {
  if (!proxyCache.has(port)) {
    const proxy = createProxyMiddleware({
      target: `http://127.0.0.1:${port}`,
      changeOrigin: true,
      selfHandleResponse: true,
      pathRewrite: {
        [`^/preview/${port}`]: '',
      },
      ws: true,
      on: {
        proxyRes: responseInterceptor(async (responseBuffer, proxyRes, _req, _res) => {
          const contentType = proxyRes.headers['content-type'] || '';

          // Only rewrite HTML responses
          if (contentType.includes('text/html')) {
            let body = responseBuffer.toString('utf8');

            // Rewrite absolute paths to go through the proxy
            // Handle src="/...", href="/...", action="/..."
            body = body.replace(
              /(src|href|action)=(["'])\//g,
              `$1=$2/preview/${port}/`
            );

            // Handle url("/...") in inline styles
            body = body.replace(
              /url\((["']?)\//g,
              `url($1/preview/${port}/`
            );

            // Handle Next.js script patterns like "/_next/..."
            body = body.replace(
              /"(\/_next\/[^"]+)"/g,
              `"/preview/${port}$1"`
            );

            return body;
          }

          return responseBuffer;
        }),
        error: (err, _req, res) => {
          if ('writeHead' in res) {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `Cannot connect to port ${port}`, details: err.message }));
          }
        },
      },
    });
    proxyCache.set(port, proxy);
  }
  return proxyCache.get(port)!;
}

export function createPortProxy(): Router {
  const router = Router();

  // Preview-specific auth that also sets a cookie for sub-resources
  router.use('/:port', (req: Request, res: Response, next) => {
    const port = parseInt(req.params.port, 10);

    if (isNaN(port) || port < 1 || port > 65535) {
      res.status(400).json({ error: 'Invalid port number' });
      return;
    }

    // Check auth: query param, header, or cookie
    const authToken = getAuthToken();
    const queryToken = req.query.token as string;
    const headerToken = req.headers.authorization?.replace('Bearer ', '');
    const cookieToken = req.cookies?.preview_token;

    const providedToken = queryToken || headerToken || cookieToken;

    if (providedToken !== authToken) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Set cookie for sub-resource requests (if authenticated via query/header)
    if (queryToken || headerToken) {
      res.cookie('preview_token', authToken, {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
      });
    }

    // Use cached proxy middleware for this port
    const proxy = getOrCreateProxy(port);
    proxy(req, res, next);
  });

  return router;
}
