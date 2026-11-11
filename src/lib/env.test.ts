import { afterEach, describe, expect, it } from "vitest";
import { EnvValidationError, getEnv, loadEnv, resetEnvCache } from "./env";

const validGithub = {
  GITHUB_APP_ID: "123456",
  GITHUB_APP_PRIVATE_KEY: "-----BEGIN RSA PRIVATE KEY-----\\nabc\\n-----END RSA PRIVATE KEY-----",
  GITHUB_APP_INSTALLATION_ID: "987654321",
  CONTENT_REPO_OWNER: "zukki30",
  CONTENT_REPO_NAME: "nextjs-cms-content",
};

const validAuth = {
  AUTH_SECRET: "x".repeat(32),
  AUTH_URL: "http://localhost:3000",
  AUTH_GITHUB_ID: "client-id",
  AUTH_GITHUB_SECRET: "client-secret",
  ADMIN_ALLOWED_LOGINS: "zukki30, someone",
};

afterEach(() => {
  resetEnvCache();
});

describe("core", () => {
  it("全て未設定でも既定値で解決する", () => {
    const env = loadEnv("core", {});

    expect(env.NODE_ENV).toBe("development");
    expect(env.PUBLIC_API_ALLOWED_ORIGINS).toEqual(["*"]);
  });

  it("カンマ区切りのオリジンをリストへ変換する", () => {
    const env = loadEnv("core", {
      PUBLIC_API_ALLOWED_ORIGINS: "https://example.com, https://www.example.com",
    });

    expect(env.PUBLIC_API_ALLOWED_ORIGINS).toEqual([
      "https://example.com",
      "https://www.example.com",
    ]);
  });
});

describe("auth", () => {
  it("必要な変数が揃っていれば解決し、許可リストをリストへ変換する", () => {
    const env = loadEnv("auth", validAuth);

    expect(env.ADMIN_ALLOWED_LOGINS).toEqual(["zukki30", "someone"]);
    expect(env.ADMIN_ALLOWED_ORG).toBeUndefined();
  });

  it("AUTH_SECRET が欠けていると失敗する", () => {
    expect(() => loadEnv("auth", { ...validAuth, AUTH_SECRET: undefined })).toThrow(
      EnvValidationError,
    );
  });

  it("空文字は未設定として扱う", () => {
    expect(() => loadEnv("auth", { ...validAuth, AUTH_GITHUB_ID: "" })).toThrow(EnvValidationError);
  });

  it("AUTH_URL が URL でないと失敗する", () => {
    expect(() => loadEnv("auth", { ...validAuth, AUTH_URL: "localhost" })).toThrow(
      EnvValidationError,
    );
  });
});

describe("github", () => {
  it("ID を数値へ、秘密鍵の改行エスケープを実際の改行へ変換する", () => {
    const env = loadEnv("github", validGithub);

    expect(env.GITHUB_APP_ID).toBe(123456);
    expect(env.GITHUB_APP_INSTALLATION_ID).toBe(987654321);
    expect(env.GITHUB_APP_PRIVATE_KEY).toContain("\n");
    expect(env.GITHUB_APP_PRIVATE_KEY).not.toContain("\\n");
    expect(env.CONTENT_REPO_BRANCH).toBe("main");
  });

  it("Base64 で 1 行にまとめた秘密鍵も受け付ける", () => {
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEow==\n-----END RSA PRIVATE KEY-----";
    const env = loadEnv("github", {
      ...validGithub,
      GITHUB_APP_PRIVATE_KEY: Buffer.from(pem, "utf8").toString("base64"),
    });

    expect(env.GITHUB_APP_PRIVATE_KEY).toBe(pem);
  });

  it("秘密鍵が PEM でないと失敗する", () => {
    expect(() =>
      loadEnv("github", { ...validGithub, GITHUB_APP_PRIVATE_KEY: "not-a-key" }),
    ).toThrow(EnvValidationError);
  });

  it("エラーメッセージに値を含めない", () => {
    let message = "";
    try {
      loadEnv("github", { ...validGithub, GITHUB_APP_PRIVATE_KEY: "super-secret-value" });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain("github");
    expect(message).toContain("GITHUB_APP_PRIVATE_KEY");
    expect(message).not.toContain("super-secret-value");
  });
});

describe("グループの独立性", () => {
  it("他グループが未設定でも、使うグループが揃っていれば解決する", () => {
    expect(() => loadEnv("github", validGithub)).not.toThrow();
    expect(() => loadEnv("core", {})).not.toThrow();
  });

  it("使うグループが欠けている場合にだけ失敗する", () => {
    expect(() => loadEnv("imagekit", validGithub)).toThrow(EnvValidationError);
    expect(() => loadEnv("upstash", validGithub)).toThrow(EnvValidationError);
    expect(() => loadEnv("preview", validGithub)).toThrow(EnvValidationError);
    expect(() => loadEnv("webhook", validGithub)).toThrow(EnvValidationError);
  });

  it("EnvValidationError は 500 として扱う", () => {
    try {
      loadEnv("webhook", {});
      expect.unreachable("検証に失敗するはず");
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      expect((error as EnvValidationError).status).toBe(500);
      expect((error as EnvValidationError).group).toBe("webhook");
    }
  });
});

describe("getEnv", () => {
  it("process.env を読み、2 回目以降は同じ結果を返す", () => {
    const first = getEnv("core");
    const second = getEnv("core");

    expect(second).toBe(first);
  });

  it("resetEnvCache でキャッシュを捨てる", () => {
    const first = getEnv("core");
    resetEnvCache("core");

    expect(getEnv("core")).not.toBe(first);
  });
});
