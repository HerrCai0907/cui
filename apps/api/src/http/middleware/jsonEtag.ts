import { createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export function createJsonEtagMiddleware() {
  return (request: Request, response: Response, next: NextFunction) => {
    if (request.method !== "GET") {
      next();
      return;
    }

    const originalJson = response.json.bind(response);

    response.json = (body: unknown) => {
      if (response.headersSent || response.statusCode < 200 || response.statusCode >= 300) {
        return originalJson(body);
      }

      const etag = createJsonEtag(body);

      response.setHeader("ETag", etag);
      response.setHeader("Cache-Control", "private, must-revalidate");
      response.vary("Accept-Encoding");

      if (request.headers["if-none-match"] === etag) {
        return response.status(304).end();
      }

      return originalJson(body);
    };

    next();
  };
}

function createJsonEtag(body: unknown): string {
  const hash = createHash("sha256").update(JSON.stringify(body)).digest("base64url");

  return `"${hash}"`;
}
