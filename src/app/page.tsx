import { HealthCheckCard } from "./_components/HealthCheckCard";
import styles from "./page.module.css";

export default function Home() {
  return (
    <main className={styles.main}>
      <h1 className={styles.title}>nextjs-cms</h1>
      <p className={styles.lead}>
        GitHub をストレージとして使うヘッドレス CMS。管理画面は Phase 12 以降で追加する。
      </p>
      <HealthCheckCard />
    </main>
  );
}
