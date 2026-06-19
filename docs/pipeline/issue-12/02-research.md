# 02 Investigator — 認証UI配線（匿名→Apple連携・Mock基盤）

Issue: #12
Stage: 2/5 Investigator

入力: `docs/pipeline/issue-12/01-design.md` のみ。実装はしない。
ベースライン（このコミット時点で計測）: **`npx jest` = 72 passed / 7 suites**、**`npx tsc --noEmit` = 0 エラー**。

---

## ベースライン（事実）

- `npx jest` → `Test Suites: 7 passed, 7 total` / `Tests: 72 passed, 72 total`。Issue 記載の 72 と一致。
- `npx tsc --noEmit` → exit 0、エラーなし。
- 既存テストファイル 7 本: `src/domain/invite-code.test.ts` / `merge-best-nine.test.ts` / `image-sizing.test.ts` / `assign-colors.test.ts` / `src/repositories/mock/mock-image-processor.test.ts` / `mock-post-repository.test.ts` / `mock-upload-queue.test.ts`。
- **`mock-auth-service` のテストは存在しない**（`mock-auth-service.test.ts` なし）。設計の新規テスト方針どおり新設になる。

---

## 確認事項への回答

### 確認1. `AuthUser` を生成/組み立てている全箇所（`isAnonymous` 必須化で型エラーになる対象）

`AuthUser` 型は `src/repositories/types.ts:21-25`。現在のフィールドは `uid: string; displayName: string; photoURL?: string;`。ここに `isAnonymous: boolean` を**必須**追加すると、`AuthUser` 型でアノテートされた値リテラルが全て型エラーになる。

**追従が必要（= `AuthUser` 型として組み立てている / 型エラーになる）箇所:**

| # | file:line | 現在のリテラル/コード | 対応 |
|---|-----------|----------------------|------|
| A | `src/repositories/mock/mock-auth-service.ts:4-7` | `export const MOCK_CURRENT_USER: AuthUser = { uid: 'me', displayName: 'あなた' }` | `isAnonymous: true` 追加（設計の初期匿名）。**事実**: ここが唯一の本番 `AuthUser` 生成元。 |
| B | `src/repositories/mock/mock-post-repository.test.ts:12-14` | `function makeUser(uid: string): AuthUser { return { uid, displayName: uid }; }` | 1関数集約。`isAnonymous: false`（または任意）を1箇所追加で全呼出カバー。 |

**事実: 上記 A・B 以外に `AuthUser` 型注釈付きのオブジェクトリテラル生成は存在しない**（`grep -rn "AuthUser" src/` 全件確認）。他の `AuthUser` 出現は型注釈・引数型・interface シグネチャのみ（`types.ts` の `host`/`user`、`mock-auth-service.ts` のフィールド/引数型、`context.tsx:39` の `useState<AuthUser>`、`mock-upload-queue.ts:15,198` の import/代入注釈、`mock-post-repository.test.ts:5` の import）で、いずれも `{}` リテラルを構築していないため**型エラーにならない**。

**設計が候補に挙げたが「型エラーにならない / 追従不要」と確定したもの（重要）:**

- **`mock-upload-queue.test.ts` の inline literal 4箇所**（L12, L115, L147, L423 の `user: { uid: 'owner', displayName: 'Owner' }`）→ これらは `makeInput()` 内ほかで構築される **`PromotePhotoInput`**（`types.ts:73-81`）の `.user` ではなく、**`UploadJob`**（`domain/types.ts:89-99`）の `.user` フィールド。**`UploadJob.user` は `AuthUser` ではなく独立した構造型** `{ uid: string; displayName: string; photoURL?: string }`（`domain/types.ts:93`、コメントに「AuthUser 全体」とあるが**型としては AuthUser を参照していない**）。L12 は `makeInput()` 内で `PromotePhotoInput` だが、`PromotePhotoInput.user: AuthUser`（`types.ts:75`）。— 要・現物確認。下記「注意点」参照。
- **`mock-upload-queue.test.ts:12`** は `makeInput(): PromotePhotoInput` の中なので `.user` は `AuthUser`。**ここは型エラーになる**。L115/L147/L423 は `makeJob()` 等で `UploadJob` を作っており `UploadJob.user`（非 AuthUser）なら型エラーにならない。**Implementer は 4箇所それぞれが `PromotePhotoInput.user`(=AuthUser, 追従要) か `UploadJob.user`(=独立型, 追従不要) かを `tsc` 実行で確定すること**（下記リスク3）。
- **`mock-upload-queue.ts:67`** の `user: { uid, displayName, photoURL }` → `UploadJob` 構築。`UploadJob.user`（`domain/types.ts:93`）は非 AuthUser。**追従不要**。
- **`merge-best-nine.test.ts:31`** の `user: { uid: userId, displayName: userId }` → `makeJob(): UploadJob` 内（`merge-best-nine.test.ts:22-27`）。`UploadJob.user`、非 AuthUser。**追従不要**。
- **`mock-trip-repository.ts:72` / `:122`** → `Trip.members[uid]` の **`TripMember`** 構築（`createTrip`/`joinTrip` 内、`input.host`/`input.user` の `AuthUser` から `.displayName`/`.photoURL` を**読み出して** TripMember を作る）。**AuthUser を構築していない＝追従不要**。設計の「TripMember であり影響なし」判定は**正しい（確定）**。
- **`assign-colors.test.ts:21`** の `members[uid] = { displayName: ... }` → `Trip['members']`（TripMember）。**追従不要**。
- **`mock-post-repository.test.ts:27`** の `members: { [uid]: { displayName, color, postCount } }` → TripMember。**追従不要**。
- **`seed.ts:72-161`** の `members` 群、`mock-backend.ts:151` の `uid` 引数 → AuthUser でない。**追従不要**。

**`AuthUser` を引数に取る経路（`CreateTripInput.host`/`JoinTripInput.user`/`PromotePhotoInput.user`/`ToggleReactionInput.user`）経由の生成:**
- 画面側で渡している実体は全て `useCurrentUser()` の戻り値（= MockAuthService の内部 user、A 由来）。新規リテラルを作っていない: `create.tsx:48,101`（`host`）、`join.tsx:16,36`（`user`）、`compose.tsx`/`use-reactions.ts` は `useCurrentUser()` 経由。**画面側に AuthUser リテラルなし＝追従不要**。

**結論（確認1）**: tsc を必ず赤にする追従必須は **A（MOCK_CURRENT_USER）と B（makeUser）の 2 箇所が確実**。加えて **`mock-upload-queue.test.ts` の `PromotePhotoInput` を作る箇所**（少なくとも L12 の `makeInput`）が AuthUser 経路のため要対応。Implementer は型追加後 `tsc` で赤になった行を機械的に潰すのが安全（全リテラルは上表で把握済み）。

---

### 確認2. `auth`（AuthService）を直接触る箇所

- `useCurrentUser()` 定義: `src/repositories/context.tsx:36-42`（`const { auth } = useRepositories()` → `auth.getCurrentUser()` + `auth.subscribe(setUser)`）。
- **`auth` メソッドを直接呼ぶ画面は `src/app/profile/edit.tsx:16,45` のみ**（`const { auth } = useRepositories()` → `auth.updateProfile(...)`）。**事実**: `grep -rn "updateProfile" src/` でヒットするのはこの1画面 + interface 定義 + mock 実装のみ。
- `useCurrentUser` の利用箇所（状態購読のみ、`auth` メソッドは呼ばない）: `create.tsx:48`、`join.tsx:16`、`profile.tsx:16`、`profile/edit.tsx:17`、`compose.tsx`、`use-trips.ts`、`use-reactions.ts`（import 確認済み: `grep`）。
- **結論**: 設計の「`auth` を直接触るのは現状 `profile/edit.tsx` の `updateProfile` のみ」は**正しい**。新規導線は各画面で `const { auth } = useRepositories()` を足して `auth.linkWithApple()` を呼ぶ形が既存パターン（edit.tsx）と一致。`useAuth` 新規 hook は不要、という設計の却下判断も裏付けあり。

---

### 確認3. create.tsx / join.tsx / profile.tsx の現状構造と CTA 差し込み位置

**`UIButton` props（`src/components/ui-button.tsx:6-15`）**: `title`(必須) / `onPress?` / `variant?: 'primary'|'secondary'`(既定 primary) / `disabled?`(既定 false) / `loading?`(既定 false、true で `ActivityIndicator` 表示＆`disabled||loading` で押下不可) / `color?`(背景色明示) / `style?: ViewStyle`。
→ 設計が要求する `loading`（連携中スピナー）は**既存サポート済み**。`secondary`（枠線）も既存。**新規 props 追加不要**。

**create.tsx**（`src/app/trip/create.tsx`）:
- `useCurrentUser()` を `host` として使用済み（L48）。`ScrollView`（L111）あり、`keyboardShouldPersistTaps="handled"`。
- 末尾に注意書き `note`（L157-159）→ `UIButton title="作成する"`（L161-166, `style={styles.submit}`）。
- **CTA 自然挿入点**: `note`（L159）の前後、または `submit` ボタンの上。`styles.submit: { marginTop: Spacing.four }`。匿名時のみ表示する非ブロッキング CTA を `note` の直後・送信ボタン直前に置くのが構造上自然。

**join.tsx**（`src/app/trip/join.tsx`）:
- `useCurrentUser()` を `user` として使用済み（L16）。**`ScrollView` ではなく `View`**（L46, `styles.content`）。
- `hint`（L62-64）→ `UIButton title="参加する"`（L65, `style={styles.submit}`）。
- **CTA 自然挿入点**: `hint` の後・`参加する` ボタンの前。内容が短い画面なので `View` のままで収まる（要素追加で溢れる懸念は低いが、CTA + テキストを足すなら `ScrollView` 化も一案。設計スコープ ~15行なので最小で）。

**profile.tsx**（`src/app/(tabs)/profile.tsx`）:
- `useCurrentUser()` を `user` として使用（L16）。`ScrollView`（L22）内 `profileHeader`（L23-42）に avatar / displayName / トリップ件数 / 「プロフィールを編集」`UIButton`（L37-41, `style={styles.editBtn}`）。
- `styles.profileHeader: { alignItems: 'center', gap: 6, paddingVertical: Spacing.four }`、`editBtn: { marginTop: Spacing.two, alignSelf: 'stretch' }`。
- **連携状態表示＋ボタン挿入点**: `profileHeader` 内、「プロフィールを編集」ボタン（L41）の直後が自然。`editBtn` と同じ `alignSelf: 'stretch'` + `marginTop: Spacing.two` 系スタイルで整合。`user.isAnonymous` で分岐（匿名: 「Apple で連携」ボタン / 連携済み: 状態テキスト等）。`ThemedText type="small" themeColor="textSecondary"` が既存の補助テキスト書式。

---

### 確認4. `expo-apple-authentication` の現状 import

- **事実: `src/` 配下で `expo-apple-authentication` / `AppleAuthentication` を import している箇所は存在しない**（`grep -rni "apple"` の全ヒット = `src/global.css:3` の CSS `Apple Color Emoji`(フォント) と `mock-auth-service.ts:3` の**コメント**のみ。コード import なし）。
- **隔離は成立する**: 設計どおり画面・Mock・domain は `expo-apple-authentication` を import せず `@/components/ui-button` の `UIButton` のみ使えば、node jest 環境（native module 不要）を壊さない。`package.json` に同パッケージが入っていなくても本 Issue のコードはコンパイル/テスト可能。

---

### 確認5. 既存 `mock-auth-service` テストと新規テストの作法・置き場所

- **`mock-auth-service` のテストは無し**（新規 `src/repositories/mock/mock-auth-service.test.ts` を作る）。
- **テスト作法（既存パターン）**: `mock-post-repository.test.ts:1` / `mock-upload-queue.test.ts:1` ともに `import { describe, expect, it } from '@jest/globals'`（upload-queue は `beforeEach, afterEach, jest` も）。`describe`/`it` 構成。クラスを直接 `new MockXxx()` してメソッドを叩くスタイル（`mock-post-repository.test.ts` 参照）。
- **置き場所**: 対象実装の隣（`src/repositories/mock/` 配下、`*.test.ts`）。jest 設定はこの配置を拾っている（既存 7 本がこの規約）。
- **subscribe テストの参考**: `MockAuthService.subscribe`（`mock-auth-service.ts:35-41`）は登録直後に現在値を即時通知 → リスナーで初期値を受ける挙動を検証可能。`updateProfile`（L21-33）が `listeners.forEach` で通知する既存経路に `linkWithApple` を相乗りさせる方針なので、同じ「リスナー記録 → 呼出 → 通知回数/値」パターンでテストできる。

---

### 確認6. Implementer の落とし穴（リスク箇所）

#### リスク1（tsc 赤・追従漏れ）: `AuthUser` 必須化の波及を取りこぼす
- 根拠: `AuthUser` 生成は確認1の通り **A: `mock-auth-service.ts:4`、B: `mock-post-repository.test.ts:12`、C: `mock-upload-queue.test.ts` の `PromotePhotoInput` を作る箇所（L12 ほか）** に分散。`UploadJob.user`（非 AuthUser, `domain/types.ts:93`）と紛らわしく、**同じ `{ uid, displayName }` リテラルでも型が AuthUser か UploadJob.user かで追従要否が分かれる**。
- 落とし穴: 「`{ uid, displayName }` を全部直す」と過剰修正すると `UploadJob.user` に余分な `isAnonymous` が付き、`UploadJob` は JSON 永続化前提（`domain/types.ts:86`）なので無関係なフィールド混入になる。逆に AuthUser 経路を漏らすと tsc 赤。
- 対策: 型追加後に **必ず `npx tsc --noEmit` を実行し、赤になった行だけ**修正（上表で全リテラル位置は特定済み）。`UploadJob.user` には触らない。

#### リスク2（仕様判断・既存編集の消失）: `linkWithApple` の displayName ソース判定
- 根拠: 設計（01 L50）は「初期値（`'あなた'`）のときだけ Apple 名に更新、それ以外（ユーザー編集済み）は維持」。初期値は `MOCK_CURRENT_USER.displayName = 'あなた'`（`mock-auth-service.ts:6`）。
- 落とし穴: (a) 無条件で Apple 名に上書きすると、`profile/edit.tsx:45` の `updateProfile` で名前変更済みユーザーの編集が消える。(b) 判定基準を**ハードコードの `'あなた'` 文字列等価**に依存するため、初期値定数を変えると静かに壊れる。比較対象は `MOCK_CURRENT_USER.displayName` を参照すべき（マジック文字列重複を避ける）。
- 対策: `this.user.displayName === MOCK_CURRENT_USER.displayName` のときだけ Apple 名（Mock 固定文字列）に更新、それ以外は維持。冪等（`isAnonymous === false` なら no-op で現 user 返却）も忘れない。

#### リスク3（通知重複・テスト手薄）: subscribe 相乗りと CTA 条件分岐
- 根拠: `linkWithApple` は `updateProfile` と同じ `this.listeners.forEach((fn) => fn(this.user))`（`mock-auth-service.ts:32`）経路に乗せる方針。`useCurrentUser`（`context.tsx:40`）は `auth.subscribe(setUser)` で購読し `setUser` を呼ぶ。
- 落とし穴: (a) `linkWithApple` 内で displayName 更新と isAnonymous 更新を別々に通知すると**通知2回**＝再描画/重複の温床。1回の状態確定後に1回だけ通知すること。(b) **`mock-auth-service` は現状テストゼロ**（確認5）＝この新メソッドの「false 化／displayName 維持・更新／冪等／通知1回」は完全に新規カバレッジで、書かなければ回帰検出ゼロ。(c) 画面 CTA は `user.isAnonymous` 分岐。`isAnonymous` を optional でなく必須にした（設計トレードオフ）ので未定義参照は起きないが、**3画面（create/join/profile）で分岐ロジックが重複**しやすい。非ブロッキング（未連携でも作成/参加可、設計やらないこと#3）を壊さないよう、CTA は送信ボタンを `disabled` にしない別要素として置くこと。
- 対策: `linkWithApple` は内部 user を1回確定 → 1回通知。新規 `mock-auth-service.test.ts` で「初期 isAnonymous=true / 連携後 false / displayName 初期値→Apple名・編集済み→維持 / 冪等(2回目 no-op・同一参照) / 通知が走る」を網羅。CTA は匿名時のみ表示、送信ボタンの disabled には連動させない。

---

## 参考前例（既存コミット・類似実装）

1. **`profile/edit.tsx` の `updateProfile` 配線**（`src/app/profile/edit.tsx:16,45`）: `const { auth } = useRepositories()` → `auth.updateProfile(...)` → `subscribe` 経由で `useCurrentUser` が再描画。**`linkWithApple` 配線の直接の手本**（同じ DI・通知経路）。
2. **`MockAuthService.updateProfile` の通知実装**（`mock-auth-service.ts:21-33`）: `next` を作り `this.user = next` → `listeners.forEach`。`linkWithApple` はこの構造をコピーすれば1回通知が自然に守れる。
3. **UploadQueue 導入 PR（コミット `9c60e07`）/ セキュリティルール PR（`737c958`）**: 1 PR で実装 + 隣接 `*.test.ts` 追加 + tsc/jest グリーン維持、という本リポジトリの開発作法の前例。新規テストは実装隣に置く規約もこれらで確立。

---

## 事実と推測の分離

**事実（file:line 裏付けあり）**:
- `AuthUser` 型定義は `types.ts:21-25`、`isAnonymous` なし。
- `AuthUser` 型注釈付きリテラル生成は `mock-auth-service.ts:4`(MOCK_CURRENT_USER) と `mock-post-repository.test.ts:12`(makeUser) の 2 箇所のみ。
- `UploadJob.user`（`domain/types.ts:93`）と `Trip.members`/`TripMember` は `AuthUser` と別型 → `isAnonymous` 追加の影響を受けない。
- `expo-apple-authentication` の import は src/ に皆無（コメント/CSSフォントのみ）。
- `auth` メソッドの直接呼出は `profile/edit.tsx` の `updateProfile` のみ。
- `UIButton` は `loading`/`disabled`/`variant`/`color`/`style` を既にサポート。
- ベースライン jest 72 pass、tsc 0。
- `mock-auth-service.test.ts` は存在しない。

**推測（実装時に確定が必要・本ドキュメントの判断）**:
- 「`mock-upload-queue.test.ts` L12/115/147/423 のうち `PromotePhotoInput.user`(AuthUser) 経路がどれか」は、`makeInput`(PromotePhotoInput) vs `makeJob`(UploadJob) の使い分け次第。型追加後の `tsc` 実行で確定すべき（記憶でなくコンパイラに判定させる）。
- 「subscribe 相乗りで通知が二重化しうる」は updateProfile の構造からの推論。`linkWithApple` を1回通知で実装すれば回避可能（実装で確定）。
- join.tsx は現状 `View`。CTA + 説明文を足して溢れるかはレイアウト実測次第（`ScrollView` 化要否は Implementer 判断）。
