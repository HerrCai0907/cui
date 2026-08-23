import { Router } from "express";

export function createHealthRouter(): Router {
  const router = Router();

  router.get("/api/health", (_request, response) => {
    response.json({
      status: "ok",
      service: "@cui/api",
      time: new Date().toISOString(),
    });
  });

  return router;
}
