import { Hono } from "hono";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";

/**
 * Hono のアプリケーションインスタンス。
 *
 * `src/app/api/[[...route]]/route.ts` からマウントする。
 * 公開 API（`/api/v1`）・管理 API（`/api/admin`）・Webhook は以降のフェーズでここへ追加する。
 */
export const app = new Hono().basePath("/api");

app.onError(errorHandler);
app.notFound(notFoundHandler);

/** 死活確認。外部サービスへは問い合わせない */
app.get("/health", (c) => c.json({ status: "ok" }));

export type AppType = typeof app;
