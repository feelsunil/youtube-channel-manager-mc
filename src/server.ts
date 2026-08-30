import crypto from 'node:crypto';
import fs from 'node:fs';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { createMcpExpressApp } from '@modelcontextprotocol/express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import pino from 'pino';
import { loadConfig } from './config.js';
import { safeEqual } from './crypto.js';
import { YouTubeClient } from './google.js';
import { createMcpServer } from './mcp.js';
import { TokenStore } from './store.js';

const config = loadConfig();
fs.mkdirSync(config.uploadRoot, { recursive: true, mode: 0o700 });
const logger = pino({ level: config.LOG_LEVEL, redact: ['req.headers.authorization', 'code', 'access_token', 'refresh_token'] });
const store = new TokenStore(config.dataDir, config.encryptionKey);
const youtube = new YouTubeClient(config, store);
const app = createMcpExpressApp({ host: '0.0.0.0' });

app.use(helmet({ contentSecurityPolicy: false }));
app.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }));

app.get('/health', (_req, res) => res.json({ ok: true, connected: store.hasGoogleToken(), mode: config.YOUTUBE_MODE }));

app.get('/auth/google/start', (req, res) => {
  const setupToken = typeof req.query.setup_token === 'string' ? req.query.setup_token : '';
  if (!safeEqual(setupToken, config.SETUP_TOKEN)) return res.status(401).send('Invalid setup token');
  return res.redirect(youtube.beginAuthorization());
});

app.get('/auth/google/callback', async (req, res) => {
  try {
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    if (!code || !state) return res.status(400).send('Missing OAuth code or state');
    await youtube.finishAuthorization(code, state);
    return res.type('html').send('<h1>YouTube connected</h1><p>You can close this tab and return to ChatGPT.</p>');
  } catch (error) {
    logger.error({ err: error }, 'Google OAuth callback failed');
    return res.status(400).send('YouTube connection failed. Check server logs.');
  }
});

function mcpAuthorized(req: any) {
  if (!config.MCP_ACCESS_TOKEN) return config.BASE_URL.startsWith('http://localhost') || config.BASE_URL.startsWith('http://127.0.0.1');
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  return safeEqual(token, config.MCP_ACCESS_TOKEN);
}

app.post('/mcp', async (req, res) => {
  if (!mcpAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' });
  const server = createMcpServer(youtube);
  const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    logger.error({ err: error, requestId: crypto.randomUUID() }, 'MCP request failed');
    if (!res.headersSent) res.status(500).json({ error: 'MCP request failed' });
  }
});

app.listen(config.PORT, '0.0.0.0', () => {
  logger.info({ port: config.PORT, baseUrl: config.BASE_URL, mode: config.YOUTUBE_MODE }, 'YouTube MCP ready');
});
