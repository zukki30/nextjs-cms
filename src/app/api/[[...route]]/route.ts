import { app } from "@/server/app";

/** GitHub App の秘密鍵の署名などに Node.js の API を使うため、Edge ランタイムは使わない */
export const runtime = "nodejs";

/**
 * Hono へ委譲する。
 *
 * Web 標準の `Request` / `Response` をそのまま受け渡すだけなので、
 * ホスティング先に依存しない。`hono/vercel` の `handle` は中身が同じで、
 * かつ Hono v5 で削除される予定のため使わない。
 */
const handler = (request: Request) => app.fetch(request);

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
