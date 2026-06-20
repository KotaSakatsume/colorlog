# バケツ2: Firebase 実装層を解禁するためのセットアップ手順（人間側）

このチェックリストを上から順に消化すると、**Mock のままだったアプリを「本物のクラウド」に接続できる状態**になり、バケツ3（Firebase 実装層）に着手できる。各ゲートは独立して進められるが、**ゲートB（Firebase プロジェクト）がバケツ3のクリティカルパス**。

実 SDK 54（Expo）/ RN 0.81 / React 19。iOS bundleId = `com.kosakats.colorlog`、scheme = `colorlog`。

## いま済んでいること（再掲・やらなくてよい）
- [x] セキュリティルール本体（`firestore.rules` / `storage.rules`）と `firebase.json`（emulator ポート: firestore 8080 / storage 9199）
- [x] rules テスト（`tests/rules/*.test.ts`）と `npm run test:rules` スクリプト
- [x] `GoogleService-Info.plist`（リポジトリには **gitignore 済み**＝コミットされない。ローカルには存在）
- [x] `app.json` の config plugin: `@react-native-firebase/app` / `@react-native-firebase/auth` / `expo-apple-authentication`、`ios.usesAppleSignIn: true`、`ios.googleServicesFile`
- [x] interface の継ぎ目: `AuthService.linkWithApple` / `ImageProcessor` / `UploadQueue`（Firebase 実装を差し込むだけの状態）

---

## ✅ ゲートA: rules テストを緑にする（ローカルのみ・Firebase アカウント不要）— 完了（2026-06-20）
**目的**: Issue #6 のセキュリティルールを実エミュレータで実行検証する。
**結果**: firebase-tools 15.22.0 + Temurin JDK 21 を導入し `npm run test:rules` を実行 → **2 suites / 45 tests 全 pass**（exit 0）。攻撃系の deny・正当系の allow がすべて成立し、未検証だった `map[key]` 存在ガードと `isHostAssigningColors` の挙動も実機で正しいことを確認（PR #7 の宿題は解消）。

再現手順（次の環境・CI 用）:
- [x] **firebase-tools を入れる**: `npm install -g firebase-tools`
- [x] **Java を入れる**（Firestore エミュレータが要求）。⚠️ `brew install --cask temurin` は管理者権限、`brew install openjdk` はこの環境（macOS Monterey/x86）で**ビットル不在によりソースビルドに落ち極めて遅い**。**プレビルト Temurin tarball が速い・sudo不要**:
  ```bash
  mkdir -p ~/.local/java
  curl -fL -o /tmp/temurin21.tar.gz "https://api.adoptium.net/v3/binary/latest/21/ga/mac/x64/jdk/hotspot/normal/eclipse"
  tar -xzf /tmp/temurin21.tar.gz -C ~/.local/java
  export JAVA_HOME="$(ls -d ~/.local/java/jdk-*/Contents/Home | head -1)"
  export PATH="$JAVA_HOME/bin:$PATH"
  java -version
  ```
- [x] **rules テストを実行**（emulator 起動→テスト→自動終了。ログイン不要。`test:rules` は `--project demo-colorlog` 指定済みでアカウント不要）:
  ```bash
  cd colorlog54 && npm run test:rules
  ```
  - 期待（達成済み）: 攻撃系（他人追放/host乗っ取り/memberIds改竄/期限切れ inviteCode/postCount>9/レート制限/Storage 1.5MiB・非jpeg）の deny と、正当系の allow がすべて pass。

---

## ゲートB: Firebase プロジェクト（バケツ3のクリティカルパス）
**目的**: 実 Auth / Firestore / Storage を有効化し、ルールをデプロイ。**Storage 利用には Blaze プラン必須（2025-10〜）だが無料枠は維持**（SPEC §13.1）。

- [ ] Firebase コンソールで**新規プロジェクト作成**。
- [ ] **iOS アプリを登録**（bundleId `com.kosakats.colorlog`）→ `GoogleService-Info.plist` をダウンロード。
  - 既存のローカル `GoogleService-Info.plist` が**この新プロジェクトのものか確認**。違えば差し替える（中身の `PROJECT_ID` / `BUNDLE_ID` を照合）。
- [ ] **Authentication** で「**匿名**」と「**Apple**」を有効化。
  - Apple は別途 Apple Developer 側で Sign in with Apple（Service ID・キー）の設定が要る。Firebase の Apple プロバイダ設定画面の指示に従う。
- [ ] **Firestore** を作成（本番モード）。**ロケーションは Storage と揃えて us-central1 推奨**。
- [ ] **Storage** バケットを **us-central1（us-central1/us-west1/us-east1 のみ無料枠）** で作成。日本リージョンは選ばない（SPEC §13.1）。
- [ ] **Blaze プラン**にアップグレード（Storage 有効化に必須。無料枠内なら請求 0 円）。
- [ ] **ルールをデプロイ**（リポジトリの rules をそのまま使える）:
  ```bash
  cd colorlog54
  firebase login
  firebase use --add        # 作成したプロジェクトを選ぶ（.firebaserc が作られる）
  firebase deploy --only firestore:rules,storage
  ```
- [ ] **予算アラート**を Google Cloud で月 ¥500 と ¥1,000 に設定（Firebase にハードキャップは無い・SPEC §13.3）。

---

## ゲートC: EAS Development Build（実機で動かす）
**目的**: `@react-native-firebase`・Apple 認証・カメラはネイティブコードを含み **Expo Go では動かない**。Development Build を作る（SPEC §11.3）。

- [ ] **eas-cli を入れてログイン**:
  ```bash
  npm install -g eas-cli
  eas login
  ```
- [ ] **EAS 設定を生成**（現状 `eas.json` が無い）:
  ```bash
  cd colorlog54
  eas build:configure
  ```
- [ ] **app.json の確認**（多くは設定済み）。Firebase/Apple プラグインと `googleServicesFile` は入っている。
  - ⚠️ **未設定**: 将来 `expo-camera` を実カメラ統合するとき、`expo-camera` の config plugin（カメラ権限文言）を `plugins` に追加する必要がある（現状 compose はスタブ画像なので未追加）。
- [ ] **開発用ビルドを作成**（クラウドでビルド）:
  ```bash
  eas build --profile development --platform ios
  ```
- [ ] 出力 QR / リンクから実機（または simulator）に Development Build アプリをインストール。
- [ ] 以降の開発: `npx expo start --dev-client` → その Development Build で読み込み（**ホットリロード有効**）。ネイティブ依存を変えた時だけ `eas build` し直す。

---

## ゲート通過後（バケツ3 = 私が回す）
継ぎ目はすべて interface 化済みなので、以下を順にパイプラインで差し込む:
1. **Firebase 実装層**（§9-5）: `FirebaseAuthService`（匿名 + `linkWithCredential` で Apple リンク）/ `FirebaseTripRepository`（`onSnapshot` 購読・`runTransaction` で色配布）/ `FirebasePostRepository`（promote トランザクション）。`context.tsx` の1か所差し替えで Mock→Firebase。
2. **Storage アップロード後半**（§9-7）: `ExpoImageProcessor`（実装済み）の出力を Storage へ。`UploadQueue` の `promotePhoto` 経路に画像生成＋アップロードを配線。
3. **App Check（App Attest）**（§13.3）: 正規アプリ以外からの Firestore/Storage アクセス遮断（青天井防御の本丸）。

これらは native/実クラウド検証が要るので、上記ゲート通過後に着手する。

## 補足
- 検証ポリシー: バケツ1まで「Mock + node jest」で完結検証してきたが、バケツ3は実機/エミュレータ検証に切り替わる。`tsc` は引き続き緑を保つ。
- `@react-native-firebase`（ネイティブ SDK）と Web 版 `firebase` JS SDK を**混在させない**（本体は前者で統一）。※ rules テストだけは `@firebase/rules-unit-testing`＋web SDK を使うが、これはテスト専用で本体実装とは別経路。
