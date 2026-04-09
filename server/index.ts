import "dotenv/config"; // must be first — loads .env before any other imports read process.env
import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import MemoryStore from "memorystore";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { startTelemetryCollector } from "./telemetry";
import { createServer } from "http";
import { createDbSessionStore } from "./session-store";
import { storage } from "./storage";

const app = express();
const httpServer = createServer(app);

// Trust the first reverse proxy (cPanel/nginx/Apache in front of the Node process).
// Required for correct IP forwarding and secure cookie handling when behind a proxy.
app.set("trust proxy", 1);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

// ── Session store ────────────────────────────────────────
// Use DB-backed store when DB credentials are present (survives process restarts).
// Falls back to MemoryStore for dev/sandbox environments.
const MStore = MemoryStore(session);
const sessionStore = createDbSessionStore() ?? new MStore({ checkPeriod: 86400000 });

app.use(session({
  secret: process.env.SESSION_SECRET || "mc-dev-secret-change-in-production",
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  cookie: {
    httpOnly: true,           // not accessible via JS — XSS protection
    secure: process.env.NODE_ENV === "production" && process.env.HTTPS === "true",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
  name: "mc.sid",
}));

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

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
      log(logLine);
    }
  });

  next();
});

(async () => {
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    console.error("Internal Server Error:", err);
    if (res.headersSent) return next(err);
    return res.status(status).json({ message });
  });

  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  const port = parseInt(process.env.PORT || "5000", 10);

  // Kill stale openclaw agent processes from prior runs
  try { const { execSync } = await import("child_process"); execSync("pkill -f 'openclaw agent' 2>/dev/null || true", { timeout: 3000 }); } catch {}

  httpServer.listen({ port, host: "0.0.0.0", reusePort: true }, () => {
    log(`serving on port ${port}`);
    // Start telemetry collector in production (reads OpenClaw gateway logs + sessions)
    if (process.env.NODE_ENV === "production") {
      startTelemetryCollector();
    }
  });
})();
