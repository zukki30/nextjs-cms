import type { ZodError } from "zod";

/**
 * アプリ共通のエラーコードと HTTP ステータスの対応。
 *
 * 公開 API のエラー形式は design.md 9.4、管理 API のステータスは design.md 10 を参照。
 */
export const ERROR_STATUS = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
} as const satisfies Record<string, number>;

export type ErrorCode = keyof typeof ERROR_STATUS;

/** フィールド単位のエラー内訳（FR-CONTENT-10） */
export type ErrorDetail = {
  path: string;
  message: string;
};

/** API が返すエラーレスポンスの本文（design.md 9.4） */
export type ErrorResponseBody = {
  error: {
    code: ErrorCode;
    message: string;
    details?: ErrorDetail[];
  };
};

/**
 * 500 のレスポンスに載せる固定の文言。
 *
 * 内部エラーの詳細はクライアントへ返さず、サーバーログにのみ記録する（design.md 9.4）。
 */
export const INTERNAL_ERROR_MESSAGE = "internal server error";

export type AppErrorOptions = {
  details?: ErrorDetail[];
  cause?: unknown;
};

/**
 * アプリ全体で投げるエラー。
 *
 * ルートはこのエラーだけを投げ、HTTP への変換は errorHandler に任せる。
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details: ErrorDetail[] | undefined;

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.details = options.details;
  }

  get status(): number {
    return ERROR_STATUS[this.code];
  }

  /**
   * クライアントへ返す本文へ変換する。
   *
   * `INTERNAL_ERROR` は詳細を伏せる。
   */
  toResponseBody(): ErrorResponseBody {
    if (this.code === "INTERNAL_ERROR") {
      return { error: { code: this.code, message: INTERNAL_ERROR_MESSAGE } };
    }

    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details && this.details.length > 0 ? { details: this.details } : {}),
      },
    };
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/** Zod の検証結果を `details` の形式へ変換する */
export function toErrorDetails(error: ZodError): ErrorDetail[] {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

/**
 * Zod の検証エラーを `AppError` へ変換する。
 *
 * 公開 API のクエリ検証は 400、管理 API のボディ検証は 422 を使う（design.md 9.4 / 10）。
 */
export function appErrorFromZod(
  error: ZodError,
  code: Extract<ErrorCode, "BAD_REQUEST" | "UNPROCESSABLE_ENTITY">,
  message: string,
): AppError {
  return new AppError(code, message, { details: toErrorDetails(error), cause: error });
}
