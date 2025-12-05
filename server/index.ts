import express, { type Request, Response, NextFunction } from "express";
import compression from "compression";
import { registerRoutes } from "./routes";
import { isAuthenticated } from "./auth";
import { setupVite, serveStatic, log } from "./vite";
import { initializeSampleAgents } from "./initialize-sample-agents";
import { initializeSampleUsers, initializeSampleOrganizations } from "./initialize-sample-users";

// 🚀 Re-export broadcast functions from separate module (순환 참조 방지)
export {
  sseClients,
  getNextEventId,
  broadcastWithEventId,
  broadcastAgentUpdate,
  broadcastGroupChatDeleted,
  broadcastGroupChatStatus,
  broadcastGroupChatMessage,
  cleanupOldBroadcastEvents,
  type SSEClient,
  type BroadcastEvent
} from "./broadcast";

const app = express();

// Enable gzip compression for better performance (exclude SSE endpoint)
app.use(compression({
  filter: (req, res) => {
    // 🚫 SSE 엔드포인트는 압축 제외 (실시간 스트리밍 보장)
    if (req.path === '/events') {
      console.log('[🚫 COMPRESSION] SSE 엔드포인트 압축 제외');
      return false;
    }
    
    // text/event-stream 응답은 압축 제외
    const contentType = res.getHeader('Content-Type');
    if (typeof contentType === 'string' && contentType.includes('text/event-stream')) {
      console.log('[🚫 COMPRESSION] SSE 컨텐츠 타입 압축 제외');
      return false;
    }
    
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  },
  threshold: 1024, // Only compress responses larger than 1KB
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false, limit: '10mb' }));

// 모든 POST 요청 로깅
app.use((req, res, next) => {
  if (req.method === 'POST') {
    // 🔒 SECURITY: Mask sensitive data in logs
    const safeBody = req.url === '/api/login' && req.body.password ? 
      { ...req.body, password: '[MASKED]' } : req.body;
    console.log('📤 POST 요청:', req.url, 'Body:', JSON.stringify(safeBody, null, 2));
  }
  next();
});

// Serve uploaded files statically
app.use('/uploads', express.static('uploads'));

// Add support for Korean filenames in multipart forms
app.use((req, res, next) => {
  // Set proper charset for handling Korean filenames
  req.setEncoding = req.setEncoding || (() => {});
  next();
});

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

// Use top-level await instead of async IIFE for better bundling compatibility
await registerRoutes(app);

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const status = err.status || err.statusCode || 500;
  const message = err.message || "Internal Server Error";

  res.status(status).json({ message });
  throw err;
});

// ALWAYS serve the app on port 5000
// this serves both the API and the client.
// It is the only port that is not firewalled.
const port = 5000;
const server = app.listen({
  port,
  host: "0.0.0.0",
  reusePort: true,
}, async () => {
  log(`serving on port ${port}`);

  // 🕐 멀티-에이전트 처리를 위한 HTTP 타임아웃 증가 (기본 2분 → 10분)
  server.timeout = 600000; // 10분
  server.keepAliveTimeout = 605000; // 10분 5초
  server.headersTimeout = 610000; // 10분 10초
  console.log('[⏱️ TIMEOUT] HTTP 타임아웃 10분으로 설정 (멀티-에이전트 처리용)');

  // System now uses admin center managed database files only
  console.log("LoBo AI messenger now using admin center managed database files");
});

// importantly only setup vite in development and after
// setting up all the other routes so the catch-all route
// doesn't interfere with the other routes
if (app.get("env") === "development") {
  await setupVite(app, server);
} else {
  serveStatic(app);
}

// Skip all sample data initialization - using admin center managed database files only
console.log("LoBo AI messenger integrated with admin center managed database files");