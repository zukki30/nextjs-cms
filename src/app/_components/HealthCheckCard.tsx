"use client";

import { Button, Card } from "@zukki30/zukki-design-system";
import { useState } from "react";
import styles from "./HealthCheckCard.module.css";

type Result =
  | { status: "idle" }
  | { status: "ok"; body: string }
  | { status: "error"; message: string };

/**
 * `GET /api/health` の疎通をブラウザから確認するカード。
 *
 * デザインシステムのコンポーネントは `createContext` や `useState` を使うため、
 * Server Component からは直接描画できない。**利用側で `"use client"` を付ける。**
 */
export function HealthCheckCard() {
  const [result, setResult] = useState<Result>({ status: "idle" });
  const [loading, setLoading] = useState(false);

  const check = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/health");
      const body = await response.text();
      setResult(
        response.ok
          ? { status: "ok", body: `${response.status} ${body}` }
          : { status: "error", message: `${response.status} ${body}` },
      );
    } catch (error) {
      setResult({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <Card.Header>
        <Card.Title level={2}>API の疎通確認</Card.Title>
      </Card.Header>
      <Card.Body>
        <div className={styles.body}>
          <p className={styles.description}>Hono が `/api` にマウントされているかを確認する。</p>
          <p className={styles.result} aria-live="polite">
            {result.status === "idle" && "未実行"}
            {result.status === "ok" && result.body}
            {result.status === "error" && `失敗: ${result.message}`}
          </p>
        </div>
      </Card.Body>
      <Card.Footer>
        <Button variant="primary" loading={loading} onClick={check}>
          /api/health を呼ぶ
        </Button>
      </Card.Footer>
    </Card>
  );
}
