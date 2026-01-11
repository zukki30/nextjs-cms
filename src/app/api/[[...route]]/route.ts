import { Hono } from "hono";
import { handle } from "hono/vercel";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";

const app = new Hono().basePath("/api");

// Better Auth のルートを追加
app.on(["POST", "GET"], "/auth/**", (c) => auth.handler(c.req.raw));

// サンプル API エンドポイント
app.get("/hello", (c) => {
  return c.json({
    message: "Hello from Hono!",
  });
});

import { zValidator } from "@hono/zod-validator";
// Zod を使ったバリデーション例
import { z } from "zod";

const userSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
});

app.post("/users", zValidator("json", userSchema), async (c) => {
  const data = c.req.valid("json");
  // ここでデータベースに保存する処理を追加
  return c.json({ success: true, data });
});

export const GET = handle(app);
export const POST = handle(app);
export const PUT = handle(app);
export const PATCH = handle(app);
export const DELETE = handle(app);
