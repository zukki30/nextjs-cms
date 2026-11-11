# 実装計画書: GitHub ベース ヘッドレス CMS

- spec 名: `github-content-cms`
- 作成日: 2026-10-20
- ステータス: レビュー待ち
- 対応ドキュメント: [requirements.md](./requirements.md) / [design.md](./design.md)

---

## 0. 方針

### 0.1 実装順序の考え方

**下位層から積み上げ、各フェーズ単体でテストできる状態を保つ。**

```
Phase 1  基盤
   ↓
Phase 2  ドメイン層（Zod スキーマ・状態導出）      ← 全フェーズが依存する「正」
   ↓
Phase 3  GitHub 連携層            Phase 4  Markdown 変換
   └──────────┬───────────────────────┘
              ↓
Phase 5  インデックス + キャッシュ + Webhook
              ↓
Phase 6  公開 API  ★ ここで「外部サイトから記事が取得できる」状態に到達
              ↓
Phase 7  認証・認可
              ↓
Phase 8  管理 API（読み取り） → Phase 9（書き込み） → Phase 10（タクソノミー） → Phase 11（画像）
              ↓
Phase 12 Admin UI 基盤 → Phase 13 エディタ → Phase 14 管理画面の残り
              ↓
Phase 15 セキュリティ仕上げ → Phase 16 ドキュメント・総合確認
              ↓
Phase 17 実表示プレビュー（公開サイト構築時。Phase 16 までの完了条件には含まない）
```

Phase 6 の完了時点で「コンテンツを GitHub 上で手で書けば公開 API から取得できる」という**動く状態**に到達する。ここを中間マイルストーンに置き、Admin UI の作業量に引きずられずに配信側の正しさを先に固める。

### 0.2 各フェーズの完了条件

全フェーズ共通で以下を満たすこととする。

1. `npm run lint`（Biome）がエラーなし
2. `npm run typecheck`（`tsc --noEmit`）がエラーなし
3. `npm run test`（Vitest）が全件成功
4. そのフェーズで追加した機能に対応するテストが存在する（正常系 + 異常系）
5. 1フェーズ = 1コミット以上。コミットメッセージは Conventional Commits に従う

### 0.3 新規に決定が必要な事項

2026-11-09 にユーザー承認済み。

| ID | 内容 | 決定 |
| --- | --- | --- |
| **PLAN-D1** | Admin UI のコンポーネント | **`@zukki30/zukki-design-system` を使用する。** 自前のデザインシステムが既に存在し、Button / Input / Select / FormField / Dialog / Card / Tooltip 等を提供している。Dialog があるためフォーカストラップ（NFR-A11Y-02）も満たせる。**shadcn/ui は採用しない**（2つのデザイン体系が混在するため） |
| **PLAN-D2** | アプリ固有レイアウトのスタイリング | **CSS Modules のみ。Tailwind は使わない。** デザインシステムが CSS 変数（`--color-primary-default` 等）でトークンを公開しているため、これを直接参照する。Tailwind を併用するとトークンの尺度が二重化する |
| **PLAN-D3** | デザインシステムに無いコンポーネント（Table / Toast / Combobox / Pagination） | **CMS 内の `src/components/ui/` に実装する。** shadcn/ui の構成を参考にしてよいが、**Tailwind クラスはそのまま持ち込まず CSS Modules に置き換える**（PLAN-D2 と両立しないため）。挙動の土台には shadcn/ui と同じ Radix UI / cmdk を直接使う。要件が固まった段階でデザインシステムへの昇格を検討する |
| ↳ 内訳 | | **Toast** = `@radix-ui/react-toast`（ライブリージョン・タイマー・スタッキング）<br>**Combobox** = `cmdk` + `@radix-ui/react-popover`（ARIA combobox パターン・キーボード操作）<br>**Table** / **Pagination** = プリミティブ不要のため自作 |
| **PLAN-D4** | パッケージマネージャ | **pnpm。** デザインシステム側と揃える。`onlyBuiltDependencies` でビルドスクリプトの許可を明示的に管理できる |
| **PLAN-D5** | Node バージョン管理 | **mise。** `.mise.toml` に node と pnpm を固定する。Volta は使わない |
| **PLAN-D6** | Storybook を導入するか | **本仕様の範囲では導入しない。ただし将来コンポーネント管理のために導入する想定**とし、妨げになる構成を避ける。具体的には、自作する4コンポーネント（Table / Pagination / Toast / Combobox）を **props と CSS Modules のみに依存させ、Next.js 固有の API（`next/navigation`・Server Actions 等）と結合させない**。これにより、必要になった時点で Storybook を追加するだけで済む |
| **PLAN-D7** | 規模の表記 | 各フェーズに S / M / L の相対規模を付す。実時間の見積もりは行わない |

### 0.4 デザインシステムの利用条件

`@zukki30/zukki-design-system` は **GitHub Packages で private 配布**されている。リポジトリ自体は public だが、**install には認証が必要**である点に注意する。

| 場所 | 必要な設定 |
| --- | --- |
| プロジェクト（コミットする） | `.npmrc` に `@zukki30:registry=https://npm.pkg.github.com` |
| ローカル（コミットしない） | `~/.npmrc` に `read:packages` を付けた **classic PAT**（fine-grained token は非対応） |
| GitHub Actions | `actions/setup-node` に `registry-url` と `scope` を指定し `NODE_AUTH_TOKEN` を渡す。加えて**パッケージ設定の Manage Actions access で `nextjs-cms` を Read 追加**する |

本仕様ではデプロイしない（requirements.md OPEN-01）ため、設定箇所はローカルと CI の2つだけになる。将来デプロイする場合は、その基盤でも同等のレジストリ設定が必要になる。

---

## Phase 0: 事前セットアップ（ユーザー作業）

実装着手前に、ユーザー側で以下を用意する必要がある。**Claude Code では代行できない作業**のため、先に完了をお願いしたい。

| # | 作業 | 取得する値 |
| --- | --- | --- |
| 0-1 | content リポジトリを **private** で新規作成（例: `zukki30/nextjs-cms-content`）。`content/.gitkeep` だけ置いて初期化 | `CONTENT_REPO_OWNER` / `CONTENT_REPO_NAME` |
| 0-2 | GitHub OAuth App を作成。Callback URL: `http://localhost:3000/api/auth/callback/github`（本番用は別途） | `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` |
| 0-3 | GitHub App を作成。権限は `Contents: R/W` / `Pull requests: R/W` / `Metadata: R` のみ。Webhook イベントは `push` のみ。秘密鍵を生成 | `GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY` / `GITHUB_WEBHOOK_SECRET` |
| 0-4 | 上記 GitHub App を **content リポジトリ1つだけ**にインストール（"All repositories" は選ばない） | `GITHUB_APP_INSTALLATION_ID` |
| 0-5 | ImageKit の無料アカウントを作成。**Restricted key**（Media Management: Read and write / Account Management: None）を1本発行し、public key と URL endpoint を控える | `IMAGEKIT_PUBLIC_KEY` / `IMAGEKIT_PRIVATE_KEY` / `IMAGEKIT_URL_ENDPOINT` |
| 0-6 | Upstash の無料アカウントを作成し Redis データベースを1つ作成（OPEN-D1）。**Phase 15 まで使わないので後回しで可** | `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` |
| 0-7 | `AUTH_SECRET` を生成（`openssl rand -base64 32`）。**書き込み先の `.env` が無いため Phase 1-11 に繰り込む。** デプロイする場合は別の値を生成し、その基盤の環境変数に設定する | `AUTH_SECRET` |

> Phase 1〜5 のテストは外部サービスをモックするため、**Phase 0 が未完でも Phase 6 まで実装・テストは進められる**。実際に GitHub へ繋いだ疎通確認が必要になるのは Phase 5 の末尾以降。

---

## Phase 1: プロジェクト基盤 【規模: M】

### 目的
Next.js アプリの土台と、以降のフェーズ全てが前提とする開発基盤を整える。

### 作業
| # | 内容 |
| --- | --- |
| 1-1 | `create-next-app` で App Router / TypeScript 構成を初期化（`src/` ディレクトリ利用、Turbopack）。**Tailwind は入れない**（PLAN-D2） |
| 1-2 | `.mise.toml` に node と pnpm を固定（PLAN-D5）。デザインシステム側のバージョンに揃える |
| 1-3 | **pnpm へ移行**（PLAN-D4）。`package-lock.json` を削除し `pnpm-lock.yaml` を生成。`onlyBuiltDependencies` に esbuild 等を明示 |
| 1-4 | `.npmrc` に `@zukki30:registry=https://npm.pkg.github.com` を記載（0.4） |
| 1-5 | `@zukki30/zukki-design-system` を導入し、ルートレイアウトで `styles.css` を読み込む（PLAN-D1） |
| 1-6 | Biome を導入（`biome.json`）。`lint` / `format` スクリプトを定義 |
| 1-7 | `tsconfig.json` を `strict: true` + `noUncheckedIndexedAccess: true` に設定。`typecheck` スクリプトを定義 |
| 1-8 | Vitest を導入（`vitest.config.ts`）。`test` / `test:watch` を定義。**vitest 5 系を使う**（3系は tinypool / @vitest/mocker に critical の脆弱性あり） |
| 1-9 | Hono を導入し `src/app/api/[[...route]]/route.ts` にマウント。`src/server/app.ts` にインスタンスを置く |
| 1-10 | `src/lib/env.ts` に Zod による環境変数検証を実装。**用途別（core / github / imagekit / upstash）にグループ分けし、実際に使う時点で検証する**。認証情報が無くてもアプリは起動できること |
| 1-11 | `src/lib/errors.ts` にアプリ共通のエラー型（`AppError` / `code` / HTTP ステータス対応）を定義 |
| 1-12 | `src/lib/logger.ts` に構造化ログを実装。シークレットをマスクする（NFR-SEC-09） |
| 1-13 | `src/server/middleware/errorHandler.ts` でエラーを design.md 9.4 の形式に変換 |
| 1-14 | `.env.example` を design.md 13章の内容で作成。併せて `.env` を作り、`AUTH_SECRET` をここで生成して書き込む（0-7） |
| 1-15 | `.github/workflows/ci.yml` で lint / typecheck / test を実行。**`actions/setup-node` に `node-version-file: .mise.toml` / `registry-url` / `scope` を指定し `NODE_AUTH_TOKEN` を渡す**（0.4） |

### 完了条件
- `pnpm dev` でアプリが起動し、`GET /api/health` が 200 を返す
- **認証情報が未設定の `.env` でもアプリが起動すること**（env の遅延検証が効いていること）
- `env.ts` のテスト: 必要なグループの変数が欠けていると、そのグループを使う時点で失敗すること
- `errorHandler` のテスト: `AppError` が規定の JSON とステータスに変換されること
- デザインシステムのコンポーネントが描画でき、CSS 変数が適用されていること
- `pnpm audit` に high 以上の指摘がないこと
- CI が GitHub 上で成功する（デザインシステムの install を含む）

### 対応要件
NFR-QA-01, NFR-QA-02, NFR-SEC-07, NFR-SEC-09

---

## Phase 2: ドメイン層 【規模: S】

### 目的
以降の全フェーズが参照する「唯一の正」であるスキーマと、状態導出ロジックを確定させる。

### 作業
| # | ファイル | 内容 |
| --- | --- | --- |
| 2-1 | `src/domain/schema/common.ts` | `ulid` / `slug` / `isoDateTime` / `entryStatus` / `imageRef` |
| 2-2 | `src/domain/schema/entry.ts` | `newsFrontmatter` / `blogFrontmatter` / `faqFrontmatter` / `frontmatterByType` |
| 2-3 | `src/domain/schema/taxonomy.ts` | タクソノミーの frontmatter スキーマ |
| 2-4 | `src/domain/schema/api.ts` | 公開 API のクエリパラメータスキーマ（`format` / `page` / `perPage` / `sort` / `category` / `tag` / `q`） |
| 2-5 | `src/domain/status.ts` | design.md 2.5 の状態導出（`deriveStatus`）。現在時刻を引数で注入可能にする |
| 2-6 | `src/domain/paths.ts` | `content/<type>/<slug>.md` / `_taxonomies/...` のパス生成とパースを一箇所に集約 |
| 2-7 | `src/domain/frontmatter.ts` | gray-matter による読み書きラッパ。書き出し時のキー順を固定し、無関係な差分が出ないようにする |
| 2-8 | `src/domain/id.ts` | ULID 生成（`ulid` パッケージ） |

### 完了条件
- スキーマのテスト: 正常系 / 必須項目欠落 / 不正な slug（大文字・記号・先頭ハイフン）/ 不正な日時 / 未知の `status`
- `deriveStatus` のテスト: main の有無 × `status` × `publishedAt`（過去/未来）× 下書きブランチの有無の全組み合わせ
- `paths.ts` のテスト: 生成 → パースで元に戻ること（round-trip）
- `frontmatter.ts` のテスト: 読み書き往復で内容が変化しないこと、キー順が固定されること

### 対応要件
FR-DATA-01〜08, FR-CONTENT-07, FR-CONTENT-10

---

## Phase 3: GitHub 連携層 【規模: L】

### 目的
design.md 4章の `ContentRepository` を実装し、テスト用のインメモリ実装を揃える。以降のフェーズはこの interface しか触らない。

### 作業
| # | ファイル | 内容 |
| --- | --- | --- |
| 3-1 | `src/content/github/client.ts` | `@octokit/auth-app` でインストールトークンを発行。メモリに最長 55 分キャッシュし、期限前に再発行 |
| 3-2 | `src/content/github/repository.ts` | `ContentRepository` の GitHub 実装（読み取り） |
| 3-3 | 同上 | `getTree` / `getFile` / `getFiles`（GraphQL エイリアスで 50 件ずつ分割）/ `getHeadSha` |
| 3-4 | 同上 | `commit`: blob → tree（`base_tree` 付き、削除は `sha: null`）→ commit → `PATCH ref { force: false }` |
| 3-5 | 同上 | 非 fast-forward の 422 を `ConflictError` に変換（design.md 4.3） |
| 3-6 | 同上 | `createBranch` / `deleteBranch` |
| 3-7 | `src/content/github/pulls.ts` | `findOpenPr` / `listOpenPrs` / `createPr` / `mergePr(squash)` / `closePr` |
| 3-8 | `src/content/github/pr-meta.ts` | PR 本文の `cms:meta` ブロックの生成とパース。壊れていてもブランチ名から縮退復元する |
| 3-9 | `src/content/github/in-memory.ts` | テスト用のインメモリ実装。ref 移動による競合を再現できること |

### 完了条件
- インメモリ実装に対する契約テスト（同じテストを GitHub 実装でも流せる構造にする）
- 楽観ロックのテスト: `baseSha` が古い状態で `commit` すると `ConflictError` になり、内容が上書きされないこと
- 複数ファイルの変更が1コミットになること、削除が反映されること
- リネーム（旧パス削除 + 新パス作成）が1コミットになること
- `getFiles` が 120 件のパスに対して 3 クエリに分割されること
- `pr-meta` のテスト: 生成 → パース往復、`cms:meta` 欠損時の縮退

### 対応要件
FR-AUTH-07, FR-DRAFT-01〜03, 06, 08, NFR-SEC-01, NFR-SEC-02, NFR-SEC-04, NFR-QA-04

---

## Phase 4: Markdown 変換パイプライン 【規模: M】

### 目的
design.md 7章のパイプラインを実装する。公開 API・エディタプレビュー・下書きプレビューが共有する単一実装。

### 作業
| # | ファイル | 内容 |
| --- | --- | --- |
| 4-1 | `src/content/markdown/sanitize-schema.ts` | `defaultSchema` を基に design.md 7.2 の調整を加えたスキーマ |
| 4-2 | `src/content/markdown/plugins/imagekit-image.ts` | ImageKit URL のパス変換 `/tr:w-…,h-…/` を解析し `width`/`height`/`loading`/`decoding` を補完 |
| 4-3 | `src/content/markdown/plugins/collect-toc.ts` | h2/h3 を収集して目次を返す |
| 4-4 | `src/content/markdown/render.ts` | unified パイプラインを組み立て `{ html, toc }` を返す。**プラグイン順序を design.md 7.1 の通りに固定し、順序の理由をコメントで残す** |
| 4-5 | `src/content/markdown/headings.ts` | インデックスの `searchText` 用に見出しテキストだけを抽出する軽量関数 |

### 完了条件
- XSS テスト: `<script>alert(1)</script>` / `<img onerror=...>` / `<a href="javascript:...">` / `<iframe>` / `data:` URL がいずれも除去されること
- `rehype-raw` → `rehype-sanitize` の順序が守られていることを担保するテスト（生 HTML が素通りしないこと）
- コードブロックにハイライト用のマークアップが付与され、かつサニタイズで消えていないこと
- 見出しに `id` が付与され、`toc` が正しい階層で返ること
- ImageKit URL の画像に `width`/`height`/`loading="lazy"` が付くこと。ImageKit 以外のホストでは付与しないこと。`tr:` が無い URL では寸法を付けないこと
- GFM の表・タスクリストが変換されること

### 対応要件
FR-MD-01〜05, FR-API-07, NFR-SEC-06

---

## Phase 5: インデックス・キャッシュ・Webhook 【規模: M】

### 目的
公開 API が GitHub を毎回叩かずに応答できる土台を作る。

### 作業
| # | ファイル | 内容 |
| --- | --- | --- |
| 5-1 | `src/content/index/build.ts` | design.md 6.2 の構築手順。frontmatter が不正なエントリは除外してログに警告を出し、全体を壊さない |
| 5-2 | `src/content/index/cache.ts` | `unstable_cache` でのラップ（タグ `content`、`revalidate: 600`） |
| 5-3 | `src/content/index/query.ts` | インデックスに対する絞り込み・ソート・ページネーション。**公開判定（`status` / `publishedAt`）はここで毎回評価する**（design.md 6.4）。現在時刻を注入可能にする |
| 5-4 | `src/content/entry.ts` | 単一エントリの取得 + 変換 + キャッシュ（タグ `entry:<type>:<slug>`） |
| 5-5 | `src/server/routes/webhook.ts` | `POST /api/webhooks/github`。HMAC-SHA256 をタイミング安全比較で検証、`push` かつ `refs/heads/main` 以外は 204 で無視、変更パスから `revalidateTag` を実行 |

### 完了条件
- 構築テスト: 一部エントリの frontmatter が不正でも他が生き残り、警告が記録されること
- `getFiles` の呼び出し回数テスト: 1,000 件で 25 回以内（NFR-PERF-02b）
- クエリテスト: `category` 複数指定が OR、`tag` との併用が AND、`q` の部分一致（大文字小文字・全半角正規化）、ソート全パターン、`page=0` / `perPage=101` が 400 になること
- 公開判定テスト: `publishedAt` が未来のエントリが時刻到来前は返らず、注入時刻を進めると返ること。`archived` が返らないこと
- Webhook テスト: 署名不正で 401、`main` 以外の ref を無視、正常時に対象タグが破棄されること
- **ここで初回の実疎通確認**: content リポジトリにサンプル `.md` を手で置き、インデックスが構築できること（Phase 0 完了が前提）

> **Webhook の実疎通はローカル実行では成立しない。** デプロイしない方針（requirements.md OPEN-01）のため、GitHub から `localhost` へは届かない。
> 実装と単体テストは署名付きリクエストを自前で組んで検証する（NFR-QA-04）。実際に GitHub から受け取る確認が必要な場合は、`gh webhook forward` などのトンネルで一時的に転送する。
> **Webhook が届かない間もキャッシュは `revalidate: 600` のフォールバックで回復する**（FR-CACHE-06）ため、機能としては成立する。

### 対応要件
FR-CACHE-01〜08, FR-API-04, FR-CONTENT-09, NFR-PERF-01〜02b

---

## Phase 6: 公開 API 【規模: M】 ★中間マイルストーン

### 目的
外部サイトからコンテンツを取得できる状態にする。

### 作業
| # | ファイル | 内容 |
| --- | --- | --- |
| 6-1 | `src/server/routes/public.ts` | `GET /api/v1/{type}`（一覧。本文を含めない） |
| 6-2 | 同上 | `GET /api/v1/{type}/{slugOrId}`（詳細。`format=html\|markdown\|both`） |
| 6-3 | 同上 | `GET /api/v1/{type}/categories` / `tags`（公開済み件数付き） |
| 6-4 | `src/server/middleware/cors.ts` | `PUBLIC_API_ALLOWED_ORIGINS` に基づく CORS。`GET` / `OPTIONS` のみ |
| 6-5 | `src/server/routes/public.ts` | `Cache-Control: public, s-maxage=60, stale-while-revalidate=300`。**400 / 404 にも同じヘッダを付ける** |
| 6-6 | `src/server/query-canonicalize.ts` | design.md 9.6 のクエリ正規化。未知パラメータの削除、`perPage` の離散化、`page` 上限、`category`/`tag` の実在検証と重複除去・ソート、`sort` の allowlist、`q` の NFKC 正規化と 64 文字切り詰め |
| 6-7 | `docs/api.md` | 公開 API のリファレンス（利用側向け） |

### 完了条件
- 一覧・詳細・タクソノミー一覧の統合テスト（インメモリ `ContentRepository` 上）
- `format` 3種のレスポンス形状テスト。`markdown` に HTML が含まれないこと、`html` に Markdown 原文が含まれないこと
- slug / ID の両方で詳細が引けること（FR-API-03）
- 下書き・`archived`・公開予約中が一覧・詳細のいずれからも取得できないこと（**受け入れ基準 3**）
- 存在しない `type` / `slug` で 404、不正クエリで 400（`details` 付き）
- CORS ヘッダとキャッシュヘッダが付与されること。**400 / 404 にもキャッシュヘッダが付くこと**
- 書き込み系メソッド（POST/PUT/DELETE）が `/api/v1` で 405 になること
- **クエリ正規化のテスト（NFR-SEC-05b）**: 未知パラメータが無視されること、`?tag=b&tag=a` と `?tag=a&tag=b` が同一結果になること、`perPage=33` が 400、総ページ数を超える `page` が 400、存在しない `category` が 400、`q` が 64 文字に切り詰められ 1 文字では 400 になること

### 対応要件
FR-API-01〜09, FR-CONTENT-08

---

## Phase 7: 認証・認可 【規模: M】

### 目的
Admin を許可されたユーザーだけに限定する。

### 作業
| # | ファイル | 内容 |
| --- | --- | --- |
| 7-1 | `src/auth/config.ts` | Auth.js v5。GitHub プロバイダ、`strategy: 'jwt'`、アダプタなし、`maxAge: 8h` |
| 7-2 | `src/auth/allowlist.ts` | `ADMIN_ALLOWED_LOGINS` / `ADMIN_ALLOWED_ORG` / `ADMIN_ALLOWED_ORG_TEAM` による判定。**既定は拒否** |
| 7-3 | `src/auth/config.ts` | `jwt` コールバックで OAuth アクセストークンを載せない。GitHub user ID (`sub`) を保持 |
| 7-4 | `src/app/api/auth/[...nextauth]/route.ts` | Auth.js のハンドラ |
| 7-5 | `src/middleware.ts` | `/admin` 配下の未認証アクセスを `/admin/login` へリダイレクト |
| 7-6 | `src/server/middleware/session.ts` | `/api/admin` 配下のセッション検証。未認証 401 / 許可外 403 |
| 7-7 | `src/server/middleware/csrf.ts` | 状態変更リクエストの `Origin` と `Sec-Fetch-Site` 検証 |
| 7-8 | `src/auth/commit-author.ts` | セッションからコミット author を組み立てる（メール未公開時は `<login>@users.noreply.github.com`） |

### 完了条件
- 許可判定テスト: allowlist 内 / 外、Org メンバー / 非メンバー、Team 指定時のメンバー / 非メンバー、allowlist が空のとき全拒否
- OAuth アクセストークンがセッション JWT に含まれないことのテスト（**NFR-SEC-01 の要**）
- セッション期限切れで 401 になること
- CSRF テスト: `Origin` 不一致、`Sec-Fetch-Site: cross-site` が拒否されること。`GET` は通ること
- ログイン拒否がログに記録され、かつトークンがログに出ないこと
- 実疎通確認: 許可ユーザーでログインでき、許可外ユーザーが拒否されること（**受け入れ基準 1**）

### 対応要件
FR-AUTH-01〜07, NFR-SEC-03, NFR-SEC-09

---

## Phase 8: 管理 API（読み取り） 【規模: S】

### 目的
Admin が一覧・編集対象を取得できるようにする。

### 作業
| # | 内容 |
| --- | --- |
| 8-1 | `GET /api/admin/drafts`: オープン PR を `draft/` 接頭辞で抽出し、`cms:meta` を復元して返す |
| 8-2 | `GET /api/admin/{type}`: main のインデックスとオープン PR を突き合わせ、`deriveStatus` で状態を付与して返す |
| 8-3 | 同上: 状態フィルタ・ソート・タイトル検索 |
| 8-4 | `GET /api/admin/{type}/{id}`: 下書きがあれば下書きブランチの内容を優先し、`headSha` を併せて返す |
| 8-5 | `POST /api/admin/render`: Phase 4 の `render` を呼ぶプレビュー描画 |

### 完了条件
- 一覧テスト: design.md 2.5 の6パターンが期待どおりの状態文字列で返ること
- 下書きがある場合に下書きの内容が返り、`headSha` が下書きブランチの head であること
- `render` が Phase 4 と同一の出力を返すこと（同一関数を呼んでいることの担保）

### 対応要件
FR-CONTENT-01, 02, FR-DRAFT-04, FR-CONTENT-04

---

## Phase 9: 管理 API（書き込み） 【規模: L】

### 目的
下書き → 公開のライフサイクルを完成させる。本仕様で最も中核となるフェーズ。

### 作業
| # | 内容 | 要件 |
| --- | --- | --- |
| 9-1 | `src/content/draft.ts`: ブランチ名・PR タイトル・PR 本文の生成を集約 | - |
| 9-2 | `POST /api/admin/{type}`: Zod 検証 → ULID 発番 → slug 重複チェック（main ∪ 下書き）→ ブランチ作成 → commit → Draft PR 作成 | FR-DRAFT-01, 03 |
| 9-3 | `PUT /api/admin/{type}/{id}`: `headSha` 必須。既存下書きブランチへ commit。slug 変更時は旧パス削除を同一コミットに含める。PR 本文を更新 | FR-DRAFT-02, 09 |
| 9-4 | `POST /api/admin/{type}/{id}/publish`: `mergeable_state` を確認し競合なら 409、問題なければ squash merge → ブランチ削除 | FR-DRAFT-06, 07 |
| 9-5 | `POST /api/admin/{type}/{id}/discard`: PR クローズ → ブランチ削除 | FR-DRAFT-08 |
| 9-6 | `DELETE /api/admin/{type}/{id}`: 削除コミットの PR を作成 | FR-CONTENT-05 |
| 9-7 | `POST /api/admin/{type}/{id}/archive`: `status: archived` への変更 PR を作成 | FR-CONTENT-06 |
| 9-8 | 409 / 422 のエラー整形（フィールド単位の `details`） | FR-CONTENT-10 |

### 完了条件
- 新規作成 → 下書き保存 → 公開 の一連がインメモリ実装上で完走すること
- slug 重複が 409 になること（main 側・下書き側の双方で検出）
- slug 変更が1コミットのリネームになり、ID が変わらないこと
- 競合テスト: 古い `headSha` での保存が 409 になり、既存の内容が保持されること（**受け入れ基準 8**）
- `mergeable_state` が `dirty` のとき公開が実行されず 409 になること
- 削除が削除コミットの PR になること。マージ後に公開 API から消えること
- 非公開化でファイルが残り、公開 API から消えること
- 全書き込み操作でコミット author がログインユーザーになっていること

### 対応要件
FR-CONTENT-03〜10, FR-DRAFT-01〜03, 06〜09, NFR-SEC-04

---

## Phase 10: タクソノミー 【規模: M】

### 作業
| # | 内容 |
| --- | --- |
| 10-1 | `GET /api/admin/{type}/taxonomies`: main 上のタクソノミー ∪ 指定下書きブランチ上のタクソノミー（FR-TAXO-04） |
| 10-2 | `POST /api/admin/{type}/taxonomies/{kind}`: エントリ編集中はそのエントリの下書きブランチへコミット |
| 10-3 | 同上: タクソノミー管理画面からの場合は `draft/taxonomy/{type}` ブランチ + PR |
| 10-4 | `PUT` / `DELETE`: 編集・削除。削除時はインデックスを走査して使用中のエントリを検出し、あれば 409 + 参照一覧 |
| 10-5 | エントリ保存時に、存在しないタクソノミー slug が指定されていたら 422 |

### 完了条件
- 下書きブランチで作成したカテゴリーが、そのエントリの保存時に同一コミットに含まれること
- 選択候補が main ∪ 下書きの合併になること
- 使用中のカテゴリー削除が 409 になり、参照エントリの一覧が返ること
- マージ後、公開 API のカテゴリー一覧に件数付きで現れること（**受け入れ基準 4**）
- FAQ に対するタクソノミー API が 404 / 400 になること（FR-TAXO-07）

### 対応要件
FR-TAXO-01〜07, FR-API-05

---

## Phase 11: 画像（ImageKit） 【規模: M】

> **着手時にやること**
> 1. ImageKit Upload API V2 には公式 SDK がないため、最新ドキュメントでエンドポイント URL と JWT ペイロードの仕様（必須クレーム、値がすべて文字列である制約、ヘッダの `kid` など）を確認してから実装する
> 2. **V1（token + expire + signature）は使わない** — 署名が `folder` / `fileName` を束縛せず FR-IMG-02 を満たせないため
> 3. **Restricted key で Upload V2 の JWT 検証が通るかを最初に実地確認する**（design.md 8.1 の未確認事項）。拒否される場合のみ Standard key へ切り替える

### 作業
| # | ファイル | 内容 |
| --- | --- | --- |
| 11-1 | `src/media/token.ts` | `jose` で Upload V2 用 JWT を生成。ペイロードに `fileName` / `folder` / `useUniqueFileName` 等を含め、全体を署名で束縛する |
| 11-2 | `POST /api/admin/uploads/token` | 拡張子・MIME・サイズをサーバー側検証（SVG 不許可 / 最大 5MB）。`folder` は `/<IMAGEKIT_FOLDER_PREFIX>/<type>/<entryId>`（prefix 未設定時は `/<type>/<entryId>`）。`{ token, publicKey, uploadPayload }` を返す |
| 11-3 | `GET /api/admin/uploads` | `GET https://api.imagekit.io/v1/files`（private key の Basic 認証）。private key はクライアントに出さない |
| 11-4 | `DELETE /api/admin/uploads/{fileId}` | 事前にインデックスを走査して `fileId` の参照を検出。あれば 409 + 参照一覧、`?force=true` で `DELETE https://api.imagekit.io/v1/files/{fileId}` |
| 11-5 | `src/media/in-memory.ts` | テスト用実装 |
| 11-6 | ImageKit 管理画面 | Path policy を設定し、フォルダ外への書き込みをサービス側でも遮断（任意・推奨） |

### 完了条件
- JWT テスト: ペイロードがサーバー側で決定した `folder` / `fileName` と一致すること。クライアントが渡した値をそのまま信用していないこと
- 不許可形式（SVG / PDF）とサイズ超過（5MB 超）が 400 で拒否されること
- 参照されている画像の削除が 409 になり、`force=true` で削除できること
- private key がレスポンス・クライアントバンドルに一切含まれないこと
- `NEXT_PUBLIC_` 接頭辞が付くのは public key と URL endpoint のみであること
- `IMAGEKIT_FOLDER_PREFIX` の有無で保管フォルダが `/<prefix>/<type>/<id>/` と `/<type>/<id>/` に切り替わること（FR-IMG-08）

### 対応要件
FR-IMG-01〜07

---

## Phase 12: Admin UI 基盤 【規模: M】

### 作業
| # | 内容 |
| --- | --- |
| 12-1 | `/admin` のレイアウト（サイドナビ: ダッシュボード / News / Blog / FAQ / メディア） |
| 12-2 | `/admin/login`: GitHub でログイン。拒否時のエラー表示 |
| 12-3 | `/admin`: ダッシュボード（下書き一覧・最近の更新） |
| 12-4 | `/admin/{type}`: エントリ一覧（状態バッジ・フィルタ・ソート・検索・PR へのリンク） |
| 12-5 | デザインシステムに無いコンポーネントを `src/components/ui/` に実装（PLAN-D3）<br>・`Table`（自作）<br>・`Pagination`（自作）<br>・`Toast`（`@radix-ui/react-toast`。`role="status"` / `role="alert"`）<br>・`Combobox`（`cmdk` + `@radix-ui/react-popover`。Phase 13 で使用） |
| 12-6 | 状態バッジはデザインシステムの `Tag`、確認ダイアログは `Dialog` を使う（自作しない） |
| 12-7 | レイアウト（サイドバー・一覧・ツールバー）を CSS Modules で実装し、色・間隔はデザインシステムの CSS 変数を参照する。独自の色値・間隔値を定義しない |
| 12-8 | 12-5 の4コンポーネントは **props と CSS Modules のみに依存させ、Next.js 固有の API（`next/navigation`・Server Actions 等）と結合させない**（PLAN-D6。将来 Storybook を追加できる状態を保つため） |

### 完了条件
- 未認証で `/admin` にアクセスするとログインへリダイレクトされること
- 一覧で6種の状態が区別して表示されること
- キーボードのみでナビゲーション・一覧操作ができること
- トーストがスクリーンリーダーに通知されること

### 対応要件
FR-AUTH-01, 02, 06, FR-CONTENT-01, 02, FR-DRAFT-04, NFR-A11Y-01〜04

---

## Phase 13: エディタ 【規模: L】

### 作業
| # | 内容 |
| --- | --- |
| 13-0 | フォーム要素はデザインシステムの `FormField` / `Input` / `TextArea` / `Select` / `Checkbox` / `Switch` を使う。ラベルとエラーの関連付け（NFR-A11Y-01）は `FormField` が担う |
| 13-1 | `@uiw/react-codemirror` + `@codemirror/lang-markdown` による Markdown エディタ。テーマはデザインシステムの CSS 変数に合わせる |
| 13-2 | プレビュー: 500ms デバウンスで `POST /api/admin/render`（**サーバー描画**） |
| 13-3 | メタデータフォーム: タイトル / slug / 公開日時 / カテゴリー / タグ / 抜粋 / アイキャッチ |
| 13-4 | slug の自動生成（タイトルから）と手動編集。重複時のエラー表示 |
| 13-5 | カテゴリー・タグのコンボボックス（その場で新規作成可能、FR-TAXO-03） |
| 13-6 | メディアピッカー: アップロード + 既存画像から選択。挿入時に `w_`/`h_` 付き URL を使う |
| 13-7 | アクションバー: 下書き保存 / プレビュー / 公開 / 破棄。公開前に確認ダイアログ |
| 13-8 | 409 競合時の表示（「他の場所で更新されています」+ 再読み込み・PR 確認の導線） |
| 13-9 | 422 のフィールド単位エラー表示（`aria-describedby` で関連付け） |
| 13-10 | 未保存離脱の警告 |
| 13-11 | `/admin/preview/{type}/{id}`: 下書きブランチ内容の**本文プレビュー**（認証必須・design.md 5.7.1）。公開サイトの CSS は反映されない。実表示プレビューは Phase 17 |

### 完了条件
- News / Blog / FAQ それぞれで 作成 → 下書き保存 → プレビュー → 公開 → 公開 API 取得 が完走すること（**受け入れ基準 2**）
- プレビューの出力と `format=html` の出力が一致すること（**受け入れ基準 9**）
- 画像をアップロードしてアイキャッチに設定し、公開 API のレスポンスに URL が含まれること（**受け入れ基準 5**）
- キーボードのみで作成・編集・下書き保存・公開を完了できること（NFR-A11Y-02）
- エディタに `<script>` を書いてもプレビュー・公開 HTML から除去されていること（**受け入れ基準 10**）

### 対応要件
FR-CONTENT-04, 10, FR-DRAFT-05, FR-TAXO-03, FR-IMG-04, FR-MD-01, NFR-A11Y-01〜03

---

## Phase 14: 管理画面の残り 【規模: M】

### 作業
| # | 内容 |
| --- | --- |
| 14-1 | `/admin/{type}/taxonomies`: カテゴリー・タグの一覧・作成・編集・削除。使用中の警告表示 |
| 14-2 | `/admin/media`: 画像一覧・検索・アップロード・削除。参照中の警告表示 |
| 14-3 | 削除・非公開化の UI（確認ダイアログ付き） |
| 14-4 | 公開予約の UI（公開日時が未来の場合の明示） |

### 完了条件
- 公開日時を未来に設定したエントリが、その時刻まで公開 API から取得できないこと（**受け入れ基準 6**）
- 使用中のカテゴリー・画像の削除で警告が出ること

### 対応要件
FR-TAXO-01, 02, 05, FR-IMG-04, 05, FR-CONTENT-05, 06, 09

---

## Phase 15: セキュリティ仕上げ 【規模: M】

### 作業
| # | 内容 |
| --- | --- |
| 15-1 | `next.config.ts` にセキュリティヘッダ: CSP（`script-src 'self'`、`img-src` に `ik.imagekit.io`、`connect-src` に `upload.imagekit.io`）、`X-Frame-Options: DENY`、`Referrer-Policy`、`X-Content-Type-Options` |
| 15-2 | `src/server/middleware/rateLimit.ts`: `@upstash/ratelimit` で **管理 API と Webhook のみ**に上限を設定。公開 API には適用しない（design.md 3.5 / 9.6） |
| 15-3 | 公開 API に、関数インスタンス内メモリによる best-effort な上限を補助として入れる（主たる防御はクエリ正規化） |
| 15-4 | **ローカル実行のみのため本フェーズでは対象外**（requirements.md OPEN-01）。デプロイする場合に支出上限を設定する（NFR-SEC-05c）。判断の経緯と、デプロイ時に必要な設定を `docs/operations.md` に記載しておく |
| 15-5 | ログ出力の監査: シークレット・トークン・Cookie が出力されないことを確認 |
| 15-6 | `.env` が `.gitignore` されていることの確認。コミット済みシークレットがないことの確認 |
| 15-7 | 依存パッケージの脆弱性チェック（`npm audit`） |
| 15-8 | `/code-review` および `/security-review` の実行と指摘対応 |

### 完了条件
- CSP 配下で Admin が正常に動作すること（インラインスクリプトの排除）
- 管理 API・Webhook でレート制限超過時に 429 + `RATE_LIMITED` が返ること
- 公開 API への大量アクセスで Upstash のコマンドが消費されないこと（公開 API 経路に Redis 呼び出しが存在しないことをテストで担保）
- デプロイ時に必要な設定（支出上限・攻撃対策モード）が `docs/operations.md` に記載されていること
- `npm audit` に high 以上の指摘がないこと

### 対応要件
NFR-SEC-05, NFR-SEC-07〜09

---

## Phase 16: ドキュメントと総合確認 【規模: S】

### 作業
| # | 内容 |
| --- | --- |
| 16-1 | `README.md` を全面改訂。アーキテクチャ概要、Phase 0 のセットアップ手順（GitHub App / OAuth App / ImageKit / Upstash / content リポジトリ）、**デザインシステムの install 設定（`~/.npmrc` に classic PAT が必要なこと）**、mise / pnpm の前提、開発コマンド |
| 16-1b | ローカル起動手順を記載。**`~/.npmrc` に classic PAT が必要**なこと、**パッケージ設定の Manage Actions access に `nextjs-cms` を Read 追加する**こと（0.4）。デプロイしない方針（requirements.md OPEN-01）と、将来デプロイする場合に必要な設定も併記する |
| 16-2 | `docs/api.md` の最終化（公開 API リファレンス）。**公開サイト側の推奨実装**（サーバー側取得・SSG/ISR による可用性の切り離し・書き込みは提供しないこと）を design.md 9.7 に基づいて記載する |
| 16-3 | `docs/operations.md`: GitHub 上で直接編集する場合の手順、トラブルシュート（Webhook 不達時、インデックス不整合時） |
| 16-4 | 受け入れ基準 1〜11 の通し確認 |

### 完了条件
- requirements.md 8章の受け入れ基準をすべて満たすこと
- 新規環境で README のみを見てセットアップが完了できること（NFR-OPS-03）

### 対応要件
NFR-OPS-03、受け入れ基準全項目

---

## Phase 17: 実表示プレビュー（公開サイト連携） 【規模: M】

### 実施タイミング

**公開サイトの構築時に実施する。** Phase 16 までで CMS は完成しており、本フェーズは公開サイトが存在して初めて意味を持つ。Phase 1〜16 の完了条件には含まれない。

### 目的

公開サイトのレイアウトで下書きを確認できるようにする。Phase 13 の本文プレビューは Markdown の変換結果しか見せないため、実際の見た目を確認する手段が別途必要になる。

### 作業（CMS 側）

| # | 内容 |
| --- | --- |
| 17-1 | `src/preview/token.ts`: JWT（HS256）の発行と検証。クレームは `type` / `id` / `exp`（5分） |
| 17-2 | `POST /api/admin/preview-token`: Admin セッション必須。トークンと公開サイトのプレビュー URL を返す |
| 17-3 | `GET /api/preview/{type}/{id}`: Bearer トークン認証。**クレームの `type`/`id` と要求リソースの一致を検証**してから作業ブランチの内容を返す |
| 17-4 | プレビュー応答に `X-Robots-Tag: noindex, nofollow` を付与 |
| 17-5 | Admin のアクションバーに「公開サイトでプレビュー」を追加（新しいタブで開く） |
| 17-6 | `.env.example` に `PREVIEW_TOKEN_SECRET` / `PUBLIC_SITE_PREVIEW_URL` を追加 |
| 17-7 | `docs/api.md` に公開サイト側の実装手順を記載（Draft Mode の有効化・無効化・取得先の切り替え） |

### 作業（公開サイト側・本仕様の実装対象外）

- プレビュー開始ルート（Draft Mode 有効化 + トークン保存）
- プレビュー終了ルート
- Draft Mode 時にデータ取得先を `/api/preview/*` へ切り替える

### 完了条件

- Admin からプレビューを開くと、公開サイトのレイアウトで下書きが表示されること
- **トークンのクレームと異なるリソースを要求すると拒否されること**（他人の下書きを覗けないこと）
- 期限切れトークンが拒否されること
- 署名が不正なトークンが拒否されること
- プレビュー経由で取得した下書きが、`/api/v1/*` からは依然として取得できないこと
- プレビュー応答に `noindex` が付いていること
- 公開サイト側のソース・環境変数に署名鍵が存在しないこと

### 対応要件

FR-PREVIEW-01〜06, FR-DRAFT-05

---

## 18. 受け入れ基準とフェーズの対応

| 受け入れ基準 | 検証フェーズ |
| --- | --- |
| 1. 許可外ユーザーがログインできない | Phase 7 |
| 2. 作成 → 下書き → プレビュー → 公開 → API 取得の完走 | Phase 13 |
| 3. 下書きが公開 API から取得できない | Phase 6 |
| 4. カテゴリー・タグの作成と絞り込み | Phase 10 |
| 5. 画像のアップロードと API レスポンスへの反映 | Phase 13 |
| 6. 公開予約が時刻到来まで非公開 | Phase 14 |
| 7. GitHub 直接編集が公開 API に反映 | Phase 5 |
| 8. 競合時に変更が失われない | Phase 9 |
| 9. `format` 3種とプレビューの一致 | Phase 6 / 13 |
| 10. 生 HTML の除去 | Phase 4 / 13 |
| 11. lint / 型 / テストが通る | 全フェーズ |

---

## 19. リスクと対応

| リスク | 影響 | 対応 |
| --- | --- | --- |
| Git Data API での tree 操作の実装ミス | コンテンツの消失 | Phase 3 の契約テストを厚くする。`base_tree` を必ず指定し、差分のみを渡す。削除は明示的に `sha: null` のみ |
| インデックスの肥大化 | メモリ消費が増え、将来デプロイする場合は Data Cache の1エントリ上限（Vercel なら 2MB）にも収まらない | Phase 5 でインデックスのサイズを計測するテストを入れる。超える場合は type ごとに分割する |
| GitHub API のレート制限 | 公開 API の停止 | Phase 5 の呼び出し回数テストで担保。Webhook 不達時も 600 秒のフォールバックで回復 |
| Auth.js v5 の仕様変更 | 認証の破綻 | バージョンを固定する。`src/auth/` に閉じ込め、他層へ漏らさない |
| ImageKit 無料枠（ストレージ 3GB）の超過 | 画像のアップロード・配信の停止 | Phase 11 で原本を 5MB に制限し、配信は変換後の派生画像（ストレージを消費しない）に寄せる。README に枠の確認方法を記載 |
| ImageKit Upload V2 の仕様変更 | アップロード不可 | 公式 SDK がないため `src/media/` に閉じ込め、interface 越しにしか触らない。着手時に最新ドキュメントで仕様を確認する |
| プレビューと公開結果の乖離 | 品質事故 | Phase 13 で両者の一致をテストで固定（受け入れ基準 9） |
| デザインシステムが private パッケージであること | ローカルまたは CI で install に失敗し、ビルドが通らない | 0.4 に2箇所の設定をまとめ、Phase 1 の完了条件に CI での install 成功を含める |
| デザインシステムのメジャー更新 | 破壊的変更で Admin UI が壊れる | バージョンを `^4.0.0` で固定し、更新時は Storybook（公開 Chromatic）で差分を確認してから上げる |
| デザインシステムに無いコンポーネントの a11y | キーボード操作・スクリーンリーダー対応の不備 | Toast と Combobox は Radix UI のプリミティブに任せ、ARIA パターンを自前実装しない（PLAN-D3） |
