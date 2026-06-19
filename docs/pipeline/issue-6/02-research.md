# セキュリティルール＋rules-unit-testing 調査

Issue: #6
Stage: 2/5 Investigator

入力: `docs/pipeline/issue-6/01-design.md` のみ。本書は事実（file:line / 実物引用 / コマンド実測）と推測を分けて記す。
当環境は firebase CLI / Java 無し＝エミュレータ起動不可。**import 解決・型・jest 隔離は node で実測した**。ルール文字列の意味論（rules 言語）は実行不可なので「仕様根拠＋実装上の確定事項」として記す。

---

## 0. 結論サマリ（Implementer 即読）

- firebase modular SDK（`firebase/firestore`・`firebase/storage`）と `@firebase/rules-unit-testing@5.0.1` は **`babel-jest`+`babel-preset-expo`・`testEnvironment:'node'` でそのまま import 可**。`transformIgnorePatterns` 調整は**不要**（実測）。
- **`testPathIgnorePatterns` は任意ではなく必須**。デフォルト `jest.config.js` の `testMatch: ['**/*.test.ts']` は `src/` 外の `tests/**` も拾う（実測）。除外しないと `npm test` が `tests/rules/*.test.ts` を実行→エミュレータ不在で 49 件に巻き添え赤。
- **`tsconfig.json` の `include: ["**/*.ts"]`（tsconfig.json:14-19）により `tsc --noEmit` は `tests/rules/*.test.ts` も型検査する**。テストファイルは型クリーンであること必須（firebase 型は解決済み・実測で tsc 0）。
- レート制限の基準時刻は **`request.time`（サーバ時刻）基準＋`lastPostAt == request.time` 強制が正**（クライアント値比較は改竄余地。理由は §2-4）。
- `isJoiningSelf()` の集合演算は **rules v2 の `List.toSet()` / `Set.difference()` / `Set.hasOnly()` で書ける**。ただし設計の `difference(...) == [x].toSet()` は **`hasOnly([x])` か `hasAll([x]) && size()==元+1` に置換推奨**（§2-3）。

---

## 1. データモデルの正確な対応（ルールが守る不変条件）

### 1.1 ドメイン型（`src/domain/types.ts`）— 実フィールド名・型

- `Member`（types.ts:13-22）: `displayName: string`、`photoURL?: string`、`color?: AssignedColor`、`postCount?: number`（コメント「0〜9。ルールで上限強制」types.ts:19-20）、`lastPostAt?: Date`（types.ts:21-22）。**`postCount` と `lastPostAt` は optional**（`?`）。→ ルールで `members[uid].postCount` を参照する際、**キー不在の可能性がある**（`'postCount' in members[uid]` ガードが要る場面あり）。
- `Trip`（types.ts:29-42）: `id`,`name`,`startDate:Date`,`endDate:Date`,`hostUserId:string`,`status:TripStatus`,`colorsAssigned:boolean`、**`memberIds: string[]`（判定用配列。types.ts:38-39）**、**`members: Record<string, Member>`（マップ内包。types.ts:40-41）**。設計の「memberIds 配列＋members マップ二重持ち」は型と一致。
- `Post`（types.ts:49-61）: `id`,`userId:string`,`color`,`caption:string`,`thumbURL`,`imageURL`,`createdAt:Date`,**`slotIndex:number`（コメント「0〜8」types.ts:59-60）**。
- `InviteCode`（types.ts:67-71）: `code:string`,`tripId:string`,**`expiresAt:Date`**。フィールドは3つのみ。

時刻表現の注意（types.ts:1-6 のヘッダコメント、事実）:
> 「ドメイン層は Firebase 非依存に保つため時刻はすべて素の `Date` で表現する。Firebase 実装側で Timestamp <-> Date を変換する。」
→ **本番 Firestore では `startDate`/`endDate`/`createdAt`/`expiresAt`/`lastPostAt` はすべて Firestore `Timestamp`**。ルールの `expiresAt > request.time` / `lastPostAt + duration(...)` は **Timestamp 同士の比較**になる前提（rules では `request.time` も timestamp 型）。rules テストの seed でも `Timestamp` で書くこと（後述 §3.4）。

### 1.2 Mock 実挙動（ルールが許可/拒否すべき遷移の根拠）

**`createTrip`**（mock-trip-repository.ts:45-85）: 新規 trip は `memberIds: [host.uid]`（line 69）、`members: { [host.uid]: { displayName, photoURL, postCount: 0 } }`（line 70-76）、`hostUserId: host.uid`（line 66）。→ 設計の create ルール `memberIds == [request.auth.uid] && hostUserId == request.auth.uid`（01-design.md:56-58）は実挙動と一致。**ただし新規 member には `postCount:0` が必ず入る**（line 74）ので、create ルールで members 構造を縛るなら `postCount==0` も許す必要がある（厳格化するなら）。

**`joinTrip`**（mock-trip-repository.ts:92-132）: 既存参加は冪等 no-op（line 103-105）。追加時は `memberIds: [...trip.memberIds, user.uid]`（line 118）＝**末尾に自分の uid を1件追加・既存要素不変**。同時に `members[user.uid] = { displayName, photoURL, color, postCount: 0 }`（line 121-127）。**配布済みなら `color` も同時に付与される**（line 114, `pickColorForJoiner`）。
→ **設計の `isJoiningSelf()` は memberIds 差分のみ検証（01-design.md:39-50）だが、実際の join は `members` マップにも自分のエントリ追加＋（配布済みなら）`color` を書く複合更新**。memberIds 差分だけ縛ると、`members` 側に他人のエントリを混入させる更新を許してしまう余地が残る（→ §6 落とし穴・申し送り5の根拠）。上限は `MAX_MEMBERS`（mock-trip-repository.ts:109, line 2 で `@/domain/colors` から import）。**設計は 12 人固定（01-design.md:50）だが、実コードは定数 `MAX_MEMBERS`**。要確認（§1.3）。

**`promotePhoto`**（mock-post-repository.ts:36-103）— 昇格の実挙動:
- slotIndex 範囲チェック `0..BEST_NINE_SLOTS-1`（line 39-41。`BEST_NINE_SLOTS=9` → 0..8）。設計の post create `slotIndex>=0 && <=8`（01-design.md:66-67）と一致。
- `caption.trim()` を保存（line 65）。**trim 後の長さが保存値**。設計の `caption.size()<=200`（01-design.md:65）は trim 後文字数に効く前提でよい。
- **差し替え（既存 slot）**: `postCount` 変えない（line 76-80, コメント line 77「枚数は変わらない」）。
- **追加（空き slot）**: `postCount += 1`、ただし `nextPostCount >= BEST_NINE_SLOTS(=9)` で throw（line 83-85）。→ **postCount は 0..9、追加は +1、差し替えは ±0** が不変条件。設計 `postCountValid: newCount 0..9`（01-design.md:88-90）と一致するが、設計は「+1 ずつ／差し替えは ±0」を式に落としていない（§2 で補強）。
- 更新 trip は `members[user.uid] = { ...member, postCount: nextPostCount, lastPostAt: newPost.createdAt }`（line 92-98）。**`lastPostAt` は `newPost.createdAt`（＝クライアント生成 `new Date()`、line 69）**。→ 本番では serverTimestamp に置換すべき（§2-4）。
- **`promotePhoto` は post 書き込み（`putPosts`）と trip 更新（`putTrip`）を両方行う**（line 100-101）。コメント line 90-91「Firestore 実装ではこの更新と post 書き込みを単一トランザクションで行う」。→ **ルールは各書き込みを独立評価**するので postCount/レート制限は trip update 側に置く設計判断（01-design.md:83, 200）は実装意図と整合。

### 1.3 SPEC §7/§13.3 とコードの差異（指摘）

- **人数上限の数値 — 設計の `<=12` は誤り。実値は 8（最重要の差異）**:
  - `colors.ts:41` `export const MAX_MEMBERS = COLOR_POOL.length;`。
  - `colors.ts:40` のコメントは「メンバー上限（= 色プールの数）。SPEC: 12人。」と書くが、**`COLOR_POOL`（colors.ts:23-38）の有効（コメントアウトされていない）要素は 8 個**（あか/きいろ/みどり/あお/むらさき/もも/ちゃいろ/しろ。colors.ts:24,27,29,32,34,35,36,37）。残り 9 個は `//` でコメントアウト（colors.ts:25,26,28,30,31,33 等）。
  - **したがって実行時 `MAX_MEMBERS === 8`**（grep 実測 8 件）。設計の `memberIds.size() <= 12`（01-design.md:50,162）／テストケース5「13人目で12人超過」（01-design.md:162）は**コードと不整合**。
  - 対策: ルールの上限リテラルは **8 に合わせる**か、いっそ「ルールは具体数を持たず `MAX_MEMBERS` を SPEC 確定後にハードコード」。テストケース5 は「9人目（=MAX_MEMBERS+1人目）で超過」に読み替える。**コメント vs 実装の食い違い（SPEC 12 ⇄ 実装 8）は Architect/SPEC 確定が必要**（colors.ts のコメントを信じると 12、コードを信じると 8）。
  - 補足: seed の最大は trip1/trip3 で 3〜4 人（seed.ts:70,127）なので seed からは上限を確定できない。
- **`postCount` の上限**: types.ts:19 コメント「0〜9」、mock は `>= BEST_NINE_SLOTS(9)` で拒否（追加時）＝**有効値 0..9、9 が満杯**。設計の「postCount を 10 へ更新で fail / 9 は succeed」（01-design.md:165）と一致。
- **`caption` 上限 200**: types.ts/Mock に 200 の数値根拠は**無い**（Mock は長さ制限していない）。200 は設計／SPEC §由来の値。**Implementer は SPEC §4/§7 で 200 を再確認**（コード上の裏付けは無い、推測ではなく「コード非依存の SPEC 値」）。

---

## 2. 設計の申し送り6点への回答

### 申し送り1 — firebase JS SDK のインポート形態（ESM/CJS・transformIgnorePatterns 要否）

**回答: 調整不要。`babel-jest`+`babel-preset-expo`・node 環境でそのまま import 可（実測）。**

実測手順（プロジェクト直下に一時 probe を作成し jest 実行、終了後削除）:
- `import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing'`
- `import { doc, getDoc, setDoc, collection } from 'firebase/firestore'`
- `import { ref, uploadBytes } from 'firebase/storage'`
- config: 既存 `jest.config.js` と同形（`testEnvironment:'node'`, `transform: babel-jest+babel-preset-expo`, `transformIgnorePatterns` 無し）。
- 結果: **`Test Suites: 1 passed` / 全シンボル `typeof === 'function'`**。`tsc --noEmit` も **exit 0**（型解決 OK）。

裏付け（package.json の解決フィールド）:
- `node_modules/firebase/firestore/package.json`: `"main": "dist/index.cjs.js"`（CJS）, `"browser"/"module": ...esm...`, **`react-native` フィールド無し**。→ jest(node) は `main`=CJS を引く＝ESM 変換不要。
- `node_modules/@firebase/rules-unit-testing/package.json`: `"main": "dist/index.cjs.js"`。`node -e "require(...)"` で `initializeTestEnvironment/assertFails/assertSucceeds/withFunctionTriggersDisabled` を確認。

注意（推測ではなく条件）: **`testEnvironment:'node'` を保つこと**。`jsdom`/RN preset の `react-native` condition を引くと別エントリになりうる。`jest.rules.config.js` は `testEnvironment:'node'` 固定（設計 01-design.md:145 通り）。`moduleNameMapper @/` は rules テストでは不要（src を import しないため。設計 01-design.md:145 と一致）。

### 申し送り2 — rules-unit-testing v5 の context API

**回答（型定義 `node_modules/@firebase/rules-unit-testing/dist/rules-unit-testing/src/public_types/index.d.ts` 引用）:**

- `RulesTestContext.firestore(settings?): Firestore`（モジュラ v9 SDK と併用可、d.ts コメント「can be used with the client SDK APIs (v9 modular or v9 compat)」）。
- `RulesTestContext.storage(bucketUrl?): Storage`（同上）。
- `RulesTestEnvironment.authenticatedContext(user_id, tokenOptions?): RulesTestContext`
- `RulesTestEnvironment.unauthenticatedContext(): RulesTestContext`
- `RulesTestEnvironment.withSecurityRulesDisabled(callback: (ctx) => Promise<void>): Promise<void>` ← **seed 投入はこれ**（ルール無効化コンテキストで `setDoc`/`uploadBytes`）。
- `clearFirestore()/clearStorage()/cleanup()` あり（`beforeEach`/`afterAll` に使う）。
- `initializeTestEnvironment(config): Promise<RulesTestEnvironment>`（initialize.d.ts）。
- `assertSucceeds<T>(pr)`/`assertFails(pr)`（util.d.ts。assertFails は「Database/Firestore/Storage の permission-denied を認識」）。
- `withFunctionTriggersDisabled` あり（util.d.ts）。今回 Functions 無しなので不要。

結線作法（モジュラ SDK）:
```ts
import { doc, getDoc, setDoc, collection } from 'firebase/firestore';
const alice = testEnv.authenticatedContext('alice');
await assertSucceeds(getDoc(doc(alice.firestore(), 'trips/t1')));
await assertFails(setDoc(doc(bob.firestore(), 'trips/t1'), {...}));
// seed:
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  await setDoc(doc(ctx.firestore(), 'trips/t1'), { memberIds:['alice'], members:{...}, ... });
});
```
Storage:
```ts
import { ref, uploadBytes } from 'firebase/storage';
const r = ref(alice.storage(), 'trips/t1/alice/p1');
await assertSucceeds(uploadBytes(r, bytes, { contentType: 'image/jpeg' }));
```
（`firebase/storage` の `ref/uploadBytes/getBytes` は node-require 実測で `function` を確認。）

`TestEnvironmentConfig`（public_types）: `projectId?`, `firestore?: { rules: string } & HostAndPort|{}`, `storage?: 同`。**`rules` は文字列**（d.ts「The security rules source code」）＝`fs.readFileSync('firestore.rules','utf8')` を渡す（initialize.d.ts の example も `fs.readFileSync`）。host/port は環境変数 or hub から自動探索可（`FIRESTORE_EMULATOR_HOST` 等）。`firebase emulators:exec` 経由なら環境変数が注入されるので host/port 明示は不要。**`projectId` は `demo-*` 推奨**（d.ts コメント）。

### 申し送り3 — isJoiningSelf() の集合演算（正確な式）

rules v2 仕様（事実: `rules_version='2'` で `List.toSet()` / `Set` 演算が使える。実行検証は不可なので構文の正確性として記す）:
- `List.toSet()` → `Set`。`Set.difference(other)`, `Set.intersection`, `Set.union`, `Set.hasAll(list)`, `Set.hasOnly(list)`, `Set.hasAny(list)`, `.size()` が使える。
- **`Set == Set` の等値比較は可**だが、設計の `request.resource.data.memberIds.toSet().difference(resource.data.memberIds.toSet()) == [request.auth.uid].toSet()`（01-design.md:46-48）は **`hasOnly` で書く方が堅牢**:

推奨式（既存を消さない＋追加は自分ちょうど1件＋上限）:
```
function isJoiningSelf() {
  let before = resource.data.memberIds;
  let after  = request.resource.data.memberIds;
  return request.auth != null
    // 既存要素はすべて残る（消さない・書き換えない）
    && after.toSet().hasAll(before)
    // 追加は自分の uid のみ
    && after.toSet().difference(before.toSet()).hasOnly([request.auth.uid])
    // ちょうど1件追加（自分が既存に居ない＝重複追加でない）
    && after.size() == before.size() + 1
    && after.size() <= <MAX_MEMBERS>;
}
```
理由: `difference(...) == [uid].toSet()` は「自分が既に before に居る」ケースで空集合になり `[uid].toSet()` と等しくならず fail するが、`hasOnly` でも空集合は `hasOnly([uid])==true` になり得る（空集合は hasOnly を満たす）。そこで **`after.size()==before.size()+1` を必ず AND** して「ちょうど1件増えた」を担保する。これが冪等 join（既参加 no-op、mock-trip-repository.ts:103-105）と矛盾しない（既参加者は update せず read で済むため、ルールが size+1 を要求しても実害なし）。

**重要な不足（§1.2 より）**: join は `members` マップにも自分エントリを追加し、配布済みなら `color` も書く（mock-trip-repository.ts:119-127, 114）。memberIds 差分だけ縛ると `members` への他人エントリ混入を防げない。厳格化するなら `request.resource.data.members.diff(resource.data.members).affectedKeys().hasOnly([request.auth.uid])` を AND（→ 申し送り5・§6 と共通の `diff().affectedKeys()` 技法）。**設計スコープ判断: テストケース 3/4/5（01-design.md:160-162）は memberIds のみで満たせるので最小実装は memberIds 差分でも通る。members affectedKeys 強化は「やった方が安全だが別途」**（Architect に判断委譲、§6 に落とし穴として明記）。

### 申し送り4 — レート制限の基準時刻

**回答: `request.time`（サーバ時刻）基準が正。クライアント値（`request.resource.data.members[uid].lastPostAt`）単独比較は改竄余地があるため不可。`lastPostAt == request.time` を強制して serverTimestamp 書き込みを矯正するのが堅牢。**

根拠:
- mock では `lastPostAt = newPost.createdAt = new Date()`（クライアント時刻、mock-post-repository.ts:69,96）。本番では `serverTimestamp()` に置換する設計意図（types.ts:1-6 の「Firebase 実装側で変換」）。
- クライアントが `lastPostAt` を過去値で書けば `rateOk` を自由に回避できる。よって **書き込む `lastPostAt` が `request.time` と一致することを要求**（`request.resource.data.members[uid].lastPostAt == request.time`）＝実質 serverTimestamp 強制。
- レート判定本体は **直前値（`resource.data.members[uid].lastPostAt`）と `request.time` の差**で見る:
```
function rateOk() {
  let m = request.auth.uid;
  return !('lastPostAt' in resource.data.members[m])          // 初投稿は無条件OK
    || request.time > resource.data.members[m].lastPostAt + duration.value(10, 's');
}
function serverTimeStamped() {
  let m = request.auth.uid;
  return request.resource.data.members[m].lastPostAt == request.time;
}
```
注意（型）: `resource.data.members[m].lastPostAt` は Timestamp、`duration.value(10,'s')` は Duration。**Timestamp + Duration → Timestamp** は rules で合法（設計 01-design.md:96 の式形を踏襲）。`request.time` も Timestamp。
テスト上の注意（実行は人間側だが設計に残す）: 10 秒境界は `request.time` がテスト実行時刻で動くため、seed の `lastPostAt` を「`request.time` 基準で十分古い／十分新しい」相対値（例: 過去固定 Timestamp と直近 Timestamp）で作る。`lastPostAt == request.time` 強制を入れると **クライアント側 setDoc で `serverTimestamp()` を使う必要**があり、テストは `serverTimestamp()` を書く（モジュラ `firebase/firestore` の `serverTimestamp` を import）。
**スコープ判断**: `serverTimeStamped()` 強制まで入れると設計の rate テスト（01-design.md:166）が serverTimestamp 前提になる。最小実装は `rateOk()` のみでもテストは書けるが改竄耐性が弱い。**推奨は両方 AND**。Implementer は両方入れる前提で進めてよい（壊すリスク低・テストは serverTimestamp で書く）。

### 申し送り5 — postCount 更新パスの限定（affectedKeys 検証要否）

**回答: 「自分の members[uid] のみ変更」を `members.diff().affectedKeys().hasOnly([uid])` で縛るのが正。入れないと他メンバーの postCount/lastPostAt を書き換える update を許す穴が残る。**

根拠と式（rules `Map.diff()`／`MapDiff.affectedKeys()` 仕様。実行検証不可、構文として確定）:
```
function onlyMyMemberChanged() {
  return request.resource.data.members.diff(resource.data.members)
           .affectedKeys().hasOnly([request.auth.uid]);
}
function postCountValid() {
  let m = request.auth.uid;
  let nc = request.resource.data.members[m].postCount;
  return nc >= 0 && nc <= 9;
}
```
mock の昇格更新は `members[user.uid]` のみ差し替え（mock-post-repository.ts:92-98、スプレッドで他キー不変）＝**実挙動は「自分のキーのみ変更」**。よって `affectedKeys().hasOnly([uid])` は正当（mock と矛盾しない）。
**スコープ判断**: テストケース 8/9（01-design.md:165-166）は自分の postCount/lastPostAt のみ変える前提なので最小実装は `postCountValid()`＋`rateOk()` で緑になるが、**「他人の postCount を書き換える」拒否テスト（設計に無い）を追加するなら `onlyMyMemberChanged()` が必須**。→ Architect に「affectedKeys 強化＋拒否テスト1件追加」を推奨（低リスク・コスト規律内）。最低限スコープなら本Issueは postCountValid/rateOk まで、affectedKeys は別Issueでも可。**判断材料: mock 実挙動は affectedKeys 制約と完全整合なので、入れても既存挙動は壊れない。**

### 申し送り6 — Storage read 要件

**回答: 「認証済みなら read 可」で本Issueのスコープ要件を満たす。メンバー限定 read は Storage 単体で不可能（Storage ルールは Firestore を読めない）＝厳格メンバー read は別Issue。**

根拠:
- Issue/設計のテストケースは **Storage は write のみ**（01-design.md:169-172、ケース12-15 すべて write）。read のメンバー限定要件はテスト化されていない。
- Storage ルール v2 に `firestore.get()` 相当は無い（設計 01-design.md:24, 127 の指摘どおり。事実: Storage ルール言語に Firestore 参照プリミティブは存在しない）。
- 画像 URL は post（メンバーしか read 不可、firestore rules で担保）経由でしか配られない＝URL 機密性で実質防御（設計 01-design.md:127）。
→ **設計どおり `allow read: if request.auth != null` で確定。read 厳格化はスコープ外（やらないこと相当）。**

---

## 3. テスト分離の実証（jest 隔離）

### 3.1 デフォルト jest が tests/rules を拾うか（実測）

**拾う。`testPathIgnorePatterns` は必須。**
- `jest.config.js:16` `testMatch: ['**/*.test.ts', '**/*.test.tsx']` は **rootDir 全体**を走査。`src/` 限定ではない。
- 実測: プロジェクト直下に `tests/_probe/probe.test.ts` を置くと `jest --listTests` が**それを列挙**した（`/Users/.../tests/_probe/probe.test.ts`）。
- `--testPathIgnorePatterns '/node_modules/' '/tests/_probe/'` を足すと**除外された**。
→ 設計 01-design.md:146 の `testPathIgnorePatterns: ['/node_modules/', '/tests/rules/']` は **二重防御ではなく一次防御として必須**。これが無いと `npm test` 単独で rules テストが走り、エミュレータ不在で接続エラー→49 件が赤になる。

### 3.2 別 config で firebase を import して落ちないか（実測）

§2-申し送り1 のとおり **落ちない**。`jest.rules.config.js`（設計 01-design.md:145）の形（node 環境・babel-preset-expo・transformIgnorePatterns 無し）で import 解決・実行 OK。

### 3.3 既存不変条件（実測ベースライン）

- `npm test`（=`jest`、package.json:60）: **Test Suites 5 passed / Tests 49 passed**（probe 除外時。実測）。対象は src 配下5ファイル（`mock-upload-queue.test.ts` / `invite-code.test.ts` / `assign-colors.test.ts` / `mock-post-repository.test.ts` / `merge-best-nine.test.ts`）。
- `tsc --noEmit`: **exit 0**（実測）。
- **`tsconfig.json:14` `include: ["**/*.ts"]` → `tsc` は `tests/rules/*.test.ts` も型検査**。probe（firebase modular を import）で tsc 0 を確認済み＝rules テストの firebase 型は解決する。**ただし `tests/rules/*.test.ts` の型エラーは `tsc` を 0→非0 に壊す**。Implementer はテストを型クリーンに保つこと（`uploadBytes` の引数型、`Timestamp` import など）。

### 3.4 seed 投入（withSecurityRulesDisabled）の作法

- `testEnv.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), 'trips/t1'), {...}); })`。
- **seed の Timestamp**: `expiresAt`/`lastPostAt` は本番同様 `Timestamp`（`firebase/firestore` の `Timestamp.fromDate(...)` / `Timestamp.fromMillis(...)`）で書く。`request.time` との比較が成立するため。

---

## 4. firebase.json / emulator 設定の最小形

設計 01-design.md:133-144 の形で妥当。型定義・一般仕様に照らした確定事項:
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
- `firestore.rules` パス・`storage.rules` パスはリポジトリルート相対（新規 `firestore.rules`/`storage.rules` と一致、01-design.md:177-178）。
- ポート 8080(firestore)/9199(storage) は Firebase 既定。`emulators:exec` が起動時に `FIRESTORE_EMULATOR_HOST`/`FIREBASE_STORAGE_EMULATOR_HOST` を注入→`initializeTestEnvironment` が自動探索（initialize.d.ts「tries to discover those emulators via environment variables」）。よって **テスト側で host/port を明示しなくても接続できる**。
- `projectId` は `initializeTestEnvironment({ projectId: 'demo-colorlog', ... })` で `demo-*` 推奨（public_types d.ts コメント）。`firebase.json` の `singleProjectMode:true` と整合。
- script（package.json:60 へ追加、設計 01-design.md:149）:
  `"test:rules": "firebase emulators:exec --only firestore,storage \"jest --config jest.rules.config.js\""`
  依存追加不要（`@firebase/rules-unit-testing@^5.0.1`・`firebase@12.14.0` は node_modules 解決済み＝実測）。`firebase-tools` と Java は人間側前提（01-design.md:151, 196）。

---

## 5. 既存の実装パターン（参考前例）

- **jest config の書き方**: `jest.config.js:8-17`（`testEnvironment:'node'`・`babel-jest`+`babel-preset-expo`・`moduleNameMapper @/`・`testMatch`）。`jest.rules.config.js` はこれを下敷きに `moduleNameMapper` 省略・`testMatch` を `tests/rules/**` に。
- **mock リポジトリのテスト**: `src/repositories/mock/mock-post-repository.test.ts`（8KB）・`mock-upload-queue.test.ts`（16KB）が `describe/it/expect` の既存スタイル。assertSucceeds/assertFails 形式とは別物だが命名・構成の参考に。
- **InviteCode 期限切れ判定の前例**: `mock-trip-repository.ts:37-43` `resolveInviteCode` が `invite.expiresAt.getTime() < Date.now()` で期限切れを「読めない」扱い（コメント line 40「期限切れは『読めない』扱い（SPEC 13-3）」）。→ **ルールの `allow read: if ... && resource.data.expiresAt > request.time`（01-design.md:104-107）はこのロジックの rules 版**。完全に整合。
- **seed の trip/inviteCode 形状**: `seed.ts:62-77`（trip1: memberIds 4件・members マップ・postCount）、`seed.ts:112-116`（inviteCode `{code,tripId,expiresAt}`）。rules テストの seed ドキュメント形状はこれを写経すればよい。

---

## 6. Implementer が踏む落とし穴（リスク箇所）

**リスク1 — `testPathIgnorePatterns` を入れ忘れる／`tests/rules/` を `src/` 外に置いたつもりで `npm test` が拾う（最重要・既存49件を壊す）**
- 根拠（実測）: `jest.config.js:16` の `testMatch:['**/*.test.ts']` は rootDir 全域を走査。probe を `tests/_probe/` に置いたら `--listTests` が拾った。
- 影響: 除外しないと `npm test` が `tests/rules/*.test.ts` を実行→エミュレータ不在で permission/接続エラー→**Test Suites 5→7、49件が巻き添えで赤**。絶対条件（デフォルト jest 不変）を破る。
- 対策: `jest.config.js` に `testPathIgnorePatterns: ['/node_modules/', '/tests/rules/']` を**必ず**追加（設計どおり、ただし「任意の二重防御」ではなく必須）。追加後 `npm test` が 49 passed のままを確認。

**リスク2 — `tsc --noEmit` が `tests/rules/*.test.ts` の型エラーで 0→非0 に壊れる（tcs 不変条件違反）**
- 根拠（実測）: `tsconfig.json:14` `include:["**/*.ts"]` がテストファイルも対象。`tsc` は jest の `testPathIgnorePatterns` を見ない（別系統）。
- 影響: rules テストに型エラー（`uploadBytes` の `Uint8Array` 引数型、`Timestamp` 未 import、`assertFails(...)` の Promise 型、`firebase/storage` の `ref` 第2引数など）があると **`tsc --noEmit` が非0**＝CI のもう一方の絶対条件を破る。
- 対策: テストを型クリーンに保つ。`firebase/firestore`・`firebase/storage`・`@firebase/rules-unit-testing` の型は解決済み（probe で tsc 0 を実測）なので、正しい引数型で書けば通る。必要なら `tsconfig` で `tests/rules` を exclude する選択肢もあるが、**型安全を捨てるので非推奨**（include はいじらず型を合わせる方針）。

**リスク3 — レート制限／postCount/join を「クライアント値そのまま」「memberIds だけ」で縛り、改竄・他メンバー書き換えの穴を残す**
- 根拠: mock は `lastPostAt = new Date()`（クライアント時刻、mock-post-repository.ts:69,96）、join は `members` マップにも書く（mock-trip-repository.ts:119-127）。`Member.postCount`/`lastPostAt` は optional（types.ts:19-21）。
- 落とし穴具体:
  (a) `rateOk` をクライアント `request.resource...lastPostAt` 同士で比較すると過去値書き込みで回避可能 → **`request.time` 基準＋`lastPostAt == request.time`（serverTimestamp 強制）**（§2-4）。
  (b) `isJoiningSelf` を memberIds 差分だけで縛ると `members` に他人エントリ混入を許す → `members.diff().affectedKeys().hasOnly([uid])` 検討（§2-3,5）。
  (c) `members[uid].postCount` 参照は**キー不在時にエラー**になり得る（optional）。初投稿・初参加で `'postCount' in resource.data.members[uid]` / `'lastPostAt' in ...` のガードを入れる（§2-4 の `rateOk` 第1項が好例）。
  (d) `difference(...) == [uid].toSet()` は空集合ケースで誤判定し得る → `hasOnly`＋`size()==before+1`（§2-3）。
- 影響: テストは緑でもルールの実セキュリティが甘い／本番で `Member` キー不在時にルール評価例外。

**（補足リスク）posts read の `get()` 課金 vs テスト**: 設計 01-design.md:62 の posts read は `get(/databases/$(db)/documents/trips/$(tripId)).data.memberIds` を使う。これは正規だが、rules テストで posts を read する前に **`withSecurityRulesDisabled` で親 trip を必ず seed** しないと `get()` が null を引いて fail する（テストの seed 漏れ落とし穴）。create 側は trip 参照不要（userId/caption/slotIndex のみ、01-design.md:63-67, 108）。

---

## 7. 推測（事実と分離）

- 「`MAX_MEMBERS` は 12」: **事実誤り（確定）**。実行時 `MAX_MEMBERS = COLOR_POOL.length = 8`（colors.ts:41 + 有効要素 8 個を実測）。コメント「SPEC: 12人」（colors.ts:40）と実装が食い違う。設計の `<=12` は要修正。SPEC とコードどちらを正とするかは Architect 確定事項（§1.3）。
- 「`caption<=200` はコード裏付けあり」: **誤り回避**。Mock は caption 長を制限していない（mock-post-repository.ts:65 は trim のみ）。200 は SPEC 値で、コード非依存。
- 「`serverTimestamp` 強制まで本Issueスコープ」: **推測的判断**。最小緑は rateOk のみで足りるが、改竄耐性のため両方 AND を推奨（Architect 判断対象）。
- 「affectedKeys 強化を本Issueに含める」: **判断委譲**。mock 実挙動とは整合する（壊さない）が、対応する拒否テストは設計に無い。含めるか別Issueかは Architect/Implementer 判断。
- rules 言語の集合・Map.diff・Timestamp+Duration の**実挙動はエミュレータ不在で未実行検証**。構文・型は v2 仕様準拠として記したが、最終緑確認は人間側（`npm run test:rules`）。

---

## 8. Implementer への引き継ぎ要点（最短）

1. 新規ファイルは設計どおり（firestore.rules / storage.rules / firebase.json / jest.rules.config.js / tests/rules/*.test.ts）。
2. `jest.config.js` に `testPathIgnorePatterns:['/node_modules/','/tests/rules/']` を**必須**追加。追加後 `npx jest` で **49 passed** を確認。
3. テストは**型クリーン**に（`tsc --noEmit` 0 を維持。tests/rules も include 対象）。
4. `isJoiningSelf` は `hasAll(before)`＋`difference.hasOnly([uid])`＋`size()==before+1`＋`<=MAX_MEMBERS`。
5. レート制限は `request.time` 基準＋`lastPostAt==request.time`、`'lastPostAt' in ...` ガード必須。
6. 人数上限ルールは **`MAX_MEMBERS=8`（実測。colors.ts:41 の有効色 8 個）** に合わせる。設計の `<=12` は誤り。SPEC「12人」とコード「8」の食い違いは Architect 確定（§1.3）。テストケース5 は「9人目で超過」に読み替え。
7. seed は `withSecurityRulesDisabled`＋`Timestamp.fromDate/fromMillis`。posts read テストは親 trip を必ず seed。
8. `test:rules` script・依存追加不要（実測で解決済み）。緑確認は人間側（firebase-tools/Java）。
