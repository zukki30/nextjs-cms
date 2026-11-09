import { describe, expect, it } from "vitest";
import { createLogger, type LogRecord, MASKED } from "./logger";

function createCapture() {
  const records: LogRecord[] = [];
  return {
    records,
    write: (record: LogRecord) => {
      records.push(record);
    },
  };
}

describe("createLogger", () => {
  it("level / time / message を含む構造化ログを出力する", () => {
    const capture = createCapture();
    const logger = createLogger({ write: capture.write, minLevel: "debug" });

    logger.info("entry published", { entryId: "abc" });

    expect(capture.records).toHaveLength(1);
    expect(capture.records[0]).toMatchObject({
      level: "info",
      message: "entry published",
      entryId: "abc",
    });
    expect(capture.records[0]?.time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("minLevel より低いレベルは出力しない", () => {
    const capture = createCapture();
    const logger = createLogger({ write: capture.write, minLevel: "warn" });

    logger.debug("debug");
    logger.info("info");
    logger.warn("warn");

    expect(capture.records.map((record) => record.level)).toEqual(["warn"]);
  });

  it("child のフィールドを引き継ぐ", () => {
    const capture = createCapture();
    const logger = createLogger({ write: capture.write, minLevel: "debug" }).child({
      requestId: "r-1",
    });

    logger.info("handled");

    expect(capture.records[0]).toMatchObject({ requestId: "r-1" });
  });
});

describe("シークレットのマスク（NFR-SEC-09）", () => {
  it("シークレットらしいキーの値をマスクする", () => {
    const capture = createCapture();
    const logger = createLogger({ write: capture.write, minLevel: "debug" });

    logger.info("config loaded", {
      authSecret: "super-secret",
      accessToken: "ghp_xxxx",
      password: "p@ssw0rd",
      apiKey: "key",
      authorization: "Bearer abc",
      cookie: "session=1",
      owner: "zukki30",
    });

    expect(capture.records[0]).toMatchObject({
      authSecret: MASKED,
      accessToken: MASKED,
      password: MASKED,
      apiKey: MASKED,
      authorization: MASKED,
      cookie: MASKED,
      owner: "zukki30",
    });
  });

  it("入れ子のオブジェクトと配列もマスクする", () => {
    const capture = createCapture();
    const logger = createLogger({ write: capture.write, minLevel: "debug" });

    logger.info("nested", {
      github: { installationId: 1, privateKey: "-----BEGIN RSA PRIVATE KEY-----" },
      items: [{ token: "t1" }, { token: "t2" }],
    });

    const record = capture.records[0] as unknown as {
      github: { installationId: number; privateKey: string };
      items: { token: string }[];
    };

    expect(record.github.privateKey).toBe(MASKED);
    expect(record.github.installationId).toBe(1);
    expect(record.items.map((item) => item.token)).toEqual([MASKED, MASKED]);
  });

  it("キー名に関係なく秘密鍵やトークンの形式をマスクする", () => {
    const capture = createCapture();
    const logger = createLogger({ write: capture.write, minLevel: "debug" });

    logger.error("github api failed", {
      detail: "received ghp_abcdefghijklmnopqrstuvwxyz0123 from client",
      pem: "-----BEGIN RSA PRIVATE KEY-----\nMIIEow==\n-----END RSA PRIVATE KEY-----",
      header: "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig",
    });

    const record = capture.records[0] as unknown as Record<string, string>;

    expect(record.detail).toBe(`received ${MASKED} from client`);
    expect(record.pem).toBe(MASKED);
    expect(record.header).not.toContain("eyJhbGciOiJIUzI1NiJ9");
  });

  it("メッセージ本文もマスクする", () => {
    const capture = createCapture();
    const logger = createLogger({ write: capture.write, minLevel: "debug" });

    logger.warn("token github_pat_11ABCDEFG0123456789abcdefg is invalid");

    expect(capture.records[0]?.message).toBe(`token ${MASKED} is invalid`);
  });

  it("Error を name / message / stack へ展開する", () => {
    const capture = createCapture();
    const logger = createLogger({ write: capture.write, minLevel: "debug" });

    logger.error("failed", { err: new TypeError("bad input") });

    const record = capture.records[0] as unknown as { err: Record<string, string> };

    expect(record.err.name).toBe("TypeError");
    expect(record.err.message).toBe("bad input");
    expect(record.err.stack).toContain("TypeError: bad input");
  });

  it("循環参照でも落ちない", () => {
    const capture = createCapture();
    const logger = createLogger({ write: capture.write, minLevel: "debug" });

    const circular: Record<string, unknown> = { name: "root" };
    circular.self = circular;

    expect(() => logger.info("circular", { circular })).not.toThrow();
    expect(JSON.stringify(capture.records[0])).toContain("[Circular]");
  });
});
