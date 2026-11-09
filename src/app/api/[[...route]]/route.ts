import { handle } from "hono/vercel";
import { app } from "@/server/app";

/** GitHub App の秘密鍵の署名などに Node.js の API を使うため、Edge ランタイムは使わない */
export const runtime = "nodejs";

export const GET = handle(app);
export const POST = handle(app);
export const PUT = handle(app);
export const PATCH = handle(app);
export const DELETE = handle(app);
export const OPTIONS = handle(app);
