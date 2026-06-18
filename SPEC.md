# Colorlog — 実装仕様書（React Native + Expo 版）

旅行中に各メンバーへランダムに色を割り当て、その色に合う景色を撮影してリアルタイムに共有する iOS / Android アプリ。

このドキュメントは Claude Code で実装を進めるための引き継ぎ仕様。プロジェクトルートに `SPEC.md` として置いて参照すること。

---

## 1. コンセプトと確定した設計判断

- **色の判定**: 人間の主観に任せる。写真の自動色解析はやらない。
- **共有**: クラウドでリアルタイム同期。
- **色の割り当て**: ランダム配布（ゲーム性重視）。配布は主催者が1回だけ実行。
- **思い出を残す**: トリップ終了後もアルバムとして永続的に残る。
- **ベスト9（中核要件）**: 撮影は撮り放題（端末内のみ、クラウド外）。各メンバーは自分の色の写真を **3×3 = 9枚まで** アプリに公開できる。9枚はユーザーが選び抜く「ベスト9」。9枠が埋まった後は **差し替え式**（新しく1枚を昇格させると、入れ替えた1枚はクラウドから削除）。これにより1人あたりの保存・配信コストが9枚で固定され、コストがユーザー数に正比例するだけになる（1人あたりは増えない）。

---

## 2. 技術スタック

| 領域 | 採用 | 備考 |
|---|---|---|
| フレームワーク | Expo (SDK 最新) + React Native | TypeScript で実装 |
| 言語 | TypeScript (strict) | |
| ルーティング | Expo Router | ファイルベースルーティング |
| 認証 | Firebase Auth + `expo-apple-authentication` | 匿名で開始 → 作成/参加時に Apple へリンク |
| DB | Firestore（`@react-native-firebase/firestore`） | リアルタイム購読 + オフラインキャッシュ |
| 画像保存 | Firebase Storage（`@react-native-firebase/storage`） | 2サイズ生成してアップロード |
| カメラ/写真 | `expo-camera` / `expo-image-picker` | |
| 画像加工 | `expo-image-manipulator` | リサイズして2サイズ生成 |
| ローカル保存 | `expo-file-system` + `@react-native-async-storage/async-storage` | 送信キューの永続化 |
| 状態管理 | Zustand または React Context | リポジトリ注入に使う |

**重要: Expo Go では完結しない。**
`@react-native-firebase/*`、`expo-apple-authentication`、`expo-camera` のネイティブ機能はカスタムネイティブコードを含むため、App Store 版の Expo Go では動かない。**Development Build（`eas build` で自前ビルドした開発版アプリ）を使う。** 詳細はセクション11。

---

## 3. アーキテクチャ（4層・依存は一方通行）

```
画面 (Expo Router screens + components)   状態を表示するだけ。ロジックを持たない
  ↓
ストア / ロジック (Zustand store / hooks)  画面の状態と操作。interface 経由でデータ取得
  ↓
Repository (TypeScript interface)          TripRepository / PostRepository / AuthService / UploadQueue
  ↓
実装                                       Firebase 実装 と Mock 実装（Storybook・テスト用）を差し替え可能
```

**重要な原則**
- ストア/フックは TypeScript の `interface`（例: `TripRepository`）だけに依存し、Firebase を直接 import しない。
- これにより Mock 実装で UI 確認とユニットテストが Firebase なしで動く。
- リアルタイム同期: リポジトリが Firestore の `onSnapshot` リスナーを購読し、コールバック or `AsyncGenerator` で上位へ流す。React 側は `useEffect` で購読し state を更新。

---

## 4. データモデル（Firestore）

### `trips/{tripId}`
メンバーはサブコレクションにせず**ドキュメント内に内包**する（配布をトランザクション1発にするため。メンバー上限12人なのでサイズ問題なし）。

```ts
type Trip = {
  name: string;
  startDate: Timestamp;
  endDate: Timestamp;
  hostUserId: string;
  status: "planning" | "active" | "finished";
  colorsAssigned: boolean;
  memberIds: string[];                 // セキュリティルール判定用の配列
  members: Record<string, {            // マップで内包
    displayName: string;
    photoURL?: string;
    color?: { hex: string; name: string };  // 配布後に入る
    postCount?: number;                      // 公開中の枚数（0〜9）。ルールで上限強制
    lastPostAt?: Timestamp;                  // 連投レート制限用
  }>;
};
```

### `trips/{tripId}/posts/{postId}`
投稿は無制限に増えるのでサブコレクションが正解。

```ts
type Post = {
  userId: string;
  color: { hex: string; name: string };
  caption: string;
  thumbURL: string;     // 400px サムネ
  imageURL: string;     // 長辺1600px 本画像
  createdAt: Timestamp;
  slotIndex: number;    // 0〜8。ベスト9グリッド上の位置
};

// ベスト9の仕組み:
//  - 撮影した写真は端末（カメラロール / expo-file-system）にだけ残る = 撮り放題・クラウド外
//  - アプリ内のローカル「候補」から昇格させた写真だけが Firebase にアップロードされる
//  - 1メンバーにつき posts は最大9件（slotIndex 0〜8）
//  - 差し替え: 9枠が埋まった状態で昇格させると、対象スロットの旧 Post と
//    その Storage 画像（imageURL / thumbURL）を削除してから新しい Post を書く
```

### `inviteCodes/{code}`
未参加者がトリップを引くためのルックアップ用。

```ts
type InviteCode = { tripId: string; expiresAt: Timestamp };
```

---

## 5. 解決済みの設計上の落とし穴（実装で踏まないこと）

1. **色配布のレースコンディション** → メンバーを trip ドキュメントに内包し、**単一ドキュメントの Firestore トランザクション**（`runTransaction`）で「未配布なら全員分の色を書く」。二重配布が原理的に起きない。Cloud Functions 不要。

2. **招待コードのデッドロック**（メンバーしか trip を読めないが未参加者は読めない）→ `inviteCodes/{code}` は認証済みなら誰でも読める。そこから tripId を得て、自分を `memberIds` と `members` に追加する書き込みだけを許可する。

3. **匿名認証のデータ消失** → 作成/参加の時点で `linkWithCredential` を使い Apple 認証へリンク。機種変更してもアルバムが残る。

4. **オフライン**（旅行中は圏外が多い）→ 2段階投稿。
   1. 撮影したらローカル（`expo-file-system`）に保存し、即フィードに「送信中」表示
   2. 電波が戻ったらバックグラウンドでアップロード
   3. 成功したら Firestore に書き込み
   `UploadQueue` がこれを担当。キューは AsyncStorage に永続化し、アプリ再起動後も再開できるようにする。撮る体験とアップロードを分離する。

5. **画像が重い** → `expo-image-manipulator` で長辺2048pxの本画像と400pxサムネを生成。フィードはサムネのみ、タップで本画像ロード。

6. **配布後の途中参加** → 配布済みトリップへの参加時は、残り色プールから自動で1色付与するルール。

7. **ベスト9の差し替えで起きうる不整合** → 「旧画像の削除」と「新 Post の書き込み」が途中で失敗すると、枠が壊れる or 孤児画像が残る。対策:
   - Firestore 側は trip ドキュメントの `members[uid].postCount` 更新と post 書き込みを **トランザクション**で行い、`postCount <= 9` を不変条件として守る。
   - Storage の旧画像削除は **Firestore コミット成功後**に行う（先に消すとロールバック不能になるため）。削除失敗は孤児画像になるだけでデータ整合は保たれる。孤児は許容するか、後述の定期クリーンで回収。
   - 昇格フローの順序: ①新画像を新パスにアップロード → ②トランザクションで旧 Post を新 Post に置換 + postCount 調整 → ③成功後に旧画像を削除。
   - **差し替え対象はユーザーが明示選択**（自動押し出し禁止）。compose 画面で現在のベスト9を提示し、入れ替える1枚を選ばせる。選んだ写真は削除される旨を確認ダイアログで明示してから実行。これにより意図しない削除を防ぐ。
   - 実装上は「差し替え対象の slotIndex」を引数に取る単一の `promotePhoto(slotIndex, newImage)` を用意し、空き枠への追加（postCount < 9）も差し替え（postCount == 9）も同じ経路で扱う。空き枠なら削除ステップをスキップするだけ。

---

## 6. 色プール

- 見分けやすい12色を定義。色相だけで分けない。
- **各色に必ず日本語名ラベルを併記**（色覚多様性対応）。例: あか / やまぶき / みどり / みずいろ …
- TypeScript では `type AssignedColor = { hex: string; name: string }` として最初からペアで定義。定数配列 `COLOR_POOL: AssignedColor[]` を1か所に置く。UI でも色＋名前のペアで表示する。

---

## 7. セキュリティルール（骨子）

```
match /trips/{tripId} {
  allow read: if request.auth.uid in resource.data.memberIds;
  allow update: if isMember() || isJoiningSelf();  // 自分の追加のみ許可
  match /posts/{postId} {
    allow read: if isMember();
    allow create: if isMember()
                  && request.resource.data.userId == request.auth.uid;
  }
}
match /inviteCodes/{code} {
  allow read: if request.auth != null;   // 参加のために誰でも読める
}
```
`isJoiningSelf()` は「memberIds への追加が自分の uid のみ」かを検証する関数として実装。

---

## 8. 画面構成（7画面・Expo Router）

ファイルベースルーティングで以下を構成する。

1. **ホーム** `app/(tabs)/index.tsx` — 参加中／過去のトリップ一覧
2. **トリップ作成** `app/trip/create.tsx` — 名前・期間入力、招待コード生成
3. **参加** `app/trip/join.tsx` — 招待コード入力
4. **トリップ詳細（メイン）** `app/trip/[id]/index.tsx` — 自分の色を大きく表示 + 撮影ボタン + 自分のベスト9（3×3グリッド、空きスロットは「＋」表示）
5. **カメラ／候補** `app/trip/[id]/compose.tsx` — 撮影（撮り放題・端末保存）→ ローカル候補一覧 → ベスト9へ昇格する写真を選択 → キャプション → アップロード。**9枠が埋まっている場合は、現在のベスト9を3×3で見せ、入れ替える1枚をユーザーがタップで選ぶ**（自動押し出しはしない）。入れ替え対象には「この写真は削除されます」と明示し、確認してから実行する。
6. **アルバム** `app/trip/[id]/album.tsx` — 各メンバーのベスト9（3×3）を色ごとに並べたパレット表示。4人なら 4×9 のカラフルなグリッド
7. **メンバー一覧** `app/trip/[id]/members.tsx` — 誰がどの色か

---

## 9. 推奨する実装順序

1. **型定義**: `Trip`, `Member`, `AssignedColor`, `Post`, `InviteCode` と `COLOR_POOL` 定数
2. **Repository interface** と **Mock 実装**（Firebase なしで動く状態を先に作る）
3. **色配布トランザクション**（核ロジック。ユニットテスト必須）
4. 画面をモックデータで構築（Mock リポジトリを注入してプレビュー駆動）
5. **Firebase 実装**を interface に差し込む
6. **UploadQueue**（オフライン送信キュー。AsyncStorage 永続化）
7. 画像2サイズ生成 + Storage アップロード
8. セキュリティルール記述とエミュレータでのテスト

---

## 10. テスト方針

- **ユニット**: Jest + `@testing-library/react-native`。
- 色配布トランザクション: 二重配布が起きないこと、12人を超えないこと、途中参加で残り色が付くことを Mock でテスト。
- Repository: interface に対して Mock を注入しストア/フックをテスト。
- セキュリティルール: Firebase エミュレータ（`@firebase/rules-unit-testing`）で「非メンバーは読めない」「自分以外を追加できない」を検証。

---

## 11. セットアップ手順（Claude Code 用）

### 11.1 プロジェクト作成
```bash
npx create-expo-app irohunt
cd irohunt
npx expo install expo-router expo-camera expo-image-picker expo-image-manipulator expo-file-system expo-apple-authentication
npx expo install @react-native-firebase/app @react-native-firebase/auth @react-native-firebase/firestore @react-native-firebase/storage
npm install @react-native-async-storage/async-storage zustand
npm install -D jest @testing-library/react-native @firebase/rules-unit-testing
```

### 11.2 Firebase プロジェクト準備（手動・人間が行う）
- Firebase コンソールで新規プロジェクト作成
- iOS アプリを登録し `GoogleService-Info.plist` を取得
- （Android も使うなら）`google-services.json` を取得
- Authentication で「匿名」と「Apple」を有効化
- Firestore と Storage を有効化

### 11.3 EAS / Development Build（重要）
Expo Go では `@react-native-firebase` と Apple 認証が動かないため Development Build を使う。
```bash
npm install -g eas-cli
eas login
eas build:configure
# 開発用ビルドを作成（クラウドでビルドされる）
eas build --profile development --platform ios
```
- ビルド完了後、出力された QR / リンクから実機（または simulator）に Development Build アプリをインストール。
- 以降は `npx expo start --dev-client` で起動し、その Development Build アプリで読み込む。**ホットリロードは効く。**
- `app.json` / `app.config.ts` に `expo-apple-authentication`、`@react-native-firebase` 系の config plugin と、`GoogleService-Info.plist` のパスを設定すること。

### 11.4 確認サイクル
日々の開発は `npx expo start --dev-client` → 実機で読み込み → 保存で即反映。
ネイティブ依存（新しいライブラリ追加など）を変えたときだけ `eas build` で Development Build を作り直す。

---

## 12. 注意点まとめ

- **Expo Go 単体では完結しない**。Firebase ネイティブ SDK と Apple 認証のため Development Build が前提。最初にここをセットアップしてから実装に入ること。
- `@react-native-firebase`（ネイティブ SDK）と Web 版 `firebase` JS SDK を混在させない。本仕様は前者で統一。
- 設計の頭脳部分（4層・データモデル・色配布トランザクション・6つの落とし穴対処）は言語非依存。実装言語が変わっても判断は変えないこと。

---

## 13. コスト設計（無料枠内で運用するための必須事項）

### 13.1 前提（2026年時点の Firebase 料金体系）
- Cloud Storage for Firebase の利用には **Blaze プラン（従量課金）への登録が必須**（2025年10月〜）。ただし Blaze でも無料枠は維持され、枠内なら請求 0 円。
- **Storage の無料枠は US リージョン（us-central1 / us-west1 / us-east1）のバケットのみ**。保存 5GB + ダウンロード約 1GB/日。
- Firestore 無料枠: 保存 1GiB、読み取り 5 万/日、書き込み 2 万/日。
- **決定: Storage バケットは us-central1 に作成する。** 日本リージョンは選ばない（無料枠がない）。

### 13.2 コスト構造（大きい順）
1. 画像ダウンロード帯域（フィード閲覧）
2. 画像保存容量
3. Firestore 読み取り（リアルタイム購読）

**ベスト9により1人あたりのコストは固定される。** 公開枚数が最大9枚なので、保存・配信は「ユーザー数 × 9枚」で線形にしか増えない。1人あたりが増えないため、ヘビーユーザーによるコスト暴走が原理的に起きない。

目安: 1メンバー = 9枚 × (本画像300KB + サムネ25KB) ≈ 2.9MB。1トリップ4人 ≈ 12MB。
- 保存5GB無料枠 ≈ 約1,700メンバー分（約425トリップ）が常時保存できる。
- トリップ終了後に本画像をアーカイブ（後述13.5）すればさらに伸びる。

### 13.3 実装で守るコスト規律
- **画像予算**: 本画像は長辺 1600px・JPEG 品質 0.7（約300KB目安）。サムネ 400px（約25KB）。フィードはサムネのみ表示、タップで本画像。
- **アップロードサイズ上限を Storage ルールで強制**: `request.resource.size < 1.5 * 1024 * 1024` と contentType が image/jpeg であることを検証。
- **端末キャッシュ**: 画像表示は `expo-image` を使い、ディスクキャッシュ有効。同じ画像は端末ごとに1回しかダウンロードしない。
- **Firestore 読み取り削減**:
  - フィード購読は `orderBy(createdAt, desc) + limit(50)`。過去分はページネーションで明示ロード。
  - トリップの購読リスナーはアプリ層（Zustand store）で1本に共有。画面遷移ごとに張り直さない（初期読み取りの再発防止）。
  - メンバー情報は trip ドキュメント内包（既定）— 全メンバー分が1読み取りで済む。
- **悪用対策（青天井事故の主因はこちら）**:
  - **App Check（App Attest）を必須化**。正規アプリ以外からの Firestore / Storage アクセスを遮断。
  - セキュリティルールで強制: メンバー上限12人、**1メンバーの公開枚数上限9枚（postCount <= 9 を不変条件に）**、キャプション文字数上限（例: 200字）、投稿レート制限（members マップに lastPostAt を持たせ、前回投稿から最低10秒を検証）。
  - **撮影とアップロードの分離**: 撮影は端末内のみ（クラウドコスト0）。Firebase に乗るのはベスト9に昇格した瞬間だけ。これが最大のコスト防衛策。
  - inviteCodes は expiresAt 超過を読み取り拒否。
- **予算アラート**: Google Cloud の予算アラートを月 ¥500 と ¥1,000 で設定（手動・人間が行う）。Firebase にはハードキャップ機能がないため、アラート受信時に手動対応する運用とする。

### 13.4 スケール時の脱出口
帯域コストが無料枠を大きく超えたら、画像のみ Cloudflare R2（ダウンロード帯域無料）へ移行する。リポジトリ層で Storage を隔離済みのため、`PostRepository` の実装差し替えで完結し、画面側のコードは変更不要。

### 13.5 保存容量を保つ運用（任意・スケール時）
- **終了トリップのアーカイブ**: status が finished のトリップは本画像を低品質（例: 長辺1024px）に再エンコードして置き換え、サムネはそのまま。アルバム閲覧体験を保ちつつ保存量を圧縮。
- **孤児画像のクリーン**: ベスト9差し替えで削除に失敗した孤児画像は、Storage パスを `trips/{tripId}/{uid}/{postId}` の規約に揃えておき、Firestore に対応 post がないものを定期的に洗い出して削除（手動スクリプト or 月1のメンテで十分）。