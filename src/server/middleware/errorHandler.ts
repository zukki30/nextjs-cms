import type { Context, ErrorHandler, NotFoundHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { AppError, ERROR_STATUS, type ErrorCode, isAppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

/**
 * エラーを design.md 9.4 の形式へ変換する。
 *
 * - `AppError` は `code` と対応するステータスで返す
 * - `HTTPException` はステータスから `code` を逆引きする
 * - それ以外は 500 とし、詳細はクライアントへ返さずサーバーログにのみ記録する
 */

const STATUS_TO_CODE = new Map<number, ErrorCode>(
  Object.entries(ERROR_STATUS).map(([code, status]) => [status, code as ErrorCode]),
);

function toAppError(error: unknown): AppError {
  if (isAppError(error)) {
    return error;
  }

  if (error instanceof HTTPException) {
    const code =
      STATUS_TO_CODE.get(error.status) ?? (error.status >= 500 ? "INTERNAL_ERROR" : "BAD_REQUEST");
    return new AppError(code, error.message, { cause: error });
  }

  return new AppError("INTERNAL_ERROR", "unhandled error", { cause: error });
}

function logError(appError: AppError, original: unknown, c: Context): void {
  const fields = {
    code: appError.code,
    status: appError.status,
    method: c.req.method,
    path: c.req.path,
    err: original instanceof Error ? original : { message: String(original) },
  };

  if (appError.status >= 500) {
    logger.error("request failed", fields);
    return;
  }

  logger.warn("request rejected", fields);
}

export const errorHandler: ErrorHandler = (error, c) => {
  const appError = toAppError(error);
  logError(appError, error, c);

  return c.json(appError.toResponseBody(), appError.status as ContentfulStatusCode);
};

export const notFoundHandler: NotFoundHandler = (c) => {
  const appError = new AppError("NOT_FOUND", `${c.req.method} ${c.req.path} is not found`);

  return c.json(appError.toResponseBody(), appError.status as ContentfulStatusCode);
};
