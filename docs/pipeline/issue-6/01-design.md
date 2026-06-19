# セキュリティルール（Firestore/Storage）＋ rules-unit-testing 設計

Issue: #6
Stage: 1/5 Architect

## 方針（1行）

`firestore.rules` / `storage.rules` を SPEC §4 データモデルに正確対応で新規記述し、エミュレータ前提の rules テストを **`tests/rules/` に隔離 + `jest.rules.config.js`（別config）+ `npm run test:rules`（`firebase emulators:exec` 経由）** に分離して、既存 jest 49件・`tsc --noEmit` 0 を不変に保つ。実 Firebase 実装層・App Check・エミュレータ環境構築はやらない。

## 設計方針（5-7行）

- **ルール構造**: `firestore.rules`（`rules_version='2'`）に `match /trips/{tripId}`（read/update）, ネストした `match /posts/{postId}`（read/create）, `match /inviteCodes/{code}`（read）を置く。ヘルパは `function isMember()` / `function isJoiningSelf()` を `/trips/{tripId}` スコープに定義。`storage.rules` は `match /trips/{tripId}/{uid}/{postId}` に write 条件のみ。
- **データフロー対応**: SPEC §4 の `trips` は members を内包し `memberIds: string[]`（ルール判定用配列）と `members: map`（postCount/lastPostAt 内包）を持つ。read 判定は安価な `memberIds` 配列で行い、`postCount<=9` とレート制限は `members[uid]` マップの **trip update 側**で検証する（後述の落とし穴参照）。
- **主要インターフェース（ルール関数）**: `isMember() = request.auth.uid in resource.data.memberIds`。`isJoiningSelf()` = memberIds への差分追加が「自分の uid 1件のみ」かつ既存要素不変、を集合演算で検証。
- **DB/スキーマ変更**: なし（ルール層の追加のみ。Mock 実装・ドメイン型・既存テストには一切触れない）。
- **テスト分離**: rules テストは Web 版 `firebase`（v12, rules-unit-testing の peer として node_modules に既存）+ `@firebase/rules-unit-testing@5` で書き、`tests/rules/**` に置く。既存 `jest.config.js` の `testMatch` は `src/` 配下しか実害が無いが、念のため `testPathIgnorePatterns` に `tests/rules` を追加して二重防御。実行は別 config 経由のみ。
- **エラーハンドリング方針**: ルールは「明示的に許可した条件以外は全 deny」。テストは `assertSucceeds` / `assertFails` で正常系・拒否系を両方アサートする。

## 採用理由とトレードオフ

- **採用: rules テストを別ディレクトリ + 別 jest config + `emulators:exec` script に分離**。理由: エミュレータ接続が必須なテストをデフォルト `npm test` に混ぜると、エミュレータ非起動環境（＝当環境/CI 既定）で 49件が巻き添えで落ちる。分離すれば既存が不変。トレードオフ: script が2系統に増え、実行手順の周知が要る。
- 却下: 同一 jest config に `testPathIgnorePatterns` だけで混在 → `npm test` 単独でも rules ファイルが「エミュレータ無いと落ちる」状態に近く、環境変数次第で事故る。明確な別 script の方が安全。
- 却下: `postCount<=9` を **post create ルール内で trip を `get()` 参照**して検証 → ルール内 `get()` は1書き込みごとに課金され（§13.3 コスト規律に逆行）、かつ create と trip update の二重評価で冗長。trip update 側の `members[uid].postCount` 不変条件で守る方が安価・確実。
- 却下: Storage ルールで Firestore を参照しメンバー判定 → **Storage ルールは Firestore を読めない**（v2 に `firestore.get` は無い）。パス内 `{uid}` と `request.auth.uid` 一致＋サイズ/contentType で守る方針に倒す。

## firestore.rules の設計

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    match /trips/{tripId} {
      function isMember() {
        return request.auth != null
          && request.auth.uid in resource.data.memberIds;
      }
      // memberIds への差分が「自分の uid 追加のみ」かを集合演算で検証
      function isJoiningSelf() {
        return request.auth != null
          // 既存 memberIds が新 memberIds の部分集合（既存要素を消さない/書き換えない）
          && resource.data.memberIds.toSet().difference(
               request.resource.data.memberIds.toSet()
             ).size() == 0
          // 追加された差分が自分の uid ちょうど1件
          && request.resource.data.memberIds.toSet().difference(
               resource.data.memberIds.toSet()
             ) == [request.auth.uid].toSet()
          // 上限12人
          && request.resource.data.memberIds.size() <= 12;
      }

      allow read: if isMember();
      allow update: if isMember() || isJoiningSelf();
      // create はホストのトリップ作成。今回スコープでは最小限（自分が memberIds/hostUserId）
      allow create: if request.auth != null
                    && request.resource.data.hostUserId == request.auth.uid
                    && request.resource.data.memberIds == [request.auth.uid];

      match /posts/{postId} {
        allow read: if request.auth != null
          && request.auth.uid in get(/databases/$(database)/documents/trips/$(tripId)).data.memberIds;
        allow create: if request.auth != null
          && request.resource.data.userId == request.auth.uid
          && request.resource.data.caption.size() <= 200
          && request.resource.data.slotIndex >= 0
          && request.resource.data.slotIndex <= 8;
        // 投稿の差し替え（昇格）は delete+create か update。今回は create/read を主対象。
      }
    }

    match /inviteCodes/{code} {
      allow read: if request.auth != null
        && request.resource == null               // read は resource 側で判定
        ? true : true;                            // ↓実体は下行（擬似）
    }
  }
}
```

注意・補足（Implementer はここを正確に）:

- **`postCount<=9` と `lastPostAt` レート制限は `trips` の update 側に置く**。SPEC §5-7 の通り、昇格は「post 書き込み」と「trip ドキュメントの `members[uid].postCount` 更新」をトランザクションで行う。ルールは**各書き込みを独立に評価**するので、`postCount` の不変条件・レート制限は trip update ルールに書くのが正しい。post create ルールだけでは postCount を安価に見られない（trip の `get()` は課金。コスト規律に反する）。trip update ルールに次を追加する:
  ```
  // 自分の postCount は 0..9 の範囲、かつ +1 ずつ（差し替えは ±0）
  function postCountValid() {
    let uid = request.auth.uid;
    let newCount = request.resource.data.members[uid].postCount;
    return newCount >= 0 && newCount <= 9;
  }
  // 前回投稿から10秒以上（差し替え/追加時のみ厳格化。詳細は Investigator 確認事項参照）
  function rateOk() {
    let uid = request.auth.uid;
    return !( 'lastPostAt' in resource.data.members[uid] )
      || request.resource.data.members[uid].lastPostAt
         > resource.data.members[uid].lastPostAt + duration.value(10, 's');
  }
  ```
  これらを `isMember() && postCountValid() && rateOk()` の形で update に AND する（メンバー自身の postCount/lastPostAt 更新パスに限定）。**Investigator は「ルール内 timestamp 比較に `request.time` を使うか、`lastPostAt` フィールド値同士を比較するか」を rules-unit-testing 上の挙動で確定すること。**
- **`inviteCodes` read の `expiresAt` 超過拒否**: read 判定で `resource.data.expiresAt > request.time` を使う。上記コードの三項擬似は擬似表現なので、実体は:
  ```
  match /inviteCodes/{code} {
    allow read: if request.auth != null
                && resource.data.expiresAt > request.time;
    // create/update/delete は今回スコープ外（deny のまま）
  }
  ```
- **posts read の `get()` 課金**について: posts の read は trip の `memberIds` を `get()` 参照する必要がある（posts に memberIds は無いため）。これは正規の手段で許容（フィード購読のたびに1回）。コスト規律上は §13.3 の「購読1本共有・limit(50)」で読み取り回数自体を抑える前提。**post create 側は trip 参照不要にして `get()` を避ける**（userId 一致・caption・slotIndex のみ）。

## storage.rules の設計

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /trips/{tripId}/{uid}/{postId} {
      allow read: if request.auth != null;     // ※下記トレードオフ参照
      allow write: if request.auth != null
        && request.auth.uid == uid
        && request.resource.size < 1.5 * 1024 * 1024
        && request.resource.contentType == 'image/jpeg';
    }
  }
}
```

- **Storage は Firestore を読めない制約への対処**: メンバー判定（trip の memberIds 参照）は Storage ルールでは不可能。よって **read は「認証済みなら可」に倒す**。画像 URL は Firestore の post（メンバーしか読めない）経由でしか配られないため、URL を知らない非メンバーは実質到達できない＝実害は限定的。厳密なメンバー限定 read が要件なら署名付き URL or Functions 経由が必要だが、今回スコープ外（Investigator 確認事項に記載）。
- **write はパス内 `{uid}` と `request.auth.uid` の一致で本人のみ**に限定。サイズ < 1.5MiB・`image/jpeg` 固定で §13.3 のコスト規律を強制。

## テスト分離設計

- **`firebase.json`（新規）**: emulators の firestore/storage ポート、rules ファイルパスを宣言。
  ```json
  {
    "firestore": { "rules": "firestore.rules" },
    "storage":   { "rules": "storage.rules" },
    "emulators": {
      "firestore": { "port": 8080 },
      "storage":   { "port": 9199 },
      "ui":        { "enabled": false },
      "singleProjectMode": true
    }
  }
  ```
- **`jest.rules.config.js`（新規）**: `testEnvironment: 'node'`、`testMatch: ['<rootDir>/tests/rules/**/*.test.ts']`、`transform` は既存同様 `babel-jest` + `babel-preset-expo`。`moduleNameMapper` の `@/` は不要（rules テストは src を import しない）。
- **`jest.config.js`（変更）**: 二重防御で `testPathIgnorePatterns: ['/node_modules/', '/tests/rules/']` を追加。既存 `testMatch` は `**/*.test.ts(x)` のままだが ignore で rules を確実に除外。
- **`package.json`（変更, script のみ）**:
  ```
  "test:rules": "firebase emulators:exec --only firestore,storage \"jest --config jest.rules.config.js\""
  ```
  依存追加は**不要**（`@firebase/rules-unit-testing@^5.0.1` は devDep 既存、peer の `firebase@12` も node_modules に解決済みを確認済み）。`firebase` CLI は人間側が `npm i -g firebase-tools` で用意する前提（当環境には無い）。
- **テスト配置**: `tests/rules/firestore.rules.test.ts` / `tests/rules/storage.rules.test.ts`。`initializeTestEnvironment({ projectId, firestore:{rules}, storage:{rules} })` → `testEnv.authenticatedContext(uid)` / `unauthenticatedContext()` → `assertSucceeds`/`assertFails`。seed は `testEnv.withSecurityRulesDisabled()` で投入。

## テストケース一覧（Issue 9項目 → ルールマッピング）

| # | ケース | 対象ルール | 期待 |
|---|---|---|---|
| 1 | 非メンバーが trip read | trips read `isMember` | fail |
| 2 | メンバーが trip read | trips read `isMember` | succeed |
| 3 | 他人を memberIds に追加 | trips update `isJoiningSelf` | fail |
| 4 | 自分を memberIds に追加（参加） | trips update `isJoiningSelf` | succeed |
| 5 | 13人目で12人超過 | `isJoiningSelf` size<=12 | fail |
| 6 | 他人の userId で post create | posts create userId一致 | fail |
| 7 | caption 201字で post create | posts create caption.size()<=200 | fail / 200字は succeed |
| 8 | postCount を10へ更新（10枚目） | trips update postCountValid | fail / 9は succeed |
| 9 | lastPostAt から10秒未満の連投 | trips update rateOk | fail / 10秒超は succeed |
| 10 | inviteCode を認証済みで read | inviteCodes read | succeed |
| 11 | expiresAt 超過の inviteCode read | inviteCodes read expiresAt> | fail |
| 12 | Storage: 1.5MiB 超 write | storage write size | fail |
| 13 | Storage: 非 jpeg write | storage write contentType | fail |
| 14 | Storage: 他人 uid パスへ write | storage write uid一致 | fail |
| 15 | Storage: 正常（jpeg, <1.5MiB, 自分 uid） | storage write | succeed |

## 影響ファイル一覧

新規:
- `firestore.rules`
- `storage.rules`
- `firebase.json`
- `jest.rules.config.js`
- `tests/rules/firestore.rules.test.ts`
- `tests/rules/storage.rules.test.ts`
- （任意）`tests/rules/README.md` または README に実行手順追記

変更:
- `jest.config.js`（`testPathIgnorePatterns` 追加のみ）
- `package.json`（`test:rules` script 追加のみ。依存追加なし）
- `README.md`（rules テスト実行手順・Java/firebase-tools 前提を明記）

想定変更行数: ルール約 80–110 行、テスト約 200–280 行、config/script 数十行。**1 PR で完結するサイズ。**

## やらないこと（3点）

1. **実 Firebase 実装層**（`@react-native-firebase` の Repository 差し込み, §9-5）— 別Issue。本件はルール層のみ、Mock 層は無改変。
2. **App Check（App Attest）の実装**（§13.3）— 別Issue。ルール内コメントで「App Check 前提」に触れる程度に留める。
3. **エミュレータ実行環境の構築**（Java / firebase-tools のインストール、緑確認）— 人間側。成果物は「ルール＋テスト＋firebase.json＋script」まで。

## リスク・落とし穴

- **ルールの個別評価 vs トランザクション**: 昇格は `posts` create と `trips` update をトランザクションで行うが、ルールは各書き込みを独立評価する。`postCount<=9`・レート制限は **trip update 側に集約**して守る（post create 側に置くと trip の `get()` が必要になりコスト規律違反）。これを Implementer が混同しないこと。
- **Storage が Firestore を読めない**: メンバー限定 read は Storage 単体では不可能。read=認証済みに倒し、URL 機密性（post 経由でしか配られない）で実質防御。要件が厳格なら別手段＝スコープ外。
- **デフォルト jest を汚さない分離**: rules テストはエミュレータ非起動だと必ず接続エラーで落ちる。`tests/rules/` 隔離 + 別 config + ignore で `npm test`（49件）を不変に。CI でも `test:rules` は別ジョブ前提。
- **rules 構文の version**: `rules_version = '2'` を両ファイル冒頭に明記（`toSet()`/`difference()`/再帰ワイルドカードは v2 前提）。
- **timestamp 比較**: `expiresAt > request.time` と `lastPostAt + duration` の比較は型（Timestamp vs Duration）に注意。Investigator がエミュレータ挙動で確定。

## Investigator への確認事項

1. **firebase JS SDK のインポート形態**: rules テストは `firebase@12` モジュラ（`firebase/firestore`, `firebase/storage`）を `babel-preset-expo` 下で import して問題ないか（ESM/CJS 解決）。node_modules には `firebase@12.14.0` 解決済みを確認済み。jest の transformIgnorePatterns 調整が要るか。
2. **rules-unit-testing v5 の context API**: `RulesTestContext` から Firestore/Storage インスタンスを取る正確なメソッド（`.firestore()` / `.storage()`）と、Storage への put / Firestore seed（`withSecurityRulesDisabled`）の v5 シグネチャ。
3. **`isJoiningSelf()` の集合演算**: `difference()` の方向（既存→新で消えていない、新→既存で追加が自分のみ）の正確な式と、`==` での集合比較がエミュレータで通るか。配布後途中参加（§5-6: members マップにも色付与）で update が複合する場合、memberIds 差分だけ見れば足りるか。
4. **レート制限の基準時刻**: `lastPostAt` をクライアントが書く値（`request.resource.data...lastPostAt`）で比較するか、`request.time`（サーバ時刻）で比較するか。クライアント値だと改竄余地→ `request.time` 基準＋`lastPostAt == request.time`（serverTimestamp）を強制すべきか確認。
5. **postCount 更新パスの限定**: trip update で「自分の members[uid] のみ変更」を厳密に縛るか（他メンバーの postCount を書き換えられないように `affectedKeys` 検証が必要か）。スコープに含めるか別Issueか判断材料を提示。
6. **Storage read 要件**: 認証済み read で要件を満たすか、メンバー限定 read が必須要件か（Issue/SPEC では write のみ明記。read 緩和の可否を確定）。
