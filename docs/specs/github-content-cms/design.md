# 設計書: GitHub ベース ヘッドレス CMS

- spec 名: `github-content-cms`
- 作成日: 2026-10-20
- ステータス: レビュー待ち
- 対応する要件: [requirements.md](./requirements.md)

---

## 1. アーキテクチャ全体像

```
                        ┌─────────────────────────────────────────────┐
                        │  nextjs-cms (Next.js / ローカル実行)        │
  ブラウザ ──────────►  │                                             │
  (Admin)               │  /admin            Admin UI (RSC + CSR)     │
                        │  /api/admin/*      管理 API ─────────────┐  │
                        │  /api/v1/*         公開 API ◄── cache ─┐ │  │
  公開サイト ─────────►  │  /api/webhooks/*   Webhook 受信        │ │  │
  (別リポジトリ)         │                                        │ │  │
                        │                                        │ │  │
                        │  ┌──────────────────────────────────┐  │ │  │
                        │  │ domain/schema  Zod（単一の正）    │  │ │  │
                        │  │ content/index  インデックス構築   │──┘ │  │
                        │  │ content/markdown  md → HTML      │     │  │
                        │  └──────────────────────────────────┘     │  │
                        └───────────────┬──────────────────────┬────┘  │
                      read (GraphQL/REST)│                      │ write │
                                         ▼                      ▼ (Git Data API)
                        ┌────────────────────────────────────────────┐
                        │  nextjs-cms-content (private)              │
                        │    main            ← 公開済みコンテンツ      │
                        │    draft/news/<id> ← 下書き（未マージ）      │
                        │  push ──► Webhook でキャッシュ破棄 ─────────┘
                        └────────────────────────────────────────────┘

                        ┌────────────────────────────────────────────┐
  ブラウザ ─直接────────► │  ImageKit（サーバー発行の JWT を伴う           │
                        │            アップロードのみ許可 / Upload V2） │
                        └────────────────────────────────────────────┘
```

### 1.1 リポジトリ構成

全体は3つのリポジトリで構成する。

| リポジトリ | 役割 | デプロイ |
| --- | --- | --- |
| `nextjs-cms` | Admin UI + 管理 API + 公開 API | **しない**（ローカル実行のみ。requirements.md OPEN-01） |
| `nextjs-cms-content` | コンテンツの `.md` のみ | **しない** |
| 公開サイト（別リポジトリ） | 記事を表示する Web サイト | 本仕様の対象外 |

```
公開サイト ──GET /api/v1/*──► nextjs-cms ──commit / PR──► nextjs-cms-content
```

#### データとコードを同じリポジトリに置かない

content リポジトリは**デプロイされないデータ専用リポジトリ**とする。API のコードを同居させると、記事を1本書くたびにアプリが再デプロイされ、かつデータの変更とコードの変更が同じ Git 履歴に混ざる。更新頻度がまったく異なる2つを分離することが目的である。

#### 公開サイトは content リポジトリに直接アクセスしない

公開サイトが参照するのは `nextjs-cms` の公開 API だけで、content リポジトリの存在も GitHub の認証情報も知らない。これにより、公開サイト側に GitHub の資格情報が一切不要になる。

#### API を Admin と同じアプリに置く理由

Admin UI と管理 API が同一プロセスにあるため、両者の間にサービス間認証が不要になり、攻撃対象面が最小になる。API を独立したリポジトリ・デプロイに切り出す構成も可能だが、デプロイ先が増えるうえに Admin → API の M2M 認証を新たに設計する必要があり、現在の規模では複雑さに見合わない。

将来切り出す場合も、Hono のルート定義を別プロセスへ移し、公開サイトの参照先 URL を変えるだけで済む。公開 API の仕様は変わらないため、利用側への影響はない。

### 1.2 設計の中心となる3つの判断

| 判断 | 内容 | 根拠 |
| --- | --- | --- |
| 下書きはブランチで表現 | 公開 API は `main` しか読まない | 下書きが公開 API に漏れる経路が構造的に存在しない（FR-API-04） |
| 書き込み用の資格情報をブラウザに置かない | ユーザー OAuth は識別のみ。書き込みは GitHub App のインストールトークン | 長期シークレットがクライアントに存在しない（NFR-SEC-01） |
| 変換・インデックスはアプリ内の単一実装 | content リポジトリは純粋なデータのみ | スキーマとパイプラインが二重化しない（FR-MD-01, FR-DATA-03） |

---

## 2. content リポジトリの設計

### 2.1 ディレクトリ構成

```
content/
├── news/<slug>.md
├── blog/<slug>.md
├── faq/<slug>.md
└── _taxonomies/
    ├── news/categories/<slug>.md
    ├── news/tags/<slug>.md
    ├── blog/categories/<slug>.md
    └── blog/tags/<slug>.md
```

ワークフロー定義・生成ファイル・アプリコードは置かない（FR-CACHE-02）。

### 2.2 エントリの frontmatter

News / Blog:

```markdown
---
id: 01JAV8K2XYZABCDEFGHJKMNPQ
slug: service-release
title: サービスリリースのお知らせ
status: published
publishedAt: 2026-10-20T10:00:00+09:00
createdAt: 2026-10-19T14:30:00+09:00
updatedAt: 2026-10-20T09:12:00+09:00
excerpt: 新サービスをリリースしました。
categories: [announcement]
tags: [release, product]
coverImage:
  fileId: 6789abcdef0123456789abcd
  filePath: /news/01JAV8K2XYZABCDEFGHJKMNPQ/cover.jpg
  url: https://ik.imagekit.io/<id>/tr:w-1200,h-630,c-maintain_ratio/news/01JAV8K2XYZABCDEFGHJKMNPQ/cover.jpg
  alt: 新サービスのロゴ
  width: 1200
  height: 630
---

本文 Markdown
```

FAQ:

```markdown
---
id: 01JAV8M4...
slug: shipping-fee
title: 送料はいくらですか？
status: published
publishedAt: 2026-10-20T10:00:00+09:00
createdAt: ...
updatedAt: ...
order: 10
---

本文 Markdown
```

タクソノミー（`_taxonomies/news/categories/announcement.md`）:

```markdown
---
slug: announcement
name: お知らせ
order: 10
---

カテゴリーの説明文（任意・Markdown）
```

### 2.3 Zod スキーマ（`src/domain/schema/`）

アプリ内の単一の正とし、Admin のフォーム検証・インデックス構築・公開 API がすべてこれを参照する（FR-DATA-03）。

```ts
// common.ts
export const ulid = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/)
export const slug = z.string().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
export const isoDateTime = z.string().datetime({ offset: true })
export const entryStatus = z.enum(['published', 'archived']) // draft 値は持たない（FR-DATA-07）

export const imageRef = z.object({
  fileId: z.string().min(1),        // ImageKit の不変な識別子。参照検出と削除に使う
  filePath: z.string().min(1),      // 例: /news/<id>/cover.jpg
  url: z.string().url(),
  alt: z.string().default(''),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
})

// entry.ts
const base = z.object({
  id: ulid, slug, title: z.string().min(1).max(200),
  status: entryStatus,
  createdAt: isoDateTime, updatedAt: isoDateTime, publishedAt: isoDateTime,
})

export const newsFrontmatter = base.extend({
  excerpt: z.string().max(300).default(''),
  categories: z.array(slug).default([]),
  tags: z.array(slug).default([]),
  coverImage: imageRef.optional(),
})
export const blogFrontmatter = newsFrontmatter          // 同一構造・別タクソノミー空間
export const faqFrontmatter  = base.extend({ order: z.number().int().default(0) })

export const frontmatterByType = {
  news: newsFrontmatter, blog: blogFrontmatter, faq: faqFrontmatter,
} as const
```

`publishedAt` は必須にする。下書き時点では「公開したい日時」の予定値として保持し、未来日時なら公開予約になる（FR-CONTENT-09）。

### 2.4 ブランチと PR の命名規約

| 項目 | 規約 | 備考 |
| --- | --- | --- |
| ブランチ名 | `draft/<type>/<id>` | slug ではなく **ID** を使う。slug 変更でブランチが変わらない（FR-CONTENT-08） |
| PR タイトル | `[news] サービスリリースのお知らせ` | 人が GitHub 上で見て判別できる |
| PR ラベル | `cms:news` / `cms:blog` / `cms:faq` | GitHub 側での絞り込み用 |
| PR 本文 | 機械可読メタデータ + Admin へのリンク | 下記 |

```markdown
<!-- cms:meta
type: news
id: 01JAV8K2XYZABCDEFGHJKMNPQ
slug: service-release
-->

**タイトル**: サービスリリースのお知らせ
**公開予定**: 2026-10-20 10:00 (JST)

[Admin で編集](https://<host>/admin/news/01JAV8K2XYZABCDEFGHJKMNPQ) ・ [プレビュー](https://<host>/admin/preview/news/01JAV8K2XYZABCDEFGHJKMNPQ)
```

PR の一覧取得はブランチ名の `draft/` 接頭辞で判定し、`cms:meta` ブロックからメタデータを復元する。ブランチ名だけで `type` と `id` が取れるため、`cms:meta` が壊れていても縮退動作できる。

### 2.5 エントリの状態判定

状態は保存された値ではなく、**main 上の有無・frontmatter・下書きブランチの有無から導出**する。状態を2箇所に持たないための設計（FR-DATA-07）。

| main | status | publishedAt | 下書きブランチ | 導出される状態 |
| --- | --- | --- | --- | --- |
| なし | - | - | あり | 下書き（新規） |
| あり | published | 過去 | なし | 公開中 |
| あり | published | 過去 | あり | 公開中（編集中） |
| あり | published | 未来 | なし | 公開予約 |
| あり | archived | - | なし | 非公開 |
| あり | - | - | あり（削除コミット） | 削除申請中 |

---

## 3. 認証・認可の設計

### 3.1 2種類の GitHub 連携

| 用途 | 使うもの | 保持期間 |
| --- | --- | --- |
| **誰がログインしているか** | GitHub OAuth App | アクセストークンは許可判定後に即破棄（FR-AUTH-04） |
| **content リポジトリへの書き込み** | GitHub App のインストールトークン | サーバー内メモリに最長 55 分。クライアントには一切送らない |

GitHub App の権限は以下に限定する（NFR-SEC-02）。

- Repository permissions: `Contents: Read & write`, `Pull requests: Read & write`, `Metadata: Read`
- インストール対象: **content リポジトリ1つのみ**（All repositories は選ばない）
- Webhook: `push`（main のみ処理）

### 3.2 ログインフロー

```
1. /admin へ未認証アクセス → middleware が /admin/login へリダイレクト
2. GitHub OAuth（scope: read:user, read:org）→ state + PKCE 検証
3. signIn コールバックで許可判定（下記 3.3）
   ├ 許可 → セッション JWT を発行（暗号化 Cookie）、OAuth トークンは破棄
   └ 拒否 → /admin/login?error=forbidden、サーバーログに記録（NFR-SEC-09）
```

ライブラリは **Auth.js v5（next-auth）の JWT セッション戦略・アダプタなし**を採用する。DB を持たずに state / PKCE / JWE 暗号化 Cookie / CSRF トークンが揃うため、手書きより安全側に倒せる。

```ts
// src/auth/config.ts
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [GitHub({ authorization: { params: { scope: 'read:user read:org' } } })],
  session: { strategy: 'jwt', maxAge: 60 * 60 * 8 },   // 8時間（FR-AUTH-05）
  callbacks: {
    signIn: async ({ profile, account }) => isAllowed(profile, account.access_token),
    jwt: ({ token, profile }) => {
      if (profile) { token.login = profile.login; token.name = profile.name; token.email = profile.email }
      delete token.accessToken                          // OAuth トークンは載せない（FR-AUTH-04）
      return token
    },
  },
  cookies: { sessionToken: { options: { httpOnly: true, sameSite: 'lax', secure: true, path: '/' } } },
})
```

### 3.3 許可判定（`src/auth/allowlist.ts`）

```
ADMIN_ALLOWED_LOGINS に含まれる  → 許可
       または
ADMIN_ALLOWED_ORG のメンバー     → 許可（ADMIN_ALLOWED_ORG_TEAM 指定時はそのチームのメンバーのみ）
上記いずれにも該当しない          → 拒否
```

- 既定は拒否（allowlist が空なら誰もログインできない）
- Org / Team の判定はこの時点の OAuth トークンで1回だけ問い合わせ、結果はセッションに引き継がず毎回のログイン時に再評価する
- GitHub のユーザー名は変更可能なため、セッション JWT には不変の **GitHub user ID (`sub`)** も保持する

### 3.4 コミットの著者

```ts
author: { name: session.user.name ?? session.user.login, email: session.user.email ?? `${login}@users.noreply.github.com` }
committer: { name: 'nextjs-cms', email: '...' }
```

誰が何を変更したかは Git 履歴に残り、これが監査ログになる（NFR-OPS-02）。

### 3.5 CSRF とレート制限

| 対策 | 実装 |
| --- | --- |
| CSRF（NFR-SEC-03） | 全ての状態変更リクエストで `Origin` が自ホストと一致することを検証。加えて `Sec-Fetch-Site: same-origin` を要求。Auth.js 自身のルートは Auth.js の CSRF トークンに従う |
| セッション Cookie | `HttpOnly` / `Secure` / `SameSite=Lax` |
| セキュリティヘッダ（NFR-SEC-08） | `next.config` で CSP（`script-src 'self'`、`img-src` に `ik.imagekit.io`、`connect-src` に `upload.imagekit.io`）、`X-Frame-Options: DENY`、`Referrer-Policy: strict-origin-when-cross-origin`、`X-Content-Type-Options: nosniff` |
| レート制限（NFR-SEC-05） | **管理 API と Webhook のみ** Upstash Redis 無料枠 + `@upstash/ratelimit`。公開 API はカウンタを使わず 9.6 の方式で保護する |

サーバーレスでは関数インスタンスごとにメモリが独立しており、インメモリのカウンタは共有されないため、厳密なレート制限には外部ストアが要る。一方で **公開 API にカウンタ方式を適用してはならない**。Upstash 無料枠は月 50 万コマンドで、リクエストごとに消費する設計にすると「レート制限を機能させるための枠が、防ぎたい攻撃によって先に枯れる」状態になるため。公開 API は 9.6 の方式で保護する。

---

## 4. GitHub 連携層の設計（`src/content/github/`）

### 4.1 読み取り

| 用途 | API | 理由 |
| --- | --- | --- |
| 単一ファイル取得 | GraphQL `repository.object(expression: "<ref>:<path>")` | 1クエリで本文（`text`）と blob SHA（`oid`）が同時に取れる |
| 複数ファイル一括取得 | GraphQL のエイリアスで 50 件/クエリ | インデックス構築時の呼び出し回数を抑える（NFR-PERF-02b） |
| ファイル一覧 | REST `GET /git/trees/{sha}?recursive=1` | 1回で全パスと blob SHA が取れる |
| PR 一覧 | REST `GET /pulls?state=open` | 下書き一覧（FR-DRAFT-04） |

```graphql
query($owner:String!, $name:String!) {
  repository(owner:$owner, name:$name) {
    f0: object(expression: "main:content/news/a.md") { ... on Blob { text oid } }
    f1: object(expression: "main:content/news/b.md") { ... on Blob { text oid } }
    # ... 50件まで
  }
}
```

### 4.2 書き込み: Git Data API による単一コミット

Contents API（`PUT /contents/{path}`）ではなく **Git Data API** を使う。理由は2つ。

1. **複数ファイルを1コミットにまとめられる** — 記事本文と、編集中に新規作成したカテゴリーを同じコミット・同じ PR に載せる必要がある（FR-TAXO-04）
2. **リネームを原子的に扱える** — slug 変更はパス変更であり、Contents API では「新規作成 + 削除」の2コミットになる

```
1. GET  /git/ref/heads/<branch>            → 現在の head commit SHA
2. POST /git/blobs          × 変更ファイル数 → blob SHA
3. POST /git/trees  { base_tree: <head tree>, tree: [...] }  → 新 tree SHA
   - 削除は { path, mode:'100644', type:'blob', sha: null }
4. POST /git/commits { message, tree, parents:[<捕捉した head>], author }
5. PATCH /git/refs/heads/<branch> { sha: <new commit>, force: false }
```

### 4.3 楽観ロック（NFR-SEC-04）

手順 5 の `force: false` が排他制御そのものになる。

```
編集画面を開く    → そのブランチの head commit SHA を保持
保存              → 捕捉した SHA を parent にしたコミットを作り、非 fast-forward で ref 更新
  ├ ref が動いていない → 成功
  └ ref が動いていた   → GitHub が 422 を返す → API は 409 CONFLICT に変換して上書きしない
```

Admin は 409 を受けたら「他の場所で更新されています」と表示し、再読み込みか差分確認を促す。ファイル単位の blob SHA ではなくブランチ単位で判定するため、同一ブランチへの並行書き込みをすべて検出できる。

### 4.4 操作の組み立て

```ts
interface ContentRepository {
  // 読み取り
  getTree(ref: string): Promise<TreeEntry[]>
  getFile(ref: string, path: string): Promise<{ text: string; oid: string } | null>
  getFiles(ref: string, paths: string[]): Promise<Map<string, { text: string; oid: string }>>
  getHeadSha(branch: string): Promise<string>

  // 書き込み
  commit(input: {
    branch: string; baseSha: string; message: string
    changes: Array<{ path: string; content: string } | { path: string; delete: true }>
    author: { name: string; email: string }
  }): Promise<{ commitSha: string }>

  // ブランチ / PR
  createBranch(name: string, fromSha: string): Promise<void>
  deleteBranch(name: string): Promise<void>
  findOpenPr(branch: string): Promise<PullRequest | null>
  listOpenPrs(): Promise<PullRequest[]>
  createPr(input: { branch: string; title: string; body: string; labels: string[]; draft: boolean }): Promise<PullRequest>
  mergePr(number: number, opts: { method: 'squash' }): Promise<void>
  closePr(number: number): Promise<void>
}
```

この interface を境界にすることで、テストではインメモリ実装に差し替えられる（NFR-QA-04）。

---

## 5. 書き込みフローの設計

### 5.1 新規作成 → 下書き保存（FR-DRAFT-01〜03）

```
POST /api/admin/news
  1. Zod 検証（frontmatter + 本文）
  2. ULID を発番
  3. slug 重複チェック（main のインデックス ∪ 既存の下書き）→ 重複なら 409
  4. main の head SHA を取得 → draft/news/<id> ブランチを作成
  5. commit: content/news/<slug>.md（+ 新規タクソノミー）
  6. Draft PR を作成（base: main / head: draft/news/<id>）
  7. → { id, branch, prNumber, headSha }
```

### 5.2 2回目以降の下書き保存（FR-DRAFT-02）

```
PUT /api/admin/news/<id>  { ..., headSha }
  1. Zod 検証
  2. 既存の下書きブランチへ commit（4.2 / 4.3 の手順）
  3. slug が変わっていれば旧パスの削除を同一コミットに含める
  4. PR 本文の cms:meta を更新
```

### 5.3 公開（FR-DRAFT-06, 07）

```
POST /api/admin/news/<id>/publish
  1. PR の mergeable / mergeable_state を確認
     └ 競合（dirty）→ 409 を返し、公開を実行しない（FR-DRAFT-07）
  2. squash merge（履歴を「1エントリの変更 = 1コミット」に保つ）
  3. 下書きブランチを削除
  4. main 更新 → Webhook → インデックス再構築（6章）
```

### 5.4 削除（FR-CONTENT-05）／非公開化（FR-CONTENT-06）

| 操作 | 実装 |
| --- | --- |
| 削除 | 下書きブランチで該当ファイルの削除コミット → PR → マージ。Git 履歴から復元可能 |
| 非公開化 | `status: archived` に変更するコミット → PR → マージ。ファイルは残る |

どちらも PR を経由するため、「気付かないうちに公開記事が消える」ことがない。

### 5.5 下書きの破棄（FR-DRAFT-08）

```
POST /api/admin/news/<id>/discard  → PR をクローズ → ブランチ削除
```

### 5.6 タクソノミーの作成（FR-TAXO-03, 04）

エントリ編集中に作成したカテゴリー・タグは、**そのエントリの下書きブランチ**にコミットされる。したがって選択候補は次の合併になる。

```
候補 = main 上のタクソノミー（インデックス由来）∪ 現在の下書きブランチ上のタクソノミー
```

タクソノミー管理画面（`/admin/news/taxonomies`）からの編集・削除も同じく専用ブランチ + PR を経由する（ブランチ名 `draft/taxonomy/news`）。削除時はインデックスを走査して使用中のエントリを警告する（FR-TAXO-05）。

### 5.7 プレビューの設計

公開サイトが別アプリであるため、プレビューは**2階層**になる。両者は目的が異なり、置き換え関係ではない。

| 階層 | 見えるもの | 見えないもの | 実装 |
| --- | --- | --- | --- |
| **本文プレビュー**（CMS 内） | Markdown の変換結果（見出し・表・コード・画像） | 公開サイトの CSS・レイアウト・周辺要素 | Phase 13 |
| **実表示プレビュー**（公開サイト連携） | 公開サイトの完全な見た目 | — | 公開サイト構築時（Phase 17） |

#### 5.7.1 本文プレビュー（CMS 内）

- `/admin/preview/{type}/{id}` および エディタ横のライブプレビュー
- Admin セッション必須
- 作業ブランチの `.md` を読み、7章のパイプラインで変換して表示する
- 公開 API の `format=html` と**同一の関数**を通るため、出力が一致する（受け入れ基準 9）

本文の構造確認はこれで足りる。レイアウト確認はできないが、公開サイトが存在しない段階でも機能する点に価値がある。

#### 5.7.2 実表示プレビュー（公開サイト連携）

```
Admin「プレビュー」ボタン
  │
  │ [1] POST /api/admin/preview-token  { type, id }
  │     ← 短命の署名付きトークン T（クレーム: type / id / exp 5分）
  ▼
新しいタブで公開サイトを開く
  https://<public-site>/api/preview?token=T&path=/news/service-release
  │
  │ [2] 公開サイトが Draft Mode を有効化し、T を HttpOnly Cookie に保存
  │ [3] /news/service-release を通常どおり描画。ただしデータ取得先を
  │     公開 API からプレビュー API に切り替える
  ▼
  GET https://<cms-host>/api/preview/news/service-release
      Authorization: Bearer T          ← サーバー間通信のため CORS 不要
  │
  │ [4] CMS が T を検証し、作業ブランチから内容を返す
  ▼
  公開サイトのレイアウトで下書きが表示される
```

##### CMS 側に必要なエンドポイント

| メソッド | パス | 認証 | 内容 |
| --- | --- | --- | --- |
| POST | `/api/admin/preview-token` | Admin セッション | `{ type, id }` を受け取り、署名付きトークンと公開サイトのプレビュー URL を返す |
| GET | `/api/preview/{type}/{id}` | Bearer トークン | トークンを検証し、作業ブランチの内容を返す |

`/api/preview/{type}/{id}` の読み取り処理は 5.7.1 の本文プレビューと同一である。**認証方式をセッションに加えてトークンにも対応させるだけ**で、新たなデータ取得経路は作らない。

##### トークンの設計

| 項目 | 内容 |
| --- | --- |
| 形式 | JWT（HS256）。署名鍵は `PREVIEW_TOKEN_SECRET` |
| クレーム | `type` / `id` / `exp`（発行から5分） |
| 検証 | 署名・有効期限に加え、**クレームの `type`/`id` と要求されたリソースの一致**を検証する |

`type`/`id` の一致検証は必須である。これが無いと、1つのプレビュートークンで任意の下書きを閲覧できてしまう。

##### セキュリティ上の要点

| 項目 | 設計 |
| --- | --- |
| 公開サイトは秘密を持たない（FR-PREVIEW-04） | 公開サイトはトークンを検証せず、受け取った値を CMS へ転送するだけ。署名鍵を持つのは CMS のみ。1.1 の「公開サイト側に資格情報を置かない」原則と一致する |
| 公開 API との分離（FR-PREVIEW-06） | `/api/preview/*` は `/api/v1/*` とは別系統。公開 API は `main` しか読まないという原則は変わらない |
| インデックス抑止（FR-PREVIEW-05） | プレビュー応答に `X-Robots-Tag: noindex, nofollow` を付与 |
| URL 漏洩時の被害 | トークンが短命（5分）なため、共有された URL は間もなく無効になる |
| Cookie | 公開サイト側の Draft Mode Cookie も `HttpOnly` / `SameSite=Lax` / 短命とする |

##### 公開サイト側に必要なもの（本仕様の実装対象外）

- プレビュー開始ルート（Draft Mode 有効化 + トークンの保存）
- プレビュー終了ルート（Draft Mode 無効化）
- データ取得先の切り替え（Draft Mode なら `/api/preview/*`、通常は `/api/v1/*`）

Next.js なら Draft Mode がそのまま使えるが、仕組み自体は汎用であり Astro / Nuxt / SvelteKit でも同等に実装できる。

##### 任意: Admin への埋め込み

5.7.2 の上に、公開サイトのプレビュー URL を Admin のエディタ横に `iframe` で並べる構成も可能。公開サイト側の CSP で `frame-ancestors` に CMS のオリジンを許可する必要がある。

#### 5.7.3 採用しない案

**content の PR ごとに公開サイトをプレビュービルドする方式**は採用しない。`repository_dispatch` で公開サイトのビルドをトリガーし、ビルド時に作業ブランチから取得する構成だが、プレビュー1回ごとにフルビルドが走る。得られる結果は 5.7.2 とほぼ同じであり、待ち時間とリポジトリ間の結合に見合わない。

---

## 6. インデックスとキャッシュの設計（`src/content/index/`）

### 6.1 インデックスの構造

```ts
type IndexedEntry = {
  id: string; type: ContentType; slug: string; title: string
  status: 'published' | 'archived'
  publishedAt: string; createdAt: string; updatedAt: string
  excerpt: string; categories: string[]; tags: string[]
  coverImage?: ImageRef; order?: number
  path: string; blobSha: string
  searchText: string          // タイトル + excerpt + 見出し + タクソノミー名を正規化した文字列
}

type ContentIndex = {
  commitSha: string           // main の head。これが変わったら再構築
  builtAt: string
  entries: IndexedEntry[]
  taxonomies: Record<'news' | 'blog', { categories: Term[]; tags: Term[] }>
}
```

**本文全文はインデックスに含めない。** 1,000 件規模で数 MB に達し、リクエストごとにメモリへ展開するコストが大きいため。加えて、ホスティングする場合は Data Cache の1エントリ上限（Vercel なら 2MB）に収まらなくなる。`q` の検索対象はタイトル・excerpt・見出し・タクソノミー名に限定する（「全文検索エンジンは導入しない」= requirements 3.2 と整合）。本文全文の検索が必要になった時点で Pagefind 等の導入を検討する。

### 6.2 構築手順

```
1. GET /git/trees/main?recursive=1          … 1 回
2. content/**/*.md のパスを抽出
3. GraphQL で 50 件/クエリずつ一括取得      … 1,000 件で 20 回（NFR-PERF-02b）
4. frontmatter を Zod で検証
   ├ 成功 → インデックスに追加
   └ 失敗 → そのエントリを除外し、警告をログ出力（1件の不正が全体を壊さない）
5. 本文から見出しを抽出して searchText を構成
```

### 6.3 キャッシュの階層

```ts
// インデックス（公開 API・Admin の両方が参照）
const getIndex = unstable_cache(buildIndex, ['content-index'], {
  tags: ['content'],
  revalidate: 600,        // Webhook 不達時のフォールバック（FR-CACHE-06）
})

// エントリの変換済み HTML
const getRenderedEntry = (type, slug) => unstable_cache(
  () => fetchAndRender(type, slug), ['entry', type, slug],
  { tags: ['content', `entry:${type}:${slug}`], revalidate: 600 },
)()
```

| レイヤ | 保持内容 | 破棄契機 |
| --- | --- | --- |
| Data Cache: `content-index` | インデックス全体 | Webhook / 600 秒 |
| Data Cache: `entry:*` | 変換済み HTML・目次 | Webhook / 600 秒 |
| CDN | 公開 API のレスポンス | `s-maxage=60, stale-while-revalidate=300` |

### 6.4 公開判定をキャッシュの外で行う（FR-CACHE-07）

```
❌ 「公開済みに絞り込んだ結果」をキャッシュする → 公開予約が反映されない
✅ 「全エントリを含むインデックス」をキャッシュし、公開判定・絞り込み・
   ページネーションはリクエストごとにメモリ上で行う
```

インデックスは `archived` や公開予約中のものも含めて保持し、`status === 'published' && publishedAt <= now` の判定は毎リクエストで評価する。これにより公開予約は追加のジョブなしに時刻到来で反映される。CDN の `s-maxage=60` があるため、実際の反映誤差は最大 60 秒。

### 6.5 Webhook（FR-CACHE-03, 05, 08）

```
POST /api/webhooks/github
  1. X-Hub-Signature-256 を HMAC-SHA256 で検証（タイミング安全比較）。失敗 → 401
  2. X-GitHub-Event === 'push' かつ ref === 'refs/heads/main' 以外 → 204 で無視
  3. commits[].added/modified/removed から変更された type/slug を特定
  4. revalidateTag('content') と revalidateTag(`entry:<type>:<slug>`) を実行
  5. 204
```

アプリ側に生成コミットが存在しないため、「生成が push を再トリガーする」ループは原理的に起きない。GitHub 上で直接編集した場合も同じ経路を通る（FR-CACHE-08）。

---

## 7. Markdown 変換パイプライン（`src/content/markdown/`）

### 7.1 unified の構成（FR-MD-01〜05）

```
remark-parse
  → remark-gfm                              表・取り消し線・タスクリスト
  → remark-rehype { allowDangerousHtml: true }
  → rehype-raw                              生 HTML をいったん AST に取り込む
  → rehype-sanitize(schema)                 ★ ここで危険な要素を除去（FR-MD-02）
  → rehype-slug                             見出しに id を付与（FR-MD-04）
  → rehype-pretty-code (shiki)              サニタイズ後に適用（FR-MD-03）
  → rehypeImageKitImage（自作）              width/height/loading を補完（FR-MD-05）
  → rehype-stringify
```

**プラグインの順序が設計上の要点**である。

- `rehype-raw` は `rehype-sanitize` の**前**でなければならない。後ろに置くと生 HTML がサニタイズを素通りする
- `rehype-pretty-code` は `rehype-sanitize` の**後**に置く。Shiki が生成する大量の `style` 付き `<span>` は標準スキーマで除去されてしまうため、「ユーザー入力を先に無毒化し、その後に自前の信頼できる変換を適用する」順序にする
- `code` 要素の `className` は標準スキーマが `language-*` を許可しているため、`rehype-pretty-code` は言語指定を受け取れる

### 7.2 サニタイズスキーマ

`rehype-sanitize` の `defaultSchema`（GitHub 相当）を基に次を調整する。

| 調整 | 内容 |
| --- | --- |
| 許可追加 | `img` の `width` / `height` / `loading` / `decoding`、`code`/`span` の `style`（ハイライト用、サニタイズ後の自前生成分） |
| 明示的に不許可 | `script` / `iframe` / `object` / `embed` / `form` / `style` 要素、`on*` 属性 |
| URL スキーム | `http` / `https` / `mailto` のみ。`javascript:` `data:` は除去 |

### 7.3 画像の寸法補完（FR-MD-05）

Markdown の `![alt](url)` には寸法を書けないため、**ImageKit URL の変換パラメータから読み取る**。

```
https://ik.imagekit.io/<id>/tr:w-1200,h-630,c-maintain_ratio/news/.../cover.jpg
                            └──── ここを解析 ────┘
→ <img src="..." alt="..." width="1200" height="630" loading="lazy" decoding="async">
```

変換指定は ImageKit 既定の**パス形式**（`/tr:…/`）を用いる。正規表現 `/\/tr:([^/]+)\//` で確実に切り出せ、クエリ文字列の扱いに左右されないため。

Admin のメディアピッカーは必ず `w-` / `h-` を含む URL を挿入する。これによりレイアウトシフトを防ぎ、かつ本文に生 HTML を書かせずに済む。ImageKit 以外のホストの画像には何も付与しない。

### 7.4 返却値

```ts
type RenderResult = {
  html: string
  toc: Array<{ depth: 2 | 3; id: string; text: string }>
}
```

### 7.5 同一実装の共有（FR-MD-01）

| 利用箇所 | 呼び出し方 |
| --- | --- |
| 公開 API 詳細（`format=html` / `both`） | サーバー内で直接呼び出し、結果をキャッシュ |
| Admin エディタのライブプレビュー | `POST /api/admin/render` にデバウンス送信し、**サーバーで**変換 |
| Admin 下書きプレビュー | 下書きブランチの `.md` を読んで同じ関数で変換 |

ライブプレビューをクライアント側のパーサで行わない理由は、プレビューと公開結果の一致を実装レベルで保証するため（受け入れ基準 9）。

---

## 8. 画像の設計（`src/media/imagekit.ts`）

### 8.1 Upload API は V2（JWT 方式）を使う

ImageKit のクライアント直アップロードには2方式あり、**V1 は本設計の要件を満たさない**。

| 方式 | 署名が束縛する範囲 | 採否 |
| --- | --- | --- |
| V1（`token` + `expire` + `signature` / HMAC-SHA1） | `token` と `expire` のみ。**`folder` や `fileName` は束縛されない** → クライアントが任意のフォルダへアップロードできる | **不採用** |
| V2（単一 JWT） | **アップロードペイロード全体**（`fileName` / `folder` / `useUniqueFileName` 等）。1項目でも改変すると ImageKit 側が拒否する | **採用** |

FR-IMG-02（サーバーが署名したリクエストのみ受け付ける）と FR-IMG-07（タイプごとのフォルダ分離）を担保できるのは V2 のみ。V2 には公式 SDK が存在しないため、JWT 生成（`jose`）と `fetch` で直接実装する。エンドポイントとペイロードの詳細は実装時（Phase 11）に最新ドキュメントで確認する。

JWT は **private key で HMAC-SHA256 署名**し、ヘッダの `kid` にアカウントの public key を入れる。public key はアカウントに1つで、private key 側が複数（Standard / Restricted）存在する構造になっている。

#### 使用する API キー（最小権限）

| キー種別 | 設定 |
| --- | --- |
| **Restricted key を使用** | Media Management: **Read and write** / Account Management: **None** |
| Standard key | 使用しない（全 API への読み書きが付き過剰） |

Account Management を `None` にすることで、private key が漏洩しても origins / URL endpoints / webhooks といったアカウント設定へは到達できない。Restricted key は最大5本作成できるため、開発用と本番用を分けて個別に失効できる。

> **Phase 11 で要検証**: Restricted key で Upload V2 の JWT 検証が通ることは公式ドキュメントで明示確認できていない（`kid` がアカウント共通の public key であるため、どの private key で検証されるかの記載がない）。拒否される場合は Standard key に切り替える（`.env` の値の差し替えのみで、コード変更は不要）。

### 8.2 アップロードの流れ（FR-IMG-01〜03）

```
1. ブラウザ → POST /api/admin/uploads/token { type, entryId, fileName, contentType, size }
     - 拡張子 / MIME / サイズをサーバー側で検証（SVG 不許可 / 5MB 上限）
     - folder = /<IMAGEKIT_FOLDER_PREFIX>/<type>/<entryId>、fileName を正規化
       （prefix 未設定時は /<type>/<entryId>。8.5 参照）
     - private key で署名した JWT を生成（private key はサーバーから出さない）
     → { token, publicKey, uploadPayload }   ← uploadPayload は JWT に署名された内容そのもの
2. ブラウザ → ImageKit の Upload V2 エンドポイントへ直接 POST
     - 受け取った uploadPayload をそのまま FormData に載せる（改変すると JWT 検証に失敗）
     - 画像データはアプリサーバーを経由しない
3. ブラウザ → レスポンスの fileId / filePath / url / width / height を Admin の状態に保持
4. 保存時に frontmatter の coverImage または本文の Markdown に書き込まれる
```

| 制限 | 値 |
| --- | --- |
| 許可形式 | `jpg` / `jpeg` / `png` / `webp` / `gif`（SVG は XSS 経路になるため不許可） |
| 最大サイズ | **5 MB**（無料枠のストレージが 3 GB のため原本サイズを抑える） |
| フォルダ | `/news/<id>/` `/blog/<id>/` `/faq/<id>/`（FR-IMG-07）。`IMAGEKIT_FOLDER_PREFIX` 設定時はその配下 |

### 8.3 一覧・削除（FR-IMG-04, 05）

| 操作 | 実装 |
| --- | --- |
| 一覧・検索 | `GET /api/admin/uploads` → サーバーが `GET https://api.imagekit.io/v1/files`（private key の Basic 認証）を呼ぶ。private key はクライアントに出さない |
| 削除 | `DELETE /api/admin/uploads/{fileId}` → 事前にインデックスを走査して `fileId` を参照しているエントリを検出。存在すれば `409` + 参照一覧を返し、`?force=true` で強制削除。確認後 `DELETE https://api.imagekit.io/v1/files/{fileId}` |

`url` ではなく **`fileId`** を frontmatter に保持しているため、URL の変換パラメータ（`tr:` 部分）が異なっても参照検出が確実に効く。

### 8.4 任意の追加防御

ImageKit の **Path policy**（フォルダ単位のガバナンス）を併用すると、万一 JWT 生成側に不備があってもフォルダ外への書き込みを ImageKit 側で止められる。必須ではないが、設定コストが低いため導入を推奨する。

### 8.5 本 CMS を複製して複数プロジェクトで使う場合

ImageKit には**サブアカウント**（API キー・メディアライブラリ・設定が完全に独立する仕組み）があるが、**Enterprise プラン / パートナー限定**で無料枠では利用できない。URL エンドポイントは無料枠で2つまで追加できるものの、**メディアライブラリとストレージ枠は共有**される。

したがって無料枠での選択肢は次の2つ。

| 方式 | 内容 | 枠の扱い |
| --- | --- | --- |
| **A. 1アカウント + フォルダ分離** | `IMAGEKIT_FOLDER_PREFIX` にプロジェクト識別子を設定し、`/<prefix>/<type>/<id>/` に保管。Path policy でフォルダ外書き込みを遮断 | **3 GB / 20 GB を全プロジェクトで共有** |
| **B. プロジェクトごとに別アカウント** | `IMAGEKIT_*` を丸ごと差し替える | プロジェクトごとに独立 |

**アプリ側のコード変更はどちらの方式でも発生しない**（環境変数の差し替えのみ）。B は無料枠の複数アカウント運用が規約上許容されるかの確認が必要で、本番運用では有料プランへの移行を前提に検討する。

ストレージ 3 GB が制約として厳しくなった場合は、画像の保管先を Cloudflare R2（10 GB 無料・バケット数無制限）へ移すことも選択肢になる。その場合は URL 変換機能を失うため、`src/content/markdown/plugins/imagekit-image.ts` と `src/media/` の差し替えが必要になる。

#### 他の外部依存の複製可否

| 依存 | 複製時の扱い |
| --- | --- |
| content リポジトリ | プロジェクトごとに1つ作る |
| GitHub App | **1つの App を複数リポジトリにインストールできる。** インストールごとに installation ID が異なるため、`GITHUB_APP_INSTALLATION_ID` の差し替えだけでよく、App を作り直す必要はない |
| GitHub OAuth App | Redirect URI を最大10件登録できるため1つで複数ドメインを賄える。分離したい場合はプロジェクトごとに作成 |
| Upstash | レート制限のキーにプロジェクト識別子を前置すれば1つの DB を共有できる |

---

## 9. 公開 API の仕様（`/api/v1`）

### 9.1 エンドポイント

| メソッド | パス | 説明 |
| --- | --- | --- |
| GET | `/api/v1/{type}` | 一覧（`type` = `news` \| `blog` \| `faq`） |
| GET | `/api/v1/{type}/{slugOrId}` | 詳細 |
| GET | `/api/v1/{type}/categories` | カテゴリー一覧（`news` / `blog` のみ） |
| GET | `/api/v1/{type}/tags` | タグ一覧（`news` / `blog` のみ） |

### 9.2 一覧のクエリパラメータ

| 名前 | 既定 | 説明 |
| --- | --- | --- |
| `category` | - | カテゴリー slug。複数指定可（`?category=a&category=b` = OR） |
| `tag` | - | タグ slug。複数指定可（OR）。`category` との併用は AND |
| `q` | - | タイトル・excerpt・見出し・タクソノミー名への部分一致（大文字小文字・全半角を正規化） |
| `page` | `1` | 1 始まり |
| `perPage` | `20` | 最大 `100` |
| `sort` | `publishedAt:desc` | `publishedAt:asc\|desc` / `updatedAt:asc\|desc` / `order:asc`（FAQ 既定） |

一覧は本文を含めない（FR-API-07）。

```jsonc
{
  "items": [
    { "id": "01JAV8K2...", "slug": "service-release", "title": "サービスリリースのお知らせ",
      "excerpt": "新サービスをリリースしました。",
      "publishedAt": "2026-10-20T10:00:00+09:00", "updatedAt": "2026-10-20T09:12:00+09:00",
      "categories": [{ "slug": "announcement", "name": "お知らせ" }],
      "tags": [{ "slug": "release", "name": "リリース" }],
      "coverImage": { "url": "...", "alt": "...", "width": 1200, "height": 630 } }
  ],
  "pagination": { "page": 1, "perPage": 20, "total": 42, "totalPages": 3, "hasNext": true }
}
```

### 9.3 詳細の `format`（FR-API-06）

| `format` | レスポンスに含まれる本文 |
| --- | --- |
| `html`（既定） | `contentHtml` + `toc` |
| `markdown` | `content`（Markdown 原文） |
| `both` | `content` + `contentHtml` + `toc` |

```jsonc
// GET /api/v1/news/service-release?format=both
{
  "id": "01JAV8K2...", "slug": "service-release", "title": "サービスリリースのお知らせ",
  "publishedAt": "...", "updatedAt": "...",
  "categories": [...], "tags": [...], "coverImage": {...},
  "content": "## はじめに\n\n本文…",
  "contentHtml": "<h2 id=\"はじめに\">はじめに</h2><p>本文…</p>",
  "toc": [{ "depth": 2, "id": "はじめに", "text": "はじめに" }]
}
```

### 9.4 エラー形式（FR-API-08）

```jsonc
{ "error": { "code": "NOT_FOUND", "message": "news \"foo\" is not found" } }
{ "error": { "code": "BAD_REQUEST", "message": "invalid query parameter",
             "details": [{ "path": "perPage", "message": "must be <= 100" }] } }
```

| HTTP | code |
| --- | --- |
| 400 | `BAD_REQUEST` |
| 404 | `NOT_FOUND` |
| 429 | `RATE_LIMITED` |
| 500 | `INTERNAL_ERROR`（詳細は返さずサーバーログに記録） |

### 9.5 CORS とキャッシュヘッダ

```
Access-Control-Allow-Origin: <PUBLIC_API_ALLOWED_ORIGINS>   # 既定 *
Access-Control-Allow-Methods: GET, OPTIONS
Cache-Control: public, s-maxage=60, stale-while-revalidate=300
```

エラーレスポンス（400 / 404）にも同じ `Cache-Control` を付ける。エラーをキャッシュさせないと、不正なクエリを投げ続けるだけでオリジンに到達できてしまうため。

### 9.6 公開 API の保護（NFR-SEC-05b）

公開 API はカウンタによるレート制限を行わない。代わりに **キャッシュ可能な URL の種類を有限個に閉じ込める**ことで、キャッシュを迂回した大量アクセスそのものを成立させない。

`?page=1` … `?page=99999` のような攻撃が成立するのは、未検証のクエリがそのままキャッシュキーになるためである。以下の正規化をルーティングの入口で行う。

| 規則 | 内容 | 効果 |
| --- | --- | --- |
| 未知パラメータの無視 | スキーマに無いクエリは**削除**してから処理する（エラーにはしない） | `?foo=1` `?utm_source=…` が別 URL にならない |
| `perPage` の離散化 | 許可値 `10` / `20` / `50` / `100` のみ。それ以外は 400 | 連続値による URL 生成を封じる |
| `page` の上限 | 総ページ数を超えたら空の 200 ではなく **400** | 無限のページ番号を潰す |
| `category` / `tag` の実在検証 | インデックスに存在する slug のみ受理。重複除去して昇順ソート | `?tag=b&tag=a` と `?tag=a&tag=b` が同一キーに畳まれる |
| `sort` の allowlist | 定義済みの組み合わせのみ | - |
| `q` の正規化 | NFKC 正規化 → 小文字化 → トリム → **64 文字で切り詰め**。2 文字未満は 400 | 自由入力の空間を圧縮する |
| 正規化後のリダイレクト | 正規化によって URL が変わる場合、308 で正規形へ寄せる（任意） | キャッシュヒット率が上がる |

これにより、キャッシュ可能な URL の総数は「タイプ数 × カテゴリー数 × タグ数 × ページ数 × ソート数」に限定される。`q` のみ自由度が残るが、64 文字上限かつオリジン処理はキャッシュ済みインデックスの走査だけで完結し、GitHub API を消費しない。

#### 多層防御として併用するもの

| 層 | 内容 |
| --- | --- |
| CDN | `s-maxage=60, stale-while-revalidate=300`。同一 URL の再アクセスはオリジンに届かない。**ローカル実行では CDN が存在しないため、ヘッダは将来のデプロイに備えた設定として付けるだけになる** |
| 支出上限（NFR-SEC-05c） | ホスティング側の課金上限を設定する。「安全」と「安い」を最終的に担保するのはここ。**デプロイする場合に適用する**（requirements.md OPEN-01） |
| 緊急時 | ホスティング側の攻撃対策モードを手動で有効化する。利用可否は基盤とプランに依存するため、デプロイ先を決める時点で確認する |
| 補助 | 関数インスタンス内のメモリによる best-effort な上限。インスタンス間で共有されないため主たる防御とはしないが、無料で単一インスタンスの暴走は抑えられる |

### 9.7 公開サイト側の推奨実装

公開サイトは別リポジトリ・別デプロイであり、本仕様の実装対象外（requirements.md 3.2）だが、API の設計意図を正しく活かすために以下を推奨する。README もしくは `docs/api.md` に記載する。

#### サーバー側から取得する

| 取得方法 | CORS | 評価 |
| --- | --- | --- |
| **サーバー側**（Server Component / ビルド時 / ISR の再検証時） | 不要 | **推奨** |
| ブラウザ側（クライアントからの `fetch`） | 必要（`PUBLIC_API_ALLOWED_ORIGINS` で許可済み） | 動作はするが API のドメインが利用者に露出する |

#### SSG / ISR にして可用性を切り離す

本設計では Admin UI と公開 API が同一アプリであるため、**アプリが停止すると公開サイトのコンテンツ取得も止まる**。これは API を Admin と同居させたことによる唯一の実質的な弱点である。

公開サイトを SSG / ISR で構築し、ビルド時と再検証時にのみ API を参照する構成にすれば、API が一時的に停止しても公開サイトは配信され続ける。公開サイトが Next.js の場合、content リポジトリの Webhook を公開サイト側にも配信して `revalidateTag` を呼ぶことで、更新時のみ再生成できる。

#### 書き込みは提供しない

公開 API は読み取り専用である（FR-API-01）。公開サイトからの問い合わせフォーム送信やコメント投稿といった書き込みは**本仕様に含まれない**。必要になった場合は、本 API に追加するのではなく独立した仕組みとして設計する。コンテンツ配信と利用者入力は、要求されるレート制限・スパム対策・永続化の性質がまったく異なるため。

---

## 10. 管理 API の仕様（`/api/admin`）

全エンドポイントでセッション検証（FR-AUTH-01）と Origin 検証（NFR-SEC-03）を行う。

| メソッド | パス | 説明 |
| --- | --- | --- |
| GET | `/api/admin/{type}` | 一覧（main のインデックス + オープン PR を突き合わせて状態を導出） |
| POST | `/api/admin/{type}` | 新規作成 → ブランチ + Draft PR |
| GET | `/api/admin/{type}/{id}` | 取得。下書きがあれば下書きを優先し、`headSha` を併せて返す |
| PUT | `/api/admin/{type}/{id}` | 下書きへ保存（`headSha` 必須・楽観ロック） |
| DELETE | `/api/admin/{type}/{id}` | 削除コミットの PR を作成 |
| POST | `/api/admin/{type}/{id}/publish` | PR をマージして公開 |
| POST | `/api/admin/{type}/{id}/discard` | 下書きを破棄 |
| POST | `/api/admin/{type}/{id}/archive` | 非公開化の PR を作成 |
| GET | `/api/admin/drafts` | オープン PR 一覧 |
| GET | `/api/admin/{type}/taxonomies` | カテゴリー・タグ一覧（main ∪ 下書きブランチ） |
| POST / PUT / DELETE | `/api/admin/{type}/taxonomies/{kind}/{slug}` | タクソノミー CRUD |
| POST | `/api/admin/render` | Markdown プレビュー描画 |
| POST | `/api/admin/uploads/token` | ImageKit Upload V2 用の JWT 発行 |
| GET | `/api/admin/uploads` | 画像一覧 |
| DELETE | `/api/admin/uploads/{publicId}` | 画像削除 |

| HTTP | 用途 |
| --- | --- |
| 401 | 未認証 |
| 403 | 許可リスト外 |
| 409 | slug 重複 / 楽観ロック競合 / PR がマージ不能 / 使用中の画像・タクソノミーの削除 |
| 422 | Zod 検証エラー（フィールド単位の `details` 付き、FR-CONTENT-10） |

---

## 11. Admin UI の設計

### 11.0 コンポーネントとスタイリングの方針

| 層 | 使うもの |
| --- | --- |
| フォーム・ボタン・ダイアログ等 | **`@zukki30/zukki-design-system`**（Button / Input / TextArea / Select / Checkbox / Radio / Switch / FormField / Dialog / Card / Tag / Tooltip / Icon / Skeleton / Spinner / Breadcrumb / Steps） |
| デザインシステムに無いもの | `src/components/ui/` に実装。**Table** / **Pagination** は自作、**Toast** は `@radix-ui/react-toast`、**Combobox** は `cmdk` + `@radix-ui/react-popover` |
| アプリ固有のレイアウト | **CSS Modules**。色・間隔はデザインシステムの CSS 変数（`--color-primary-default` 等）を参照する |

**独自の色値・間隔値を定義しない。** デザインシステムが `color-scheme: light dark` と `light-dark()` で light/dark 両対応のトークンを公開しているため、これを唯一の尺度とする。Tailwind は使用しない（トークンの尺度が二重化するため）。

デザインシステムに無いコンポーネントについても、shadcn/ui の Tailwind クラスをそのまま持ち込まず、挙動の土台（Radix UI / cmdk）だけを借りて見た目は CSS Modules で書く。Toast のライブリージョンや Combobox の ARIA パターンを自前実装しないことが目的である（NFR-A11Y-02, NFR-A11Y-03）。

### 11.1 画面構成

| パス | 画面 |
| --- | --- |
| `/admin/login` | GitHub でログイン |
| `/admin` | ダッシュボード（下書き一覧・最近の更新） |
| `/admin/{type}` | エントリ一覧（状態フィルタ・ソート・検索） |
| `/admin/{type}/new` | 新規作成 |
| `/admin/{type}/{id}` | 編集 |
| `/admin/{type}/taxonomies` | カテゴリー・タグ管理（news / blog のみ） |
| `/admin/media` | 画像一覧・アップロード |
| `/admin/preview/{type}/{id}` | 下書きプレビュー |

UI は README の参考デザイン（v0 の announcement management interface）を踏襲する。

### 11.2 エディタ

```
┌──────────────────────┬──────────────────────┐
│  Markdown エディタ    │  プレビュー            │
│  (CodeMirror 6)      │  (サーバー描画 HTML)   │
├──────────────────────┴──────────────────────┤
│  タイトル / slug / 公開日時 / カテゴリー /     │
│  タグ / 抜粋 / アイキャッチ画像                │
├─────────────────────────────────────────────┤
│  [下書き保存]  [プレビュー]  [公開]  [破棄]     │
└─────────────────────────────────────────────┘
```

- メタデータ入力はデザインシステムの `FormField` で組む。ラベルとエラーの関連付け（`aria-describedby`）は `FormField` が担うため自前で書かない
- エディタ: `@uiw/react-codemirror` + `@codemirror/lang-markdown`
- プレビュー: 入力を 500ms デバウンスして `POST /api/admin/render`（7.5 の理由によりサーバー描画）
- 画像挿入: メディアピッカーから選択すると `tr:w-…,h-…` 付きの ImageKit URL が本文に挿入される
- 保存前に離脱しようとした場合は警告を出す

### 11.3 アクセシビリティ（NFR-A11Y）

| 要件 | 実装 |
| --- | --- |
| A11Y-01 | すべての入力に `<label htmlFor>`。エラーは `aria-describedby` で関連付け |
| A11Y-02 | エディタ・メディアピッカー・ダイアログをキーボードのみで操作可能に。モーダルはフォーカストラップと Esc で閉じる |
| A11Y-03 | 保存・公開の結果を `role="status"`（成功）/ `role="alert"`（失敗）で通知。アイコン + テキストを併記し色のみに依存しない |
| A11Y-04 | 配色はコントラスト比 4.5:1 以上を満たすものを選定 |

---

## 12. ディレクトリ構成（アプリ）

```
src/
├── app/
│   ├── (admin)/admin/…                  Admin UI（RSC）
│   └── api/
│       ├── auth/[...nextauth]/route.ts  Auth.js
│       └── [[...route]]/route.ts        Hono をマウント
├── server/
│   ├── app.ts                           Hono インスタンス
│   ├── routes/{public,admin,webhook}.ts
│   └── middleware/{session,csrf,cors,rateLimit,errorHandler}.ts
├── domain/
│   ├── schema/{common,entry,taxonomy}.ts  ★ Zod の単一の正
│   ├── status.ts                        状態導出ロジック（2.5）
│   └── types.ts
├── content/
│   ├── github/{client,repository,paths}.ts
│   ├── index/{build,query}.ts
│   └── markdown/{render,sanitize-schema,plugins}.ts
├── media/{imagekit,token,types}.ts
├── auth/{config,allowlist,guard}.ts
├── components/
│   ├── ui/                              デザインシステムに無いもの（11.0）
│   │   ├── Table/{index.tsx,Table.module.css}
│   │   ├── Pagination/…
│   │   ├── Toast/…                      @radix-ui/react-toast
│   │   └── Combobox/…                   cmdk + @radix-ui/react-popover
│   └── admin/…                          画面固有のコンポーネント
└── lib/{env,logger,errors}.ts
```

`src/lib/env.ts` で環境変数を Zod 検証する。**用途別（core / github / imagekit / upstash / preview）にグループ分けし、実際に使う時点で検証する。** 全変数を起動時に必須検証すると、GitHub App の認証情報が無いだけでアプリが起動しなくなり、Phase 1〜6 の開発が進められなくなるため。

---

## 13. 環境変数

環境変数ではないが、デザインシステム（GitHub Packages の private パッケージ）の install には以下も必要になる。詳細は implementation-plan.md 0.4 を参照。

| 場所 | 設定 |
| --- | --- |
| `.npmrc`（コミットする） | `@zukki30:registry=https://npm.pkg.github.com` |
| `~/.npmrc`（コミットしない） | `//npm.pkg.github.com/:_authToken=<classic PAT / read:packages>` |
| GitHub Actions | `NODE_AUTH_TOKEN` |

```bash
# --- GitHub OAuth（ユーザー識別のみ） ---
AUTH_SECRET=
AUTH_URL=http://localhost:3000
AUTH_GITHUB_ID=
AUTH_GITHUB_SECRET=

# --- Admin 許可リスト（既定は拒否） ---
ADMIN_ALLOWED_LOGINS=zukki30
ADMIN_ALLOWED_ORG=
ADMIN_ALLOWED_ORG_TEAM=

# --- GitHub App（content への書き込み） ---
GITHUB_APP_ID=
GITHUB_APP_PRIVATE_KEY=
GITHUB_APP_INSTALLATION_ID=
CONTENT_REPO_OWNER=zukki30
CONTENT_REPO_NAME=nextjs-cms-content
CONTENT_REPO_BRANCH=main

# --- Webhook ---
GITHUB_WEBHOOK_SECRET=

# --- ImageKit ---
# public key と URL endpoint は公開前提の値のため NEXT_PUBLIC_ のみ定義し、
# サーバー側もそれを参照する（同じ値を2つの変数に持たせない）
IMAGEKIT_PRIVATE_KEY=              # Restricted key の private 値。サーバー専用
IMAGEKIT_FOLDER_PREFIX=            # 任意。複数プロジェクトで1アカウントを共有する場合に設定（8.5）
NEXT_PUBLIC_IMAGEKIT_PUBLIC_KEY=
NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT=https://ik.imagekit.io/<imagekit_id>

# --- 公開 API ---
PUBLIC_API_ALLOWED_ORIGINS=*

# --- 実表示プレビュー（Phase 17 / 公開サイト構築時に追加する。5.7.2） ---
PREVIEW_TOKEN_SECRET=              # プレビュートークンの署名鍵。CMS のみが保持する
PUBLIC_SITE_PREVIEW_URL=           # 例: https://<public-site>/api/preview

# --- レート制限（OPEN-D1 の判断次第） ---
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

---

## 14. テスト設計

| 対象 | 内容 |
| --- | --- |
| frontmatter スキーマ | 正常系／必須項目欠落／不正な slug・日時・status（NFR-QA-03） |
| 状態導出（2.5） | main の有無 × status × publishedAt × 下書きの有無の組み合わせ |
| インデックス構築 | 一部エントリの frontmatter が不正でも他が生き残ること、見出し抽出 |
| 公開 API クエリ | 絞り込み（category OR / tag OR / 併用 AND）、`q`、ソート、ページネーション境界（`page=0`、`perPage=101`） |
| 公開判定 | 公開予約が時刻到来前は返らず、到来後は返ること（時刻を注入可能にする） |
| Markdown 変換 | `<script>` / `onerror` / `javascript:` が除去されること、コードハイライト、見出し id、ImageKit URL からの寸法補完 |
| 認可 | 許可リスト内／外、Org メンバー／非メンバー、セッション期限切れ |
| 楽観ロック | ref が動いていた場合に 409 となり上書きされないこと |
| Webhook | 署名不正を拒否、main 以外の ref を無視、対象タグの破棄 |
| ImageKit の JWT 発行 | 不許可形式・サイズ超過の拒否、JWT のペイロードが要求した `folder` / `fileName` と一致すること、private key がレスポンスに含まれないこと |

`ContentRepository`（4.4）と ImageKit クライアントを interface で抽象化し、テストではインメモリ実装に差し替える（NFR-QA-04）。外部サービスへは一切通信しない。

---

## 15. 決定事項

2026-10-20 にユーザー承認済み。

| ID | 内容 | 決定 |
| --- | --- | --- |
| OPEN-D1 | レート制限に外部ストア（Upstash Redis 無料枠）を追加するか | **追加する。ただし管理 API と Webhook に限定する。** サーバーレスではインメモリのカウンタが共有されず厳密な制限ができないため外部ストアが要る。一方、公開 API に適用すると無料枠（月 50 万コマンド）が攻撃で先に枯れるため、9.6 のクエリ正規化方式で保護する（2026-10-27 追加決定） |
| OPEN-D2 | 公開 API の CDN キャッシュ 60 秒により、公開予約の反映に最大 60 秒の誤差が出る | **許容する。** 厳密化が必要になれば「次の公開予定時刻までの秒数」を `s-maxage` に動的設定する方式へ変更できる |
| OPEN-D3 | 1 PR = 1 エントリとするか、複数エントリをまとめられるようにするか | **1 PR = 1 エントリ。** ブランチ名に ID を含める設計がこれに依存している |
| OPEN-D4 | PR のマージ方式 | **squash merge。** 「1エントリの変更 = 1コミット」で履歴が読みやすい |
| OPEN-D5 | `q` の検索対象に本文全文を含めない | **本設計のまま。** 必要になれば Pagefind 等を追加する |
