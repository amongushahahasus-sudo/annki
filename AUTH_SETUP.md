# ログインの接続設定

Google、メールアドレス＋パスワード、新規登録時のメール確認、パスワード再設定にSupabase Authを使います。教材のクラウド同期は行いません。

## 1. Supabaseプロジェクト

新しいプロジェクトを使うか、既存のプロジェクトを選びます。既存プロジェクトを共有する場合は、既存アプリのURL・プロバイダー・メール設定を保持してください。ユーザーアカウントもプロジェクト内で共有されます。

`public/auth-config.json`に、対象プロジェクトのAPI URLと**publishable key**を設定します。このファイルは公開されます。`service_role`キー、secret key、GoogleのClient Secret、SMTPパスワードは絶対に記載しないでください。

```json
{
  "url": "https://YOUR_PROJECT_REF.supabase.co",
  "publishableKey": "sb_publishable_..."
}
```

新規のプロジェクト作成で無料枠上限に達した場合、他のプロジェクトを勝手に停止・削除せず、利用者が接続先またはプランを選択してください。空の設定 `{}` の間はゲスト利用を維持し、ログインは準備中と表示します。

## 2. SupabaseのURL Configuration

Authentication → URL Configuration → Redirect URLsに、次を**追加**します。

```text
https://amongushahahasus-sudo.github.io/annki/
```

新規の専用プロジェクトではSite URLにも同じURLを設定します。既存プロジェクトを共有する場合は、そのアプリのSite URLを上書きしないでください。アプリはGoogleログイン・登録確認・再設定の各リクエストに、明示的に上の戻り先を渡します。

GitHub Pagesでは `/auth/callback` のような新しいパスを使いません。`/annki/`でPKCEコールバックを処理するため、Pagesの404対策は不要です。

## 3. Googleログイン

Google Auth PlatformでWebアプリケーションのOAuthクライアントを作成します。

- Authorized JavaScript origins：`https://amongushahahasus-sudo.github.io`
- Authorized redirect URIs：`https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`

Supabase → Authentication → Sign In / Providers → Googleに、Client IDとClient Secretを入力して有効にします。秘密情報はGoogle／Supabaseの管理画面にだけ入力します。

全国向けに使う場合、GoogleのAudienceや公開ステータスも確認してください。Testingのままでは、登録されたテストユーザーに限定されます。既存のGoogleクライアントを使う場合は、既存設定を保持して必要なURLだけ追加してください。

アプリはプロジェクトの公開Auth設定でGoogleの有効状態を確認します。無効・状態未確認の間は、Googleログインが準備中であることを表示します。

## 4. メールアドレスでの登録・ログイン

Supabase → Authentication → Sign In / Providers → Emailを有効にし、メール確認を有効なままにします。

全国の利用者に登録確認・パスワード再設定メールを配信するには、Authentication → Emails → SMTP Settingsで**カスタムSMTP**を設定してください。Supabase標準SMTPはプロジェクトの組織メンバーなどに送信先が制限され、一般公開用のメール配信には使用できません。SMTPの送信元ドメイン認証も、配信プロバイダーの案内に従って設定します。

メール確認とパスワード再設定は標準テンプレートに対応しており、独自の6桁コード用テンプレートは不要です。Supabaseのメール確認を無効化して配信制限を回避することはしません。

## 保存とログアウト

- 認証セッションはSupabase SDKで管理し、アプリ専用のキーでブラウザに保存します。
- 教材はアカウント別のIndexedDBに保存します。既存のゲスト教材は元の保存領域を維持します。
- 「ゲストの教材をコピー」は明示的な操作でコピーし、元の教材を削除しません。
- ログアウトは現在の端末のセッションを終了します。他の端末を一括ログアウトさせません。
- 教材はログアウト後も端末に残ります。共用端末で教材自体を消したい場合は、ログアウト前に教材の削除を行ってください。
- 認証の戻り先URLに含まれる一時コードはService Workerのオフラインキャッシュへ保存しません。

## 検証

`npm run dev`を起動し、別のターミナルで`npm run test:auth`を実行します。Supabaseのレスポンスをブラウザ内で模擬し、本物のメールやGoogleアカウントへはアクセスしません。実際の配信・Google同意画面は、管理者の設定完了後に本人のアカウントで確認してください。

参考：[Google](https://supabase.com/docs/guides/auth/social-login/auth-google)、[メール認証](https://supabase.com/docs/guides/auth/passwords)、[URL設定](https://supabase.com/docs/guides/auth/redirect-urls)、[SMTP](https://supabase.com/docs/guides/auth/auth-smtp)。
