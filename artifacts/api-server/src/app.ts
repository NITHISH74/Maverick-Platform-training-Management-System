import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import internalRouter from "./routes/internal";
import { logger } from "./lib/logger";

const app: Express = express();

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

app.use("/api", router);

// Internal-only routes: x-internal-token guarded (no Bearer auth). The
// Python AI service calls these for fan-out email + on-demand scans.
// Deliberately NOT under /api so the user-facing auth layer never sees them.
app.use("/internal", internalRouter);

export default app;
