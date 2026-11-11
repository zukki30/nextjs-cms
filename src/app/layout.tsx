import type { Metadata } from "next";
import "@zukki30/zukki-design-system/styles.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "nextjs-cms",
  description: "GitHub をストレージとして使うヘッドレス CMS",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
