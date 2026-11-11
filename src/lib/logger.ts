/**
 * 構造化ログ。
 *
 * ログは 1 行 1 JSON で出力する。シークレットやトークンは出力しない（NFR-SEC-09）。
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = Record<string, unknown>;

/** マスク後に出力される文字列 */
export const MASKED = "[REDACTED]";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/** 値をマスクするキー名。部分一致で判定する */
const SECRET_KEY_PATTERN =
  /(secret|token|password|passwd|credential|private[-_]?key|authorization|cookie|api[-_]?key|session|signature)/i;

/** キー名に関係なく値そのものがシークレットと分かる形式 */
const SECRET_VALUE_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /gh[pousr]_[A-Za-z0-9]{16,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi,
  /\bprivate_[A-Za-z0-9+/]{20,}=*/g,
];

/** 1 つの文字列が丸ごと長大化しないよう切り詰める長さ */
const MAX_STRING_LENGTH = 2000;

function maskString(value: string): string {
  let masked = value;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    masked = masked.replace(pattern, MASKED);
  }

  if (masked.length > MAX_STRING_LENGTH) {
    return `${masked.slice(0, MAX_STRING_LENGTH)}…[truncated]`;
  }

  return masked;
}

function serializeError(error: Error): LogFields {
  const serialized: LogFields = {
    name: error.name,
    message: maskString(error.message),
  };

  if (error.stack) {
    serialized.stack = maskString(error.stack);
  }

  if ("code" in error && typeof error.code === "string") {
    serialized.code = error.code;
  }

  if (error.cause !== undefined) {
    serialized.cause = sanitize(error.cause, new WeakSet());
  }

  return serialized;
}

/**
 * ログに載せる値からシークレットを取り除く。
 *
 * - キー名がシークレットらしいものは値ごとマスクする
 * - 値が秘密鍵やトークンの形式に一致する場合もマスクする
 */
function sanitize(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "string") {
    return maskString(value);
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);

  if (value instanceof Error) {
    return serializeError(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitize(item, seen));
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  const sanitized: LogFields = {};
  for (const [key, child] of Object.entries(value)) {
    sanitized[key] = SECRET_KEY_PATTERN.test(key) ? MASKED : sanitize(child, seen);
  }

  return sanitized;
}

export type LogRecord = {
  level: LogLevel;
  time: string;
  message: string;
} & LogFields;

export type LoggerOptions = {
  /** これより低いレベルは出力しない。既定は本番 `info` / それ以外 `debug` */
  minLevel?: LogLevel;
  /** 全てのログに付与するフィールド */
  bindings?: LogFields;
  /** 出力先。既定は console。テストで差し替える */
  write?: (record: LogRecord) => void;
};

export type Logger = {
  debug: (message: string, fields?: LogFields) => void;
  info: (message: string, fields?: LogFields) => void;
  warn: (message: string, fields?: LogFields) => void;
  error: (message: string, fields?: LogFields) => void;
  /** 固定のフィールドを持つ子ロガーを作る */
  child: (bindings: LogFields) => Logger;
};

function defaultWrite(record: LogRecord): void {
  const line = JSON.stringify(record);
  if (record.level === "error") {
    console.error(line);
    return;
  }
  if (record.level === "warn") {
    console.warn(line);
    return;
  }
  console.log(line);
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const minLevel = options.minLevel ?? (process.env.NODE_ENV === "production" ? "info" : "debug");
  const bindings = options.bindings ?? {};
  const write = options.write ?? defaultWrite;

  const log = (level: LogLevel, message: string, fields: LogFields = {}): void => {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) {
      return;
    }

    const merged = sanitize({ ...bindings, ...fields }, new WeakSet()) as LogFields;

    write({
      level,
      time: new Date().toISOString(),
      message: maskString(message),
      ...merged,
    });
  };

  return {
    debug: (message, fields) => log("debug", message, fields),
    info: (message, fields) => log("info", message, fields),
    warn: (message, fields) => log("warn", message, fields),
    error: (message, fields) => log("error", message, fields),
    child: (childBindings) =>
      createLogger({ ...options, bindings: { ...bindings, ...childBindings } }),
  };
}

export const logger = createLogger();
