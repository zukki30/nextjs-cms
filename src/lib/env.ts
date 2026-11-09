import { z } from "zod";
import { AppError, toErrorDetails } from "./errors";

/**
 * 環境変数の検証。
 *
 * **用途別にグループを分け、実際に使う時点で検証する。**
 * 全変数を起動時に必須検証すると、GitHub App の認証情報が無いだけでアプリが起動しなくなり、
 * 公開 API までの開発が進められなくなるため（design.md 12）。
 *
 * グループは「同時に必要になる変数のまとまり」で切る。たとえば webhook の署名検証は
 * GitHub App の秘密鍵を必要としないため、`github` とは別のグループにしている。
 */

export type EnvSource = Record<string, string | undefined>;

/** カンマ区切りの文字列をリストへ変換する */
const csvList = (defaultValue: string) =>
  z
    .string()
    .default(defaultValue)
    .transform((value) =>
      value
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    );

const PEM_HEADER = "-----BEGIN";

function decodeBase64(value: string): string | undefined {
  try {
    return atob(value);
  } catch {
    return undefined;
  }
}

/**
 * GitHub App の秘密鍵。
 *
 * `.env` に 1 行で収められるよう、次のどちらの形式も受け付ける。
 * - PEM そのもの（改行を `\n` とエスケープしたものを含む）
 * - PEM を Base64 で 1 行にしたもの（`.env.example` が推奨している形式）
 */
const pemPrivateKey = z
  .string()
  .min(1)
  .transform((value) => {
    const unescaped = value.replace(/\\n/g, "\n");
    if (unescaped.includes(PEM_HEADER)) {
      return unescaped;
    }

    const decoded = decodeBase64(unescaped.trim());
    return decoded?.includes(PEM_HEADER) ? decoded : unescaped;
  })
  .refine((value) => value.includes(PEM_HEADER), {
    message: "PEM 形式、またはそれを Base64 にした秘密鍵を指定してください",
  });

/** アプリ全体で使う。既定値があり、未設定でも起動できる */
const coreSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PUBLIC_API_ALLOWED_ORIGINS: csvList("*"),
});

/** ログインと認可（Phase 7） */
const authSchema = z.object({
  AUTH_SECRET: z.string().min(1),
  AUTH_URL: z.url(),
  AUTH_GITHUB_ID: z.string().min(1),
  AUTH_GITHUB_SECRET: z.string().min(1),
  ADMIN_ALLOWED_LOGINS: csvList(""),
  ADMIN_ALLOWED_ORG: z.string().min(1).optional(),
  ADMIN_ALLOWED_ORG_TEAM: z.string().min(1).optional(),
});

/** content リポジトリの読み書き（Phase 3） */
const githubSchema = z.object({
  GITHUB_APP_ID: z.coerce.number().int().positive(),
  GITHUB_APP_PRIVATE_KEY: pemPrivateKey,
  GITHUB_APP_INSTALLATION_ID: z.coerce.number().int().positive(),
  CONTENT_REPO_OWNER: z.string().min(1),
  CONTENT_REPO_NAME: z.string().min(1),
  CONTENT_REPO_BRANCH: z.string().min(1).default("main"),
});

/** Webhook の署名検証（Phase 5）。署名検証に GitHub App の認証情報は要らない */
const webhookSchema = z.object({
  GITHUB_WEBHOOK_SECRET: z.string().min(1),
});

/** 画像（Phase 11） */
const imagekitSchema = z.object({
  IMAGEKIT_PRIVATE_KEY: z.string().min(1),
  IMAGEKIT_FOLDER_PREFIX: z.string().min(1).optional(),
  NEXT_PUBLIC_IMAGEKIT_PUBLIC_KEY: z.string().min(1),
  NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT: z.url(),
});

/** 管理 API と Webhook のレート制限（Phase 15） */
const upstashSchema = z.object({
  UPSTASH_REDIS_REST_URL: z.url(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1),
});

/** 実表示プレビュー（Phase 17） */
const previewSchema = z.object({
  PREVIEW_TOKEN_SECRET: z.string().min(1),
  PUBLIC_SITE_PREVIEW_URL: z.url(),
});

const envSchemas = {
  core: coreSchema,
  auth: authSchema,
  github: githubSchema,
  webhook: webhookSchema,
  imagekit: imagekitSchema,
  upstash: upstashSchema,
  preview: previewSchema,
} as const;

export type EnvGroup = keyof typeof envSchemas;

export type EnvOf<G extends EnvGroup> = z.infer<(typeof envSchemas)[G]>;

/**
 * 検証に失敗した環境変数グループを表すエラー。
 *
 * 変数の**値**はメッセージに含めない（NFR-SEC-09）。
 */
export class EnvValidationError extends AppError {
  readonly group: EnvGroup;

  constructor(group: EnvGroup, error: z.ZodError) {
    const summary = toErrorDetails(error)
      .map((detail) => `${detail.path}: ${detail.message}`)
      .join(", ");

    super("INTERNAL_ERROR", `環境変数グループ "${group}" の設定が不正です (${summary})`, {
      cause: error,
    });
    this.name = "EnvValidationError";
    this.group = group;
  }
}

/**
 * 既定の読み取り元。
 *
 * Next.js はビルド時に `process.env.NEXT_PUBLIC_*` を文字列リテラルへ置換するため、
 * クライアント側でも解決できるよう明示的に参照する。
 */
function defaultSource(): EnvSource {
  return {
    ...process.env,
    NEXT_PUBLIC_IMAGEKIT_PUBLIC_KEY: process.env.NEXT_PUBLIC_IMAGEKIT_PUBLIC_KEY,
    NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT: process.env.NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT,
  };
}

/** 空文字は「未設定」として扱う。`.env` に項目だけ書かれている状態を未設定と見なすため */
function normalize(source: EnvSource): EnvSource {
  const normalized: EnvSource = {};
  for (const [key, value] of Object.entries(source)) {
    normalized[key] = value === "" ? undefined : value;
  }
  return normalized;
}

/**
 * 指定したグループを検証して返す。結果はキャッシュしない。
 *
 * テストから任意の `source` を渡せるようにしてある。
 */
export function loadEnv<G extends EnvGroup>(
  group: G,
  source: EnvSource = defaultSource(),
): EnvOf<G> {
  const result = envSchemas[group].safeParse(normalize(source));

  if (!result.success) {
    throw new EnvValidationError(group, result.error);
  }

  return result.data as EnvOf<G>;
}

const cache = new Map<EnvGroup, unknown>();

/**
 * 指定したグループを `process.env` から検証して返す。
 *
 * 2 回目以降はキャッシュを返す。グループの変数が欠けている場合は、
 * **そのグループを使うこの時点で** 例外になる。
 */
export function getEnv<G extends EnvGroup>(group: G): EnvOf<G> {
  const cached = cache.get(group);
  if (cached !== undefined) {
    return cached as EnvOf<G>;
  }

  const loaded = loadEnv(group);
  cache.set(group, loaded);
  return loaded;
}

/** テスト用。キャッシュを捨てる */
export function resetEnvCache(group?: EnvGroup): void {
  if (group) {
    cache.delete(group);
    return;
  }
  cache.clear();
}
