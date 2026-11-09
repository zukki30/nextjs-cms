import { describe, expect, it, vi } from "vitest";
import { app } from "./app";

describe("GET /api/health", () => {
  it("200 と status: ok を返す", async () => {
    const response = await app.request("/api/health");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("環境変数が 1 つも無くても読み込めて応答する（env の遅延検証）", async () => {
    const original = process.env;
    process.env = {} as NodeJS.ProcessEnv;

    try {
      vi.resetModules();
      const { app: freshApp } = await import("./app");
      const response = await freshApp.request("/api/health");

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ status: "ok" });
    } finally {
      process.env = original;
      vi.resetModules();
    }
  });
});

describe("未定義のパス", () => {
  it("404 を design.md 9.4 の形式で返す", async () => {
    const response = await app.request("/api/not-exists");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: "NOT_FOUND", message: "GET /api/not-exists is not found" },
    });
  });
});
