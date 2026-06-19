# セキュリティルール（Firestore/Storage）＋ rules-unit-testing レビュー

Issue: #6
Stage: 4/5 Reviewer

## 前提・検証環境

- 当環境は firebase CLI / Java 無し ＝ **Firestore/Storage エミュレータ起動不可**。よって rules テストの緑確認は不可。本レビューは **ルール論理の机上レビュー＋型/構成の実機確認**が中心。
- 自分で実測したベースライン:
  - `npx jest`（デフォルト）= **5 suites / 49 passed**（rules テストを拾わない）。✅ 不変。
  - `npx tsc --noEmit` = **exit 0**（tests/rules も include 対象だが型クリーン）。✅ 不変。
  - `npx jest --config jest.rules.config.js --listTests` = `firestore.rules.test.ts` / `storage.rules.test.ts` の2本のみ認識。✅
  - `npx jest --listTests | grep rules` = 0件（デフォルトは確実に除外）。✅
- SPEC 実測: メンバー上限 **12**（SPEC.md:61 「メンバー上限12人」/ :198 / :279）、caption **200**（:279 「200字」）、postCount **9**（:76, :279）。
  → ルールの `<=12` リテラルは **SPEC と一致**。調査が指摘した `MAX_MEMBERS=8`（colors.ts:41 の有効色8個）はコード実装側の別問題で、本Issueのルール側 12 強制は SPEC 準拠として妥当。スコープ外扱いは正しい。

---

## 指摘リスト

### must

#### [must] firestore.rules:65 — member 更新ブランチに「変更フィールドの限定」が無く、任意フィールド改竄を許す（最重大の抜け）

`allow update: if (isMember() && postCountValid() && rateOk() && serverTimestamped()) || isJoiningSelf();`

`isMember()`（:15-18）は「呼び出し元が `memberIds` に居る」しか見ていない。`postCountValid()`/`rateOk()`/`serverTimestamped()` はいずれも **呼び出し元自身の `members[uid]` サブキーのみ**を検査する（:38,47,56 すべて `let uid = request.auth.uid`）。つまり、あるメンバーが以下を行っても通る:

- **他メンバーの追放 / memberIds 改竄**: `memberIds` を `['attacker']` に書き換える（自分の postCount/lastPostAt を変えなければ rate/serverTimestamp ガードは素通り）。他人を memberIds から削除して read 権限を奪える。設計の脅威「他人の members を書き換えられないか / memberIds 改竄で read 権限を奪取できないか」がここで防げていない。
- **hostUserId 乗っ取り**: `hostUserId` を自分に書き換え。
- **他メンバーの postCount/lastPostAt 書き換え**: `members[other].postCount = 9` 等。ガードは `members[uid]`（自分）しか見ないため `members[bob]` は無制約。
- **postCount のレート/上限回避**: `members[uid].postCount` を触らず `members[uid]` キーごと別経路…は無いが、`postCount` を据え置いたまま他フィールドを操作する余地が広い。

調査 02 §2-申し送り5（02-research.md:164-181）は `members.diff().affectedKeys().hasOnly([uid])` 強化を「正」と明記し、mock 実挙動とも整合する（壊さない）と結論している。Implementer はこれを「別Issue可」としてスコープ外にしたが、**これは利便性の追加機能ではなく、member 更新ブランチそのものを安全にする中核ガードであり、本Issue（=セキュリティルールの正しさ）の責務に含まれる**。これが無いと「ルールはあるが実質ザル」。

修正提案（member 更新ブランチに自分のキー限定 ＋ 不変フィールド固定を AND）:
```
// 自分の members エントリのみ変更（他メンバーを書き換えない）
function onlyMyMemberChanged() {
  return request.resource.data.members.diff(resource.data.members)
           .affectedKeys().hasOnly([request.auth.uid]);
}
// 昇格更新で memberIds / hostUserId / 構造系は不変
function immutableOnSelfUpdate() {
  return request.resource.data.memberIds == resource.data.memberIds
    && request.resource.data.hostUserId == resource.data.hostUserId;
}
...
allow update: if (isMember()
                  && onlyMyMemberChanged()
                  && immutableOnSelfUpdate()
                  && postCountValid() && rateOk() && serverTimestamped())
              || isJoiningSelf();
```
あわせてテストに **「メンバーが他人の members を書き換える update は拒否」「メンバーが memberIds を改竄する update は拒否」「メンバーが hostUserId を書き換える update は拒否」** の3拒否ケースを追加すること（現状テストはこの攻撃面を1件も検証していない）。

---

#### [must] firestore.rules:25-33 — `isJoiningSelf()` が `members` マップを無制約にし、参加時に他人エントリ混入を許す

`isJoiningSelf()` は `memberIds` 差分のみを検証する（:29-31）。だが SPEC §117（self-join で「`memberIds` と `members` に自分を追加」）および mock 実挙動（02-research.md:38, mock-trip-repository.ts:119-127）では join は **`members` マップにも自分エントリを書く複合更新**。現ルールでは未参加者（`isMember()` false）が `isJoiningSelf()` 経由で update する際、`members` に **他人のエントリを混入・改竄** したり、既存メンバーの `members[other]` を書き換える更新が通る。`memberIds` さえ「自分1件追加」の形なら `members` 側は何でも書ける。

参加は「未参加の attacker が自分を入れる」入口なので、ここで `members` を無制約にすると、参加と同時に他人の postCount/color を破壊できる。

修正提案（`isJoiningSelf()` に members 差分も自分のみ＋構造不変を AND）:
```
function isJoiningSelf() {
  let before = resource.data.memberIds;
  let after = request.resource.data.memberIds;
  return request.auth != null
    && after.toSet().hasAll(before)
    && after.toSet().difference(before.toSet()).hasOnly([request.auth.uid])
    && after.size() == before.size() + 1
    && after.size() <= 12
    // members 側も「自分のキー追加のみ」に限定
    && request.resource.data.members.diff(resource.data.members)
         .affectedKeys().hasOnly([request.auth.uid])
    // hostUserId 等は不変
    && request.resource.data.hostUserId == resource.data.hostUserId;
}
```
テスト追加: **「参加と同時に他人の members エントリを書き換える update は拒否」「参加時に hostUserId を改竄する update は拒否」**。

---

### should

#### [should] firestore.rules:39,57 — `postCountValid()`/`serverTimestamped()` が `request.resource.data.members[uid]` のキー不在で評価例外になり、正当な「非メンバー系フィールドだけの更新」を巻き込み deny する

`postCountValid()`（:39）と `serverTimestamped()`（:57）は `request.resource.data.members[uid]` に `in` を適用するが、`members[uid]` 自体が **存在しないと `[uid]` アクセスでルール評価例外→deny**。`Member.postCount`/`lastPostAt` は optional（types.ts:19-21）で、さらに「まだ一度も参加処理で members に載っていない uid」や「members を一切触らない trip 更新（例: colorsAssigned 切替）」では `request.resource.data.members[uid]` が無い。member 更新ブランチが評価例外で落ちると、本来 allow したい更新まで拒否される。

これは fail-closed（安全側）なので must ではないが、**正当な更新を拒否する偽陰性**で、§5-6 の配布完了フラグ更新などが通らなくなる懸念。`'<uid>' in request.resource.data.members` の存在ガードを先に挟むべき:
```
function postCountValid() {
  let uid = request.auth.uid;
  return !(uid in request.resource.data.members)
    || !('postCount' in request.resource.data.members[uid])
    || (request.resource.data.members[uid].postCount >= 0
        && request.resource.data.members[uid].postCount <= 9);
}
```
`serverTimestamped()` も同様にガード。`rateOk()`（:48）は `resource.data`（既存）側を見るので既存 doc に members[uid] があれば概ね安全だが、対称性のため同じガードを推奨。**この挙動はエミュレータ実行で確定すべき**（机上では rules の `[]` アクセス例外の有無を断定しきれないため、人間側 `npm run test:rules` で「members[uid] 不在の trip 更新」ケースを1本追加して確認すること）。

---

#### [should] tests/rules/firestore.rules.test.ts 全体 — 「拒否されるべき改竄」の攻撃系テストが空白で、must 1・2 の穴をテストが一切検出できない

現テストは設計ケース表（1-15）の写経に留まり、以下の **拒否側**が1件も無い:
- メンバーによる他人 members 書き換え拒否（must 1）
- メンバーによる memberIds 改竄拒否（must 1）
- メンバーによる hostUserId 改竄拒否（must 1）
- 参加時の members 他人エントリ混入拒否（must 2）
- 未認証ユーザーの trip update 拒否（`isMember`/`isJoiningSelf` 両 false の確認）
- posts update/delete が deny である確認（ルールに update/delete 記述が無い＝暗黙 deny だが、昇格の「差し替え」が delete を要する設計なら明示テストで仕様を固定すべき）

これらが無いと、must を修正しても **回帰を捕まえられない**。上記 must の修正とセットで拒否ケースを追加すること。

---

#### [should] firestore.rules:70 — create ルールが `members` 構造を縛らず、postCount 初期値の改竄余地

`allow create`（:68-70）は `hostUserId == uid` と `memberIds == [uid]` のみ。`members` は無制約なので、作成時に `members[uid].postCount = 9` や `members[other]` の混入が可能。mock の createTrip は `members:{ [uid]:{...,postCount:0} }`（02-research.md:36）なので、整合のため:
```
allow create: if request.auth != null
  && request.resource.data.hostUserId == request.auth.uid
  && request.resource.data.memberIds == [request.auth.uid]
  && request.resource.data.members.keys().hasOnly([request.auth.uid])
  && request.resource.data.members[request.auth.uid].postCount == 0;
```
影響度は trip 新規作成時のみ・自分の postCount のみなので should。テストに「create 時に他人 members 混入を拒否」を1件追加推奨。

---

### nit

#### [nit] firestore.rules:24 — コメント「上限12人（SPEC §4）」の出典が不正確

上限12人の根拠は SPEC §61 / §198 / §279。コメント参照を `§4`（データモデル節）から実際の根拠節に直すと、後続の開発者が `MAX_MEMBERS=8`（colors.ts）との食い違いを追いやすい。

#### [nit] storage.rules:17 — `1.5 * 1024 * 1024` の境界が「未満（`<`）」で、ちょうど 1.5MiB は拒否

`request.resource.size < 1.5 * 1024 * 1024` は SPEC §271 の式（`< 1.5 * 1024 * 1024`）と完全一致で正。テスト（storage.rules.test.ts:62）も `+1` 超過で拒否を検証しており妥当。境界値（ちょうど 1572864 バイト）が拒否される仕様を明示テストするとなお良い（任意）。

#### [nit] firestore.rules:76 — posts read の `get()` 課金は設計どおり許容だが、コストはフィード購読回数に比例

設計・SPEC §13.3 で許容済み（購読共有＋limit(50) で抑制前提）。create 側で `get()` を避けている（:80-84）点は §13.3 整合で良い。記録目的のみ、修正不要。

---

## 設計準拠の判定

- **スコープ**: ルール層のみ。実 Firebase 実装層 / App Check / エミュレータ環境構築は未着手（やらないこと3点に準拠）。逸脱なし。
- **設計との差分**:
  - 設計 01 §83-99 の `postCountValid()`/`rateOk()` に加え、調査 02 §2-4 の結論どおり `serverTimestamped()`（`lastPostAt == request.time`）を実装。改竄耐性の強化として妥当・設計の意図内。
  - 設計 01 §50 の `<=12` をリテラル採用。SPEC 準拠で正。
  - **設計・調査が「正」と明記した `members.diff().affectedKeys().hasOnly([uid])` 強化（02 §2-3, §2-5）を未実装**。Implementer は「別Issue可」と解釈したが、調査の文面は「入れないと穴が残る」「mock と整合し壊さない」であり、本Issueのセキュリティ責務内。→ must 1・2 として差し戻し。
- **構成**: `firebase.json` / `jest.rules.config.js` / `testPathIgnorePatterns` / `test:rules` script / README、いずれも設計・調査どおり。型・分離・既存不変は実機確認で OK。

## テスト評価

- **網羅できている**: 設計ケース 1-15（許可/拒否の正常系）。型クリーン（tsc 0）。エミュレータ前提の構成（`initializeTestEnvironment` の `rules: readFileSync(...)`、`firebase@12` モジュラ API、`withSecurityRulesDisabled` seed、`Timestamp`/`serverTimestamp`）は調査 02 §2 の確定事項どおりで妥当。posts read 前の親 trip seed も対応済み。
- **カバー漏れ（リスク箇所）**:
  1. **member による任意フィールド改竄の拒否**（must 1）— 攻撃系が完全に空白。最重大。
  2. **参加時の members 混入拒否**（must 2）。
  3. **未認証ユーザーの trip update 拒否**、**posts update/delete の暗黙 deny 確認**。
  4. **members[uid] 不在の trip 更新**（should: 評価例外の有無確認）。
  5. **境界値**: caption ちょうど200（許可）はあるが、storage ちょうど 1.5MiB（拒否）が無い（nit）。
- **テストの実行検証は不可**（エミュレータ非起動）。緑確認は人間側 `npm run test:rules` 必須。Implementer が「無理に走らせて赤にしていない」のは正しい判断。

## セキュリティ観点まとめ

- **入力検証**: caption<=200・slotIndex 0..8・size<1.5MiB・contentType jpeg は実装済み・妥当。
- **認可**: read 系（trips/posts/inviteCodes/storage）は妥当。**write 系（trips update）に重大な認可漏れ**（must 1・2）。
- **機密情報**: 該当なし（ルールに秘密埋め込み無し）。
- **インジェクション**: 該当なし。
- **依存の脆弱性**: 依存追加なし（`@firebase/rules-unit-testing` / `firebase` は既存）。確認済み: 該当なし。

## 総評

**要修正（must あり）**。

ルール構成・テスト分離・既存不変（jest 49 / tsc 0）・型クリーンはすべて確認でき、配管としては完成度が高い。だが **trips update の認可がザル**（must 1: member ブランチに affectedKeys/不変フィールド制約が無く、任意のメンバーが memberIds・hostUserId・他人の members を書き換え可能 / must 2: 参加ブランチが members マップを無制約）で、これは「セキュリティルールの抜け＝重大」という本Issueの中核要件に直撃する。調査 02 自身が「正」と結論し mock 実挙動とも整合（＝既存を壊さない）と明記した強化が未実装で、かつ攻撃系テストが空白のため穴を検出すらできない。

Implementer 段階へ差し戻し、must 2件（+ 対応する拒否テスト追加）を修正のうえ再レビューとする。should（評価例外ガード・create の members 制約・攻撃系テスト拡充）も併せて対応を推奨。

---

# 再レビュー（差し戻し修正の確認）

Stage: 4/5 Reviewer（focused re-review・2往復目）

## 検証環境（実測・再確認）

- `npx jest`（デフォルト）= **5 suites / 49 passed**。✅ 不変。
- `npx tsc --noEmit` = **exit 0**（tests/rules も include 対象だが型クリーン）。✅ 不変。
- `npx jest --config jest.rules.config.js --listTests` = `firestore.rules.test.ts` / `storage.rules.test.ts` の **2本**。✅
- 当環境は Java / firebase-tools 無し ＝ エミュレータ起動不可。緑確認は不可、机上ロジックレビュー中心（前回同様）。
- 対象を直読み: `firestore.rules`（165行）/ `storage.rules`（21行）/ `tests/rules/firestore.rules.test.ts`（647行）/ `tests/rules/storage.rules.test.ts`（111行）。

## must-1 解消確認 — ✅ 解消

`firestore.rules:43-46` に `onlyMyMemberChanged()`（`members.diff(...).affectedKeys().hasOnly([request.auth.uid])`）、`:29-39` に `immutableOnSelfUpdate()`（`memberIds/hostUserId/name/startDate/endDate/status/colorsAssigned` すべて before==after）を追加。`allow update` の member ブランチ（`:127-130`）で `isMember() && onlyMyMemberChanged() && immutableOnSelfUpdate() && postCountValid() && rateOk() && serverTimestamped()` と AND されている。

- 他人追放 / memberIds 改竄: `immutableOnSelfUpdate` の `memberIds` 不変で封じ。テスト `firestore.rules.test.ts:258-277`（追放・改竄）で deny 検証あり。✅
- host 乗っ取り: `hostUserId` 不変。テスト `:280-288`。✅
- 他人 members 書き換え: `onlyMyMemberChanged` の `affectedKeys().hasOnly([uid])`。テスト `:291-299`（`members.alice.postCount=9` を bob が拒否）。✅
- status / colorsAssigned 改竄: `immutableOnSelfUpdate` で固定。テスト `:302-310`（status）。✅
- 未認証: テスト `:313-321`。✅

前回 must-1 の修正提案を上回る形（status/colorsAssigned まで不変化）で実装されており、過不足なし。

## must-2 解消確認 — ✅ 解消

`isJoiningSelf()`（`firestore.rules:55-68`）に、memberIds 集合演算（自分1件追加・既存不変・size<=12）に加えて `request.resource.data.members.diff(resource.data.members).affectedKeys().hasOnly([request.auth.uid])`（`:64-65`）と `hostUserId` 不変（`:67`）を AND。

- 参加時の他人 members 混入: テスト `:335-345`（`members.carol` 混入を拒否）。✅
- 参加時の既存メンバー書き換え: テスト `:348-358`（`members.alice.postCount=9` を拒否）。✅
- 参加時の hostUserId 改竄: テスト `:361-371`。✅
- 正当 join（自分の memberIds + members[uid] のみ）: テスト `:374-383` で succeed。✅

## must-3（最重要・回帰）— `isHostAssigningColors()` の裏口確認 — 裏口なし（must なし）。should 1件

`isHostAssigningColors()`（`firestore.rules:75-88`）を厳密に追跡した。`allow update` は `(member) || isJoiningSelf() || isHostAssigningColors()` の OR なので、このブランチが単独で成立すれば update が通る。以下を1つずつ確認:

- **`isHost()` 限定**: `:78` で `isHost()`（`request.auth.uid == resource.data.hostUserId`）必須。非 host は入れない。テスト `:422-433`（bob が全員分 color を配ろうとして拒否）。✅
- **一発ゲート（再配布不可）**: `:80-81` で `before.colorsAssigned == false && after.colorsAssigned == true` を要求。配布済み（before が true）は `before.colorsAssigned == false` が偽で全ブランチ落ち。テスト `:436-458`（配布済みへの再配布拒否）。✅ また after を true 以外にもできない（昇格専用）。
- **memberIds / hostUserId 改竄不可**: `:83-84` で両方 before==after。配布に乗じた追放を封じる。テスト `:461-471`（配布に乗じた memberIds 改竄拒否）。✅
- **member 制限の迂回（裏口性）の核心判定**: `isHostAssigningColors` は意図的に `onlyMyMemberChanged()` を**呼ばない**（host が全員分の color を書くのが正当経路だから、自分キー限定では成立し得ない）。よって「host は他人の members エントリを書ける」。これが member ブランチの `onlyMyMemberChanged` 制限を迂回する裏口になるか？
  - **結論: member（非host）にとっての裏口にはならない**。このブランチは `isHost()` で厳格に閉じている。一般メンバー bob はこの経路に入れず、bob にとって must-1 の制限は完全に有効。「member 更新ブランチの制限を一般攻撃者が迂回する裏口」は**存在しない**。回帰なし。
  - 残るのは「host 自身がこの一発ゲートで他人 members に任意値を書ける」点。ただし (a) host は trip 作成者で信頼境界が異なる、(b) `colorsAssigned: false→true` の一度きりで二度目は不可、(c) memberIds/hostUserId/期間/name は不変、という多重の枠がある。→ 後述 should 1 として記録（ブロックしない）。

### [should] firestore.rules:75-88 — `isHostAssigningColors()` が `status` を無制約・members 値の中身を無検査（host 一発ゲート内での過剰書き込み余地）

`isHostAssigningColors()` は `colorsAssigned` を `false→true` に固定するが `status` の遷移先を縛らない（`:80-87` に status 条項なし）。テスト `:407-419` は `status: 'active'` を書くが、host は同じ一発で `status: 'archived'` 等にもできる。また members 値の中身（他人の `postCount` を 9 にする・`color` 以外を書く等）を検査しないため、配布のドサクサで他人の postCount を改竄できる。

影響度: (1) host 限定、(2) 配布前（colorsAssigned=false）の一度きり、(3) memberIds/host/期間は不変、のため攻撃面は「host が自分のtripの配布時に1回だけ」に限局。だが「色配布」という名目に対し書ける範囲が広すぎる。次の開発者が status マシン（planning→active）を前提に組むと、ここが抜けになりうる。

修正提案（一発ゲート内を「色配布に必要な分」に絞る）:
```
function isHostAssigningColors() {
  let before = resource.data;
  let after = request.resource.data;
  return isHost()
    && before.colorsAssigned == false
    && after.colorsAssigned == true
    && after.memberIds == before.memberIds
    && after.hostUserId == before.hostUserId
    && after.name == before.name
    && after.startDate == before.startDate
    && after.endDate == before.endDate
    // 遷移先 status を planning→active に限定（任意の status 書き換えを禁止）
    && after.status == 'active'
    // members は全メンバー分の color 付与に限る（postCount 等の他フィールド改竄を禁止）
    && after.members.diff(before.members).affectedKeys().hasOnly(before.memberIds);
}
```
`affectedKeys().hasOnly(before.memberIds)` は「触れるキーは既存メンバーのみ＝新規キー混入不可」を担保。各メンバー値の postCount 不変まで縛るなら `members[uid].postCount == before.members[uid].postCount` の網羅が要るが rules では members 全員ループが書けないため、エミュレータ実機で「配布時に他人 postCount を上書きできるか」を1ケース足して確認推奨。本Issue（=セキュリティルールの抜け）の責務に触れるが、host 限定・一度きりのため **should**（本Issue はブロックしない範囲。host 信頼前提なら別Issue化も可）。

## must-4（存在ガード）確認 — ロジック上 妥当。机上断定不能点はエミュレータ確認推奨

`postCountValid()`（`:93-99`）/ `serverTimestamped()`（`:114-119`）は `!(uid in request.resource.data.members) || !('postCount' in ...members[uid]) || (範囲条件)` の短絡 OR で、members[uid] 不在・サブキー不在を先にガードしてから `[uid]` アクセスする構造。`rateOk()`（`:104-109`）も `resource.data`（既存）側で同型ガード。短絡評価が効けば不在例外を踏まずに正当更新を素通りさせ、攻撃（postCount>9・過去 lastPostAt）は範囲条件で捕まえる。ロジックは妥当。

- 正当更新を壊さない: テスト `:374-383`（join では members.bob を新規追加＝postCount は範囲内）、`:407-419`（host 配布は members[alice]/[bob]/[carol] に color のみ・postCount 不在キーは素通り）。✅
- 攻撃を通さない: テスト `:167-181`（postCount=10 拒否）、`:184-201`（10秒未満拒否）、`:223-240`（過去 lastPostAt 拒否）。✅
- **机上断定不能点（エミュレータ確認推奨）**: rules の `map[key]` アクセスにおいて、`!('postCount' in members[uid])` の `members[uid]` 自体が短絡前条件 `!(uid in ...members)` で守られているとはいえ、CEL 評価順と map インデックスの例外挙動は実機でしか確定できない。人間側 `npm run test:rules` で「members[uid] 不在のまま trip トップレベルだけ更新（例: 将来 status 遷移）」を1ケース流して評価例外で deny に倒れないか確認すること。ロジック上の穴ではないため must にはしない。

## must-5（テスト網羅）確認 — ✅ 拒否系・許可系とも追加され型クリーン

攻撃拒否系: 他人追放（`:258`）/ memberIds 改竄（`:269`）/ host 書換（`:280`）/ 他人 members 書換（`:291`）/ status 改竄（`:302`）/ 未認証 update（`:313`）/ 参加時混入（`:335`）/ 参加時既存書換（`:348`）/ 参加時 host 改竄（`:361`）/ 非host配布（`:422`）/ 再配布（`:436`）/ 配布に乗じた memberIds 改竄（`:461`）/ posts update deny（`:584`）/ posts delete deny（`:595`）/ create 時他人混入（`:475`）/ create 時 postCount≠0（`:488`）。
許可系: 正当 join（`:374`）/ host 正当配布（`:407`）/ 正当 create（`:498`）/ postCount=9（`:151`）/ 10秒超連投（`:203`）。
Storage: 境界値（ちょうど1.5MiB拒否 `:66` / 1.5MiB-1許可 `:73`）も追加され、前回 nit も解消。

前回指摘した攻撃系空白・create 制約・境界値はすべて埋まった。型は tsc 0 で清潔。

### テスト評価（残るカバー漏れ・should 範囲）

- should-1 に対応する「host が配布のドサクサで他人 postCount を改竄」ケースが無い（現状ルールでは通ってしまう＝拒否テストを足すなら先にルール修正が必要）。
- 「host が配布時に status を archived に飛ばす」ケースが無い。
- いずれも should（host 限定経路）のため本Issue ブロックなし。エミュレータ確認時に併せて追加推奨。

## 前回 should の追跡

- [前回 should] postCountValid/serverTimestamped の存在ガード → `:93-99`/`:114-119` で実装。✅（上記 must-4 で確認）
- [前回 should] 攻撃系テスト空白 → 解消（must-5）。✅
- [前回 should] create の members 制約 → `:139-140`（`members.keys().hasOnly([uid])` + `postCount == 0`）で実装、テスト `:475-496`。✅
- [前回 nit] コメント出典 §4 → `:52` で `SPEC §61/§198/§279` に修正。✅
- [前回 nit] storage 境界値テスト → `:66-77` で追加。✅

## 設計準拠の判定（再）

- **スコープ**: ルール層のみ。実 Firebase 実装層 / App Check / エミュレータ環境構築は未着手（やらないこと3点に準拠）。逸脱なし。
- **設計との差分**: 01-design §83-99 の `postCountValid`/`rateOk` + 02-research の `serverTimestamped`/`onlyMyMemberChanged`/`isJoiningSelf` 強化に加え、新規 `isHostAssigningColors()` ブランチを追加。これは SPEC §5-1（host が assignColors で全員分 color を1トランザクション書込・colorsAssigned 立て）を満たすための**正当な追加**で、member ブランチの `onlyMyMemberChanged` 制限とは別経路として必要（設計の意図内・スコープ内）。`isHost()` 限定で裏口化していない。
- **構成**: firebase.json / jest.rules.config.js / testPathIgnorePatterns / test:rules script / README、いずれも前回どおり健全。jest 49 / tsc 0 / rules 2本、不変確認済み。

## セキュリティ観点（再）

- **入力検証**: caption<=200・slotIndex 0..8・size<1.5MiB・jpeg・postCount 0..9・create 時 postCount==0、実装済み・妥当。
- **認可**: read（trips/posts/inviteCodes/storage）妥当。write（trips update）は member ブランチ・join ブランチ・host 配布ブランチとも適切に閉じられ、前回の認可漏れ（must-1/2）は解消。host 配布ブランチの過剰書込余地（should-1）のみ残るが host 限定・一度きり。
- **機密情報**: 該当なし。
- **インジェクション**: 該当なし。
- **依存の脆弱性**: 依存追加なし（`@firebase/rules-unit-testing` / `firebase` は既存）。確認済み: 該当なし。

## 総評（再レビュー）

**approve（承認・must なし）**。

前回差し戻しの must 2件は、修正提案を上回る形（status/colorsAssigned まで不変化）で解消。攻撃系テスト空白も 15+ 件の拒否ケース追加で解消し、型クリーン（tsc 0）・既存不変（jest 49 / rules 2本）も維持。最重要の回帰確認である `isHostAssigningColors()` は **`isHost()` で厳格に閉じており、一般メンバー（非host）が member ブランチの `onlyMyMemberChanged` 制限を迂回する裏口は存在しない**と断定する。`colorsAssigned: false→true` 一発ゲートで再配布不可、memberIds/hostUserId/期間も不変。

残る should-1（host 一発ゲート内の status 無制約・他人 members 値無検査）は **host 限定・配布前一度きり・構造系不変** という多重の枠の内側にあり、本Issue（セキュリティルールの抜け塞ぎ）の合否を左右しない。別Issue または次の更新で `status == 'active'` 限定と `members.diff().affectedKeys().hasOnly(memberIds)` を足すことを推奨として残す。

机上で断定できない rules の `map[key]` 例外挙動（must-4）は、人間側 `npm run test:rules`（Java + firebase-tools 用意後）で緑確認すること。これはロジックの穴ではなく実行検証の宿題であり、approve をブロックしない。

→ **段階5 Integrator へ進む。**
