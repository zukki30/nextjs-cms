import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError, INTERNAL_ERROR_MESSAGE } from "@/lib/errors";
import { errorHandler, notFoundHandler } from "./errorHandler";

/** 投げられたエラーを errorHandler に通すためだけのアプリ */
function createApp(thrown: unknown) {
  const app = new Hono();
  app.onError(errorHandler);
  app.notFound(notFoundHandler);
  app.get("/boom", () => {
    throw thrown;
  });
  return app;
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("errorHandler", () => {
  it("AppError を code に対応するステータスと JSON へ変換する", async () => {
    const response = await createApp(new AppError("NOT_FOUND", 'news "foo" is not found')).request(
      "/boom",
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: "NOT_FOUND", message: 'news "foo" is not found' },
    });
  });

  it("details を持つ AppError は details を含めて返す", async () => {
    const response = await createApp(
      new AppError("BAD_REQUEST", "invalid query parameter", {
        details: [{ path: "perPage", message: "must be <= 100" }],
      }),
    ).request("/boom");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "BAD_REQUEST",
        message: "invalid query parameter",
        details: [{ path: "perPage", message: "must be <= 100" }],
      },
    });
  });

  it("422 と 429 のステータスを対応付ける", async () => {
    const unprocessable = await createApp(
      new AppError("UNPROCESSABLE_ENTITY", "validation failed"),
    ).request("/boom");
    const rateLimited = await createApp(new AppError("RATE_LIMITED", "too many requests")).request(
      "/boom",
    );

    expect(unprocessable.status).toBe(422);
    expect(rateLimited.status).toBe(429);
  });

  it("INTERNAL_ERROR は詳細をクライアントへ返さない", async () => {
    const response = await createApp(
      new AppError("INTERNAL_ERROR", "github token abc123 の取得に失敗"),
    ).request("/boom");

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: { code: "INTERNAL_ERROR", message: INTERNAL_ERROR_MESSAGE },
    });
  });

  it("想定外のエラーは 500 に丸め、内容をレスポンスに出さない", async () => {
    const response = await createApp(new TypeError("cannot read property of undefined")).request(
      "/boom",
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: { code: "INTERNAL_ERROR", message: INTERNAL_ERROR_MESSAGE },
    });
  });

  it("HTTPException はステータスから code を逆引きする", async () => {
    const response = await createApp(new HTTPException(401, { message: "unauthorized" })).request(
      "/boom",
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "UNAUTHORIZED", message: "unauthorized" },
    });
  });

  it("対応表に無いステータスの HTTPException は近いコードへ寄せる", async () => {
    const response = await createApp(new HTTPException(418, { message: "teapot" })).request(
      "/boom",
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "BAD_REQUEST", message: "teapot" },
    });
  });

  it("5xx はエラーログ、4xx は警告ログに記録する", async () => {
    await createApp(new Error("boom")).request("/boom");
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.warn).not.toHaveBeenCalled();

    vi.mocked(console.error).mockClear();

    await createApp(new AppError("NOT_FOUND", "not found")).request("/boom");
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.error).not.toHaveBeenCalled();
  });
});

describe("notFoundHandler", () => {
  it("未定義のパスを NOT_FOUND の形式で返す", async () => {
    const response = await createApp(new Error("未使用")).request("/unknown");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: "NOT_FOUND", message: "GET /unknown is not found" },
    });
  });
});
