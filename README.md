# nextjs-cms

GitHub リポジトリ上の Markdown をデータストアとするヘッドレス CMS。管理画面（Admin）と、コンテンツを配信する公開 API を提供する。

対象コンテンツは **News / Blog / FAQ** の3種類。

## 構成

全体は3つのリポジトリで成り立つ。

```
公開サイト（別リポジトリ）
  │  GET /api/v1/*          ← 公開 API だけを参照する
  ▼
nextjs-cms（このリポジトリ）
  ├ /admin        Admin UI
  ├ /api/admin/*  管理 API
  └ /api/v1/*     公開 API
      │ commit / Pull Request（GitHub App）
      ▼
nextjs-cms-content（private・データのみ・デプロイしない）
  └ content/{news,blog,faq}/*.md
```

設計上の中心となる判断は3つ。

| 判断 | 内容 |
| --- | --- |
| 下書きはブランチで表現する | 公開 API は `main` しか読まないため、下書きが公開側へ漏れる経路が構造的に存在しない |
| 書き込み用の資格情報をブラウザに置かない | GitHub OAuth は本人確認のみ。content への書き込みはサーバー側で発行する GitHub App のインストールトークンで行う |
| データとコードを同じリポジトリに置かない | 記事の更新でアプリが再デプロイされない。変更履歴・差分・復元は Git の仕組みをそのまま使う |

## 技術スタック

| 領域 | 採用 |
| --- | --- |
| フレームワーク | Next.js (App Router) / TypeScript |
| API | Hono / Zod |
| 認証 | Auth.js v5（GitHub OAuth・JWT セッション・DB なし） |
| UI | [@zukki30/zukki-design-system](https://github.com/zukki30/zukki-design-system-react) + CSS Modules |
| 画像 | ImageKit |
| 品質 | Biome / Vitest |
| パッケージ管理 | pnpm（バージョンは mise で固定） |

データベースは使用しない。

## 仕様書

[`docs/specs/github-content-cms/`](./docs/specs/github-content-cms/) に spec-driven development の成果物を置いている。

| ファイル | 内容 |
| --- | --- |
| [requirements.md](./docs/specs/github-content-cms/requirements.md) | 機能要件・非機能要件・受け入れ基準 |
| [design.md](./docs/specs/github-content-cms/design.md) | アーキテクチャ・データモデル・API 仕様 |
| [implementation-plan.md](./docs/specs/github-content-cms/implementation-plan.md) | フェーズ分割と各フェーズの完了条件 |

## 進捗

実装は Phase 1〜17 に分割しており、各フェーズを issue として管理している。`phase` ラベルの付いた [issue 一覧](https://github.com/zukki30/nextjs-cms/issues?q=is%3Aissue+label%3Aphase) を参照。

Phase 6（公開 API）の完了が中間マイルストーンで、この時点で「content リポジトリに `.md` を置けば公開 API から取得できる」状態に到達する。

## セットアップ

Phase 1 完了後に記載する（Phase 16 で最終化）。

事前に以下が必要になる。詳細は implementation-plan.md の Phase 0 を参照。

- content リポジトリ（private）
- GitHub OAuth App（ログイン用）
- GitHub App（content への書き込み用。content リポジトリ1つだけにインストールする）
- ImageKit アカウント
- デザインシステムの install 用に `read:packages` を付けた classic PAT

## 参考デザイン

- https://v0-announcement-management-interfac.vercel.app/

画面構成・情報設計の参考として扱う。配色やコンポーネントの見た目はデザインシステムに従う。
