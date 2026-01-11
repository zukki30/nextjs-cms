# Next.js CMS

Next.js + Drizzle ORM + Better Auth + Hono + Zod を使用した CMS プロジェクト

## 技術スタック

- **Next.js 16.1.1** - React フレームワーク
- **TypeScript** - 型安全性
- **Drizzle ORM** - データベース ORM
- **Better Auth** - 認証システム
- **Hono** - 軽量 Web フレームワーク (API Routes 用)
- **Zod** - スキーマバリデーション
- **Biome** - リンター & フォーマッター

## セットアップ

### 1. 依存関係のインストール

\`\`\`bash
npm install
\`\`\`

### 2. 環境変数の設定

\`.env.example\` をコピーして \`.env\` を作成し、環境変数を設定します。

\`\`\`bash
cp .env.example .env
\`\`\`

\`.env\` ファイルを編集して、データベース接続情報と認証シークレットを設定してください。

### 3. データベースのセットアップ

PostgreSQL データベースを準備してから、マイグレーションを実行します。

\`\`\`bash
# スキーマをデータベースにプッシュ
npm run db:push

# または、マイグレーションファイルを生成して実行
npm run db:generate
npm run db:migrate
\`\`\`

### 4. 開発サーバーの起動

\`\`\`bash
npm run dev
\`\`\`

ブラウザで [http://localhost:3000](http://localhost:3000) を開いてアプリケーションにアクセスします。

## API エンドポイント

- \`GET /api/hello\` - サンプルエンドポイント
- \`POST /api/users\` - ユーザー作成 (Zod バリデーション付き)
- \`/api/auth/**\` - Better Auth の認証エンドポイント

## データベース管理

### Drizzle Studio の起動

\`\`\`bash
npm run db:studio
\`\`\`

ブラウザで Drizzle Studio が開き、データベースの内容を GUI で確認・編集できます。

### マイグレーション

\`\`\`bash
# マイグレーションファイルの生成
npm run db:generate

# マイグレーションの実行
npm run db:migrate

# スキーマを直接プッシュ (開発時)
npm run db:push
\`\`\`

## コード品質

### リント

\`\`\`bash
npm run lint
\`\`\`

### フォーマット

\`\`\`bash
npm run format
\`\`\`

## プロジェクト構造

\`\`\`
src/
├── app/
│   └── api/
│       └── [[...route]]/
│           └── route.ts      # Hono API Routes
├── db/
│   ├── index.ts              # Drizzle DB インスタンス
│   └── schema.ts             # データベーススキーマ
└── lib/
    └── auth.ts               # Better Auth 設定

drizzle.config.ts             # Drizzle 設定
\`\`\`

## Node.js バージョン管理

このプロジェクトは Volta を使用して Node.js のバージョンを管理しています。
Volta がインストールされている場合、プロジェクトディレクトリに入ると自動的に正しいバージョンに切り替わります。

- Node.js: 22.13.1
- npm: 10.9.2
