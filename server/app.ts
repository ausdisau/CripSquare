import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer, type Server } from "http";
import { extensionManager } from "./extensions";
import path from "path";

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

export interface AppOptions {
  staticPath?: string;
  development?: boolean;
}

export interface AppInstance {
  app: express.Express;
  httpServer: Server;
}

export async function createApp(options: AppOptions = {}): Promise<AppInstance> {
  const app = express();
  const httpServer = createServer(app);

  app.use(
    express.json({
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );

  app.use(express.urlencoded({ extended: false }));

  exportLogMiddleware(app);

  await extensionManager.initialize();
  await registerRoutes(httpServer, app);

  // These seed operations are idempotent and keep the local/demo environment
  // usable while also initializing the same data for a serverless deployment.
  try {
    const { storage } = await import("./storage");
    await storage.seedTransportProviders();
    log("Transport demo data ready", "transport");
  } catch (err) {
    log(`Transport seed failed: ${err}`, "transport");
  }

  try {
    const { storage } = await import("./storage");
    await storage.seedForumCategories();
    log("Forum categories ready", "forums");
  } catch (err) {
    log(`Forum categories seed failed: ${err}`, "forums");
  }

  try {
    const { storage } = await import("./storage");
    await storage.seedVenuesAndEvents();
    log("Venues and events ready", "discover");
  } catch (err) {
    log(`Venues/events seed failed: ${err}`, "discover");
  }

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  const isDevelopment = options.development ?? process.env.NODE_ENV !== "production";
  if (isDevelopment) {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  } else {
    serveStatic(
      app,
      options.staticPath ?? path.resolve(__dirname, "public"),
    );
  }

  return { app, httpServer };
}

function exportLogMiddleware(app: express.Express) {
  app.use((req, res, next) => {
    const start = Date.now();
    const requestPath = req.path;
    let capturedJsonResponse: Record<string, any> | undefined = undefined;

    const originalResJson = res.json;
    res.json = function (bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };

    res.on("finish", () => {
      const duration = Date.now() - start;
      if (requestPath.startsWith("/api")) {
        let logLine = `${req.method} ${requestPath} ${res.statusCode} in ${duration}ms`;
        if (capturedJsonResponse && !requestPath.startsWith("/api/forums")) {
          logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
        }

        log(logLine);
      }
    });

    next();
  });
}

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}