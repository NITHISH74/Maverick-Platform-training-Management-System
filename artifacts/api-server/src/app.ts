import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "node:path";
import fs from "node:fs";
import router from "./routes";
import internalRouter from "./routes/internal";
import { logger } from "./lib/logger";

const app: Express = express();

// Location of the built React app. In the Docker image the frontend is baked
// in at /app/public (process.cwd() === /app). Falls back to a friendly API
// landing page when the directory is absent (e.g. local dev, where Vite serves
// the frontend on :5173 instead).
const publicDir = process.env.PUBLIC_DIR ?? path.join(process.cwd(), "public");
const serveFrontend = fs.existsSync(path.join(publicDir, "index.html"));

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend assets (JS/CSS/images) when the build is present.
if (serveFrontend) {
  app.use(express.static(publicDir));
} else {
  // Friendly root response so visiting http://localhost:8080/ doesn't show
  // "Cannot GET /". The API only serves routes under /api.
  app.get("/", (_req, res) => {
    res.type("text/html").send(
      `<!doctype html><html><head><title>Maverick API</title></head><body style="font-family:system-ui;max-width:640px;margin:40px auto;padding:0 16px;">
<h1>Maverick API</h1>
<p>This is the API server. It only serves routes under <code>/api</code>.</p>
<ul>
  <li><a href="/api/healthz">GET /api/healthz</a> — health check</li>
  <li><code>POST /api/auth/login</code></li>
  <li><code>POST /api/auth/exchange</code> (Auth0 → Base64 token bridge)</li>
  <li><code>GET /api/auth/me</code></li>
</ul>
<p>Open the web app at <a href="http://localhost:5173/">http://localhost:5173/</a>.</p>
</body></html>`,
    );
  });
}

app.use("/api", router);

// Internal-only routes: x-internal-token guarded (no Bearer auth). The
// Python AI service calls these for fan-out email + on-demand scans.
// Deliberately NOT under /api so the user-facing auth layer never sees them.
app.use("/internal", internalRouter);

// SPA fallback: any non-API GET that isn't a static file returns index.html so
// client-side routing (wouter) works on deep links / refresh. Registered after
// /api and /internal so those always win. Uses a path-less middleware to avoid
// Express 5 wildcard-route pattern quirks.
if (serveFrontend) {
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (req.path.startsWith("/api") || req.path.startsWith("/internal")) {
      return next();
    }
    res.sendFile(path.join(publicDir, "index.html"));
  });
}

// Optional cron scheduler for the autonomous monitoring agent. OFF by
// default so dev/demo runs don't fire emails on a schedule; set
// ENABLE_MONITORING_SCHEDULER=true to start it. The schedule itself is
// read from monitoring_config.scheduler_cron (default 0 11 * * *).
if (process.env.ENABLE_MONITORING_SCHEDULER === "true") {
  // Lazy import so the scheduler module (and its node-cron dep) only
  // loads when actually enabled.
  void import("./lib/scheduler").then(({ startMonitoringScheduler }) => {
    void startMonitoringScheduler();
  });
}

export default app;
