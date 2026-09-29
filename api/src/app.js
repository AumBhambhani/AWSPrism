import cors from "cors";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { errorHandler } from "./middleware/errorHandler.js";
import { requestTimeout } from "./middleware/timeout.js";
import { router as apiRouter } from "./routes/index.js";
import { logosDir } from "./utils/logoStorage.js";

// Backstop for every route that doesn't set its own limiter (login/reset/contact
// have tighter, route-specific ones). Generous enough not to bother normal use.
const globalLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please slow down and try again shortly." },
});

export function createApp() {
  const app = express();

  // Reverse proxy (nginx/Cloudflare) is always the first hop in front of this
  // app — trust it so req.ip (rate limiting, audit logging) reflects the real
  // client IP instead of the proxy's.
  app.set("trust proxy", 1);

  const corsOrigin = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(",").map(v => v.trim())
    : "*";

  app.use(helmet());
  app.use(cors({ origin: corsOrigin }));
  app.use("/api", globalLimiter);
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use(requestTimeout(30000));

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  // Logos are images only (utils/logoStorage.js); never let a browser sniff or run them.
  // The folder is resolved per request so it follows UPLOAD_DIR.
  const logoStatic = new Map();
  app.use("/api/logos", (req, res, next) => {
    const dir = logosDir();
    if (!logoStatic.has(dir)) {
      logoStatic.set(dir, express.static(dir, {
        dotfiles: "deny",
        setHeaders: (r) => {
          r.setHeader("X-Content-Type-Options", "nosniff");
          r.setHeader("Content-Security-Policy", "default-src 'none'; img-src 'self'; sandbox");
        },
      }));
    }
    logoStatic.get(dir)(req, res, next);
  });

  app.use("/api", apiRouter);
  app.use(errorHandler);

  return app;
}

export default createApp();
