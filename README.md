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
| 実行環境 | **ローカル実行のみ。デプロイしない**（[requirements.md](./docs/specs/github-content-cms/requirements.md) OPEN-01） |

データベースは使用しない。

デプロイ先は設けない。GitHub Pages は静的ファイルの配信のみでサーバー実行環境が無く、管理 API・認証・Webhook が動かないため使えない。デプロイが必要になった時点で、サーバー実行環境を持つ基盤から選び直す。

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

> Phase 16 で最終化する。現時点では Phase 1（プロジェクト基盤）までの内容。

### 1. ツールチェーン

Node と pnpm のバージョンは [`.mise.toml`](./.mise.toml) で固定している。

```bash
mise install
```

### 2. デザインシステムの認証

`@zukki30/zukki-design-system` は GitHub Packages の **private パッケージ**で、install に認証が要る。
`read:packages` を付けた **classic PAT**（fine-grained token は非対応）を `~/.npmrc` に書く。

```
//npm.pkg.github.com/:_authToken=<TOKEN>
```

スコープとレジストリの対応はリポジトリの [`.npmrc`](./.npmrc) に入っているため、設定は不要。

### 3. 依存のインストールと起動

```bash
pnpm install
cp .env.example .env   # 値は後述
pnpm dev
```

`http://localhost:3000` が開く。`GET /api/health` が `{"status":"ok"}` を返せば起動できている。

### 4. 環境変数

[`.env.example`](./.env.example) をコピーして `.env` を作る。

**用途ごとにグループを分け、実際に使う時点で検証する**（`src/lib/env.ts`）。
そのため、認証情報が空のままでもアプリは起動し、該当の機能を呼んだ時点で初めて失敗する。
Phase 6（公開 API）までは外部サービスをモックするため、Phase 0 が未完でも開発を進められる。

| グループ | 変数 | 必要になるフェーズ |
| --- | --- | --- |
| `core` | `PUBLIC_API_ALLOWED_ORIGINS` | 既定値あり |
| `auth` | `AUTH_*` / `ADMIN_ALLOWED_*` | Phase 7 |
| `github` | `GITHUB_APP_*` / `CONTENT_REPO_*` | Phase 3 |
| `webhook` | `GITHUB_WEBHOOK_SECRET` | Phase 5 |
| `imagekit` | `IMAGEKIT_*` / `NEXT_PUBLIC_IMAGEKIT_*` | Phase 11 |
| `upstash` | `UPSTASH_REDIS_REST_*` | Phase 15 |
| `preview` | `PREVIEW_TOKEN_SECRET` / `PUBLIC_SITE_PREVIEW_URL` | Phase 17 |

`AUTH_SECRET` は `openssl rand -base64 32` で生成する。
外部サービス側の準備（content リポジトリ・GitHub OAuth App・GitHub App・ImageKit）は
implementation-plan.md の Phase 0 を参照。

### 5. スクリプト

| コマンド | 内容 |
| --- | --- |
| `pnpm dev` | 開発サーバー |
| `pnpm build` / `pnpm start` | 本番ビルド / 起動 |
| `pnpm lint` / `pnpm lint:fix` | Biome のチェック / 自動修正 |
| `pnpm format` | Biome のフォーマット |
| `pnpm typecheck` | ルート型の生成 + `tsc --noEmit` |
| `pnpm test` / `pnpm test:watch` | Vitest |

### 6. CI

[`.github/workflows/ci.yml`](./.github/workflows/ci.yml) で `lint` / `typecheck` / `test` を実行する。
デザインシステムを CI から install するため、**パッケージ設定の Manage Actions access に
このリポジトリを `Read` で追加**しておく必要がある。

## 参考デザイン

- https://v0-announcement-management-interfac.vercel.app/

画面構成・情報設計の参考として扱う。配色やコンポーネントの見た目はデザインシステムに従う。
