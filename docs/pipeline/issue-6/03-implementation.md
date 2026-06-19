# セキュリティルール（Firestore/Storage）＋ rules-unit-testing 実装

Issue: #6
Stage: 3/5 Implementer

---

## 修正ラウンド（レビュー差し戻し対応・04-review.md must-1/must-2）

Reviewer から must 2件で差し戻し（trips update の認可漏れ）。以下を修正。`tsc`(0) / デフォルト `jest`(49) は不変、rules テスト2本認識を維持。

### must-1（member 更新ブランチに変更フィールド限定が無い）への対応

`firestore.rules` の member 更新経路を、自分の `members[uid]` サブキー以外を変更不可にした。

- 追加ヘルパ `onlyMyMemberChanged()`: `request.resource.data.members.diff(resource.data.members).affectedKeys().hasOnly([request.auth.uid])` で members の変更を自分の uid キーのみに限定。→ 他人の追放・members[other] 書き換え・read 権限奪取を封じる。
- 追加ヘルパ `immutableOnSelfUpdate()`: `memberIds / hostUserId / name / startDate / endDate / status / colorsAssigned` が `request.resource.data.X == resource.data.X` で不変。→ host 乗っ取り・memberIds 改竄・配布フラグ改竄を封じる。
- member ブランチを `isMember() && onlyMyMemberChanged() && immutableOnSelfUpdate() && postCountValid() && rateOk() && serverTimestamped()` に変更（既存3ガードはその上で維持）。

**host 色配布経路（assignColors / SPEC §5-1）の扱い**: 色配布は host が全員分の `members[uid].color` を1トランザクションで書く正当経路で、`onlyMyMemberChanged()`（自分のキーのみ）では誤って拒否される。SPEC §5-1（未配布のときだけ runTransaction で全員分の色を書く）と mock `assignColors`（mock-trip-repository.ts:134-146: 全員分 color + `colorsAssigned:true` + `status:'active'`）に整合させ、host 用の別ブランチ `isHostAssigningColors()` を追加:
- `isHost()`（`request.auth.uid == resource.data.hostUserId`）
- `colorsAssigned: false → true` の遷移のみ（再配布不可。二重配布防止＝SPEC §5-1 の不変条件をルールでも担保）
- `memberIds / hostUserId / name / startDate / endDate` は不変（配布に乗じた追放・乗っ取りを封じる）
- `allow update` は `(member 自己更新) || isJoiningSelf() || isHostAssigningColors()` の3経路。

最終的な member/host 更新ルール抜粋:
```
allow update: if (isMember()
                  && onlyMyMemberChanged()
                  && immutableOnSelfUpdate()
                  && postCountValid() && rateOk() && serverTimestamped())
              || isJoiningSelf()
              || isHostAssigningColors();
```

### must-2（isJoiningSelf が members マップ無制約）への対応

`isJoiningSelf()` に、既存の memberIds 制約（hasAll / hasOnly / size+1 / <=12）に加えて:
- `request.resource.data.members.diff(resource.data.members).affectedKeys().hasOnly([request.auth.uid])`（members の追加キーも自分の uid のみ）
- `request.resource.data.hostUserId == resource.data.hostUserId`（参加と同時の host 乗っ取り防止）
→ 参加と同時の他人 members 混入・既存メンバー改竄・host 乗っ取りを封じる。

### should 対応

- **存在ガード**: `postCountValid()` / `rateOk()` / `serverTimestamped()` の先頭に `!(uid in resource.data.members)`（rate）/ `!(uid in request.resource.data.members)`（postCount・serverTimestamped）を追加。members[uid] キー不在の更新（members を触らない trip 更新等）で評価例外→正当更新を巻き込み deny しないようにした。
- **create の members 制約（should §120）**: `allow create` に `members.keys().hasOnly([uid])` と `members[uid].postCount == 0` を追加（mock createTrip と整合・作成時の他人混入/postCount 改竄を封じる）。
- **nit（12人コメントの出典）**: `<=12` のコメント出典を `§4` から `§61/§198/§279`（実根拠節）に修正。

### 追加した拒否/許可テスト

`tests/rules/firestore.rules.test.ts`:
- describe「trips update（改竄拒否・攻撃系）」: ①メンバーが他人を memberIds から追放→拒否 / ②memberIds 改竄→拒否 / ③hostUserId 書き換え→拒否 / ④他人の members 書き換え→拒否 / ⑤status 書き換え→拒否 / ⑥未認証 update→拒否。
- describe「trips update（参加時の改竄拒否）」: ①参加時に他人 members 混入→拒否 / ②参加時に既存メンバー改竄→拒否 / ③参加時に hostUserId 改竄→拒否 / ④正当な参加（memberIds + 自分の members のみ）→許可。
- describe「trips update（host 色配布）」: ①host の全員分 color 配布→許可 / ②非 host の配布→拒否 / ③配布済みへの再配布→拒否 / ④配布に乗じた memberIds 改竄→拒否。
- describe「trips create（members 制約）」: ①他人 members 混入→拒否 / ②postCount≠0→拒否 / ③正当な作成→許可。
- posts describe 末尾: post の update（所有者でも）→拒否 / delete（所有者でも）→拒否（create のみ許可・暗黙 deny を固定）。

`tests/rules/storage.rules.test.ts`:
- ちょうど 1.5MiB（1572864B）→拒否（境界・未満のみ許可） / 1.5MiB ちょうど未満→許可。
（非jpeg・未認証は既存テストでカバー済み。）

### 検証結果（修正後・実測）

- `npx tsc --noEmit` = **0**（tests/rules 型クリーン。`deleteDoc` import 追加・型整合）。
- `npx jest`（デフォルト）= **5 suites / 49 passed**（不変・rules を拾わない）。
- `npx jest --config jest.rules.config.js --listTests` = **2本認識**（firestore / storage）。
- `npx jest --listTests | grep -c rules` = **0**（デフォルトは確実に除外）。
- rules テストの緑確認はエミュレータ無しのため不可（走らせて赤にしていない）。緑確認は人間側 `npm run test:rules`。

### 再レビューへの申し送り（修正ラウンド）

1. **host 色配布ブランチ `isHostAssigningColors()` の `status` は非拘束**: mock/SPEC が配布時に `status:'active'` へ遷移するため拘束していない。`colorsAssigned: false→true` の一発ゲートで濫用を抑止（再配布・任意の status 反転はできない）。SPEC §5-1 のトランザクション前提に整合。
2. **存在ガードの実挙動はエミュレータ確定推奨**: `!(uid in resource.data.members)` 等のガードで members[uid] 不在更新を素通りさせる設計だが、rules の `map[key]` アクセス例外の有無は机上では断定しきれない。人間側 `npm run test:rules` で「members[uid] 不在の trip 更新」ケースの確認を推奨（テストは attack 系で間接的にカバー）。
3. **COLOR_POOL / MAX_MEMBERS=8 の不整合は依然スコープ外**（ルールは SPEC 準拠の 12 を維持）。実 Firebase 実装層 / App Check / エミュレータ環境構築も未着手（やらないこと準拠）。
4. コミットはしていない（Integrator 段階）。

---

## （初回ラウンドの記録・以下は差し戻し前の内容）

## 概要（1行）

設計（01）＋調査（02）に忠実に、`firestore.rules` / `storage.rules` と分離型 rules-unit-testing
（`tests/rules/**` + `jest.rules.config.js` + `npm run test:rules`）を実装。デフォルト jest 49件・
`tsc --noEmit` 0 を不変に保ち、メンバー上限はパイプライン確定どおり **12** をリテラル強制。

## 変更 / 新規ファイル一覧（各1行）

新規:
- `firestore.rules` — trips read/update/create・posts read/create・inviteCodes read のルール本体。
- `storage.rules` — `trips/{tripId}/{uid}/{postId}` の write 条件（本人/1.5MiB/jpeg）＋認証済み read。
- `firebase.json` — firestore/storage の rules パス＋emulator 最小設定（port 8080/9199・UI 無効）。
- `jest.rules.config.js` — rules テスト専用 config（node 環境・testMatch を `tests/rules/**` に限定）。
- `tests/rules/firestore.rules.test.ts` — Firestore ルールのテスト（ケース1-11＋追加の異常系）。
- `tests/rules/storage.rules.test.ts` — Storage ルールのテスト（ケース12-15＋未認証 write 拒否・read 許可）。

変更:
- `jest.config.js` — `testPathIgnorePatterns: ['/node_modules/', '/tests/rules/']` を追加（デフォルト jest が rules テストを拾わないため。調査リスク1・必須）。
- `package.json` — `test:rules` script 追加（`firebase emulators:exec --only firestore,storage "jest --config jest.rules.config.js"`）。依存追加なし。
- `README.md` — rules テスト実行手順（Java/firebase-tools 前提・`npm run test:rules`・エミュレータ無いと接続失敗が設計どおりである旨）を追記。

注: ルール本体・config・firebase.json は本段階開始時点で一部既存（Architect/前作業の成果）。
設計と一致を確認のうえ採用し、Implementer は **テスト2本の整備（firestore のリネーム＋storage 新規）と README** を補完した。

## ルール設計の要点

- **postCount / レート制限を trips の update 側に集約した理由**: 昇格は post 書き込みと trip の
  `members[uid]` 更新をトランザクションで行うが、ルールは各書き込みを独立評価する。post create 側で
  postCount を見るには trip の `get()` が必要でコスト規律（§13.3）に反する。よって `postCount<=9` と
  レート制限は trip update ルール（`isMember() && postCountValid() && rateOk() && serverTimestamped()`）に集約。
- **レート制限の基準時刻**: 調査の結論どおり `request.time`（サーバ時刻）基準。さらに
  `lastPostAt == request.time`（`serverTimestamped()`）で serverTimestamp 書き込みを強制し、
  クライアントが過去値を書いて `rateOk` を回避する改竄を封じる。`'lastPostAt' in ...` で optional ガード。
- **isJoiningSelf()**: `after.toSet().hasAll(before)`（既存不変）＋`difference(...).hasOnly([uid])`（追加は自分のみ）
  ＋`after.size() == before.size() + 1`（ちょうど1件・空集合誤判定回避）＋`after.size() <= 12`（上限）。
- **メンバー上限 = 12**: パイプライン確定どおりルールにリテラル `12` を強制。テストは 13 人目を拒否で検証。
  調査が指摘したコードの `MAX_MEMBERS=8` 不整合は **別Issue**（本件はルール側 12 を正とする）。申し送り参照。
- **posts read の get()**: posts に memberIds が無いため親 trip を `get()` 参照。テストは read 前に親 trip を必ず seed。
- **inviteCodes read**: `request.auth != null && resource.data.expiresAt > request.time`。期限切れは「読めない」。
- **Storage**: Firestore を読めないため read は「認証済みなら可」。write はパス内 `{uid} == auth.uid`・
  `< 1.5*1024*1024`・`contentType == 'image/jpeg'`。

## テスト9項目（Issue）の対応

| # | ケース | テスト（ファイル / it） | 期待 |
|---|---|---|---|
| 1 | 非メンバー trip read | firestore: 非メンバーは trip を read できない | fail |
| 1' | メンバー trip read | firestore: メンバーは trip を read できる | succeed |
| 2 | 他人を memberIds 追加 | firestore: 他人を memberIds に追加する update は拒否 | fail |
| 2' | 自分を memberIds 追加 | firestore: 自分を memberIds に追加する update は許可 | succeed |
| 3 | 12人超過（13人目） | firestore: 12人を超える13人目の参加は拒否 | fail |
| 4 | 他人 userId で post create | firestore: 他人の userId での post create は拒否 | fail |
| 5 | caption 201/200 | firestore: caption 201字…拒否 / caption 200字…許可 | fail / succeed |
| 6 | postCount 10/9 | firestore: postCount を 10…拒否 / 9…許可 | fail / succeed |
| 7 | 連投10秒未満/以上 | firestore: 10秒未満…拒否 / 10秒以上…許可（＋過去値 lastPostAt 拒否） | fail / succeed |
| 8 | inviteCode 認証 read / 期限切れ | firestore: 未失効…read 可 / 期限切れ…拒否（＋未認証拒否） | succeed / fail |
| 9 | Storage 各種 | storage: 1.5MiB超/非jpeg/他人uid…拒否, 正常…許可（＋未認証拒否・read許可） | fail / succeed |

設計のケース表（1-15）を全網羅。post read のメンバー/非メンバーも追加で検証。

## Investigator が挙げたリスク箇所3件への対応

- **リスク1（`testPathIgnorePatterns` 入れ忘れで既存49件を壊す）**: `jest.config.js` に
  `testPathIgnorePatterns: ['/node_modules/', '/tests/rules/']` を追加済み。
  `npx jest` を実測 → **Test Suites 5 passed / Tests 49 passed**（rules テストを拾わない）を確認。
- **リスク2（`tsc --noEmit` が tests/rules の型エラーで 0→非0）**: テストを型クリーンに記述。
  `@firebase/rules-unit-testing` の `RulesTestEnvironment` 型、`firebase/firestore` の
  `Timestamp`/`serverTimestamp`、`firebase/storage` の `ref`/`uploadBytes`/`getBytes` を正しい型で使用。
  `npx tsc --noEmit` 実測 → **exit 0**（tests/rules も include 対象だが型エラー無し）。
- **リスク3（改竄・他メンバー書き換え・キー不在エラーの穴）**:
  (a) レート制限は `request.time` 基準＋`serverTimestamped()`（`lastPostAt==request.time`）で改竄封じ。
  (b) `isJoiningSelf()` は memberIds 差分のみ（設計スコープ）。`members` の affectedKeys 厳格化は
      調査が「別Issue可」と判断したものでスコープ外＝申し送りに記載。
  (c) optional フィールドは `'lastPostAt' in ...` / `'postCount' in ...` でガードしキー不在の評価例外を回避。
  (d) `difference(...) == [uid].toSet()` ではなく `hasOnly([uid]) + size()==before+1` を採用し空集合誤判定を回避。
  さらに調査の補足リスク（posts read の `get()` 課金/seed 漏れ）に対し、テストは read 前に親 trip を必ず seed。

## 検証結果

- `npx tsc --noEmit` = **0**（tests/rules も型クリーン）。
- `npx jest`（デフォルト）= **5 suites / 49 tests passed**（件数不変・rules テストを拾わない）を実測。
- `npx jest --config jest.rules.config.js --listTests` = **firestore.rules.test.ts / storage.rules.test.ts の2本を認識**。
- rules テスト自体は **エミュレータ不在のため実行不可**（実測: `initializeTestEnvironment` が
  「host and port … must be specified」で失敗＝接続エラーであり、コード/型エラーではない）。
  緑確認は `firebase emulators:exec` 経由（Java/firebase-tools 前提）で人間側が行う。**無理に走らせて赤にしていない。**

## Reviewer への申し送り

1. **メンバー上限 12 vs コード `MAX_MEMBERS=8` の不整合**: ルールは確定どおり 12 をリテラル強制。
   調査（02 §1.3）が指摘した `COLOR_POOL` 有効要素8個に由来する `MAX_MEMBERS=8` の修正は **別Issue**。
   本件のスコープ外（COLOR_POOL 修正には手を出していない）。
2. **isJoiningSelf の `members` affectedKeys 強化は未実施（意図的・スコープ外）**: join は `members` マップにも
   自分エントリ（配布済みなら color）を書く複合更新だが、本ルールは memberIds 差分のみ検証。
   `members.diff().affectedKeys().hasOnly([uid])` 強化は調査が「別Issue可」と判断したものとして見送り。
   対応する拒否テストも設計に無いため未追加。安全側に倒すなら別PR。
3. **postCount 更新の `onlyMyMemberChanged()` も同様に未実施（スコープ外）**: postCountValid/rateOk/
   serverTimestamped までに留め、他メンバーの members 書き換え拒否は別Issue（mock 実挙動とは整合）。
4. **Storage read = 認証済み**: メンバー限定 read は Storage 単体で不可能（Firestore 参照不可）。
   要件が厳格メンバー read なら署名付き URL / Functions 経由が必要＝別Issue（02 申し送り6 確定）。
5. **実 Firebase 実装層 / App Check / エミュレータ環境構築には未着手**（やらないこと3点に準拠）。
6. コミットはしていない（Integrator 段階）。ブランチ `pipeline/issue-6` 上で作業済み。
