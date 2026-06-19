# 04-review.md

- Issue: #10
- Stage: 4/5 Reviewer

レビュー対象: 画像2サイズ決定ロジック（`computeTargetSize`）+ `ImageProcessor` 抽象（Mock + Expo 実装）。基準 = `01-design.md` / `02-research.md` / SPEC §13.3。実 SDK54（expo-image-manipulator ~14.0.8）。

## 検証結果（自分で実行）

- `npx tsc --noEmit` → **exit 0**（型エラーなし）。
- `npx jest` → **7 suites / 72 tests passed**。
- `npx jest --listTests | grep expo-image-processor` → **0**（expo 実装は jest 非対象、native 混入なし）。
- expo v14 API 実物照合: `ImageManipulatorContext.resize({width?|height?})` 片方指定で比率自動保持（`ImageManipulatorContext.d.ts:8-17`）、`ImageRef.saveAsync(SaveOptions): Promise<ImageResult{uri,width,height}>`（`ImageRef.d.ts:5-20`）。実装と一致。`manipulateAsync`（deprecated）は不使用。
- caller `compose.tsx:101` は `{ uri: selected }` のみ（width/height 欠落が常態）→ Mock の欠落フォールバックは現実に必要。research §4 の事実を確認。

---

## 設計準拠の判定: スコープ逸脱なし・設計どおり

- `computeTargetSize(srcW,srcH,maxLongEdge): {width,height}` シグネチャ・domain 配置・定数（1600/400/0.7）すべて設計どおり（`image-sizing.ts:10-14,27-31`）。
- `ProcessedImage`/`ProcessedImages`/`ImageProcessor` を `types.ts:35-54` に追加、`Repositories` 束へ `imageProcessor` 1行追加（`types.ts:195`）。
- Mock 注入は `mock/index.ts:30` の1行のみ。`context.tsx` 無改修（自動注入）。
- expo 実装は `expo-image-manipulator` を `expo/expo-image-processor.ts` 内のみで import（`:15`）。domain / Mock / types は非依存。native 隔離成立。
- promote/UploadQueue への配線なし（継ぎ目のみ）。実 Storage・expo-camera 未着手。**「やらないこと」3点を厳守。**

差分なし。スコープ逸脱なし。

---

## 指摘リスト

### [should] expo-image-processor.ts:32-36 — `process` のコメントと実コードの責務がずれている（誤読を招く）
`process` 内コメントは「欠落時は原寸保存（リサイズ省略）にフォールバック」と書くが、フォールバック判定の実体は `resizeTo` の `srcW != null && srcH != null` ガード（`:52`）にあり、`process` 側は単に `input.width/height`（`number | undefined`）を渡すだけ。コメント位置と実装位置が乖離しており、将来 `process` だけ読んだ開発者が `process` 内にガードがあると誤認する。
**修正提案**: `:32` のコメントを「欠落・縮小不要の判定は `resizeTo` 内（target が {0,0} ならリサイズ省略）」に寄せるか、コメントを `resizeTo` 側へ移す。挙動は正しいのでコメント整合のみ。

### [nit] mock-image-processor.ts:23 / FALLBACK_SRC_LONG_EDGE = 2000 — Mock 専用の便宜値だが thumb 比率テストが暗黙に依存
`FALLBACK_SRC_LONG_EDGE = 2000` は正方フォールバック。`mock-image-processor.test.ts:39-49`（寸法欠落）は「長辺 ≤ max かつ > 0」しか検証せず、正方 2000 → main 1600 / thumb 400 という具体値は固定していない。値変更時にテストが気づかない。
**修正提案（任意）**: 欠落ケースで `main` が `{1600,1600}`、`thumb` が `{400,400}` になることを1つ assert 追加すると、フォールバック寸法の回帰を固定できる。挙動上の問題ではないので nit。

### [nit] image-sizing.test.ts:48-53 — 「丸めで max を超えない」テストのケース選定が弱い
`computeTargetSize(1601,1600,1600)` は longEdge=1601, scale=1600/1601。width = round(1601\*scale)=round(1600)=1600 で、そもそも丸め誤差で 1601 が出るケースになっていない（min クランプが無くても 1600 になる）。リスク3で本来塞ぎたい「round が maxLongEdge を超える」状況を実際には踏んでいない。
**修正提案（任意）**: クランプが無ければ落ちるケースを足す。例: 長辺側が round で max+1 になる入力を作るのは難しい（scale=max/longEdge なので round(longEdge\*scale) は理論上 max を超えない）ため、min クランプは防御的コードと割り切り、テストコメントを「防御的クランプの確認（通常経路では round が max を超えないため min は no-op）」に直すのが正確。挙動は安全側で正しい。

---

## セキュリティ観点

確認済み: 該当なし。本変更は純粋な寸法計算 + ローカル画像変換の継ぎ目のみ。外部入力検証・認可・機密情報・インジェクション・新規依存の追加なし（`expo-image-manipulator` は既存 dependency `~14.0.8`、`package.json:21`）。`uri` はローカルファイル参照でネットワーク送信なし（実 Storage は別Issue）。

---

## テスト評価

リスク箇所のカバレッジは良好。

- `computeTargetSize`: 横長/縦長/正方/据え置き/ちょうどmax/極端比(4000x10, 100000x1)/0/負/NaN/Infinity/undefined/maxLongEdge<=0 を網羅（`image-sizing.test.ts`）。境界（最低1px保証・縮小のみ）を固定済み。
- MockImageProcessor: 長辺上限・比率保持・据え置き・uri スタブ・寸法欠落フォールバック・片側欠落・不正寸法(0/負)を網羅（`mock-image-processor.test.ts`）。リスク2（欠落常態）を 0px に潰さない保証で固定。
- expo 実装はテストなし（設計どおり node 解決不可のため対象外。`--listTests` で 0 確認）。

**カバー漏れ（追加推奨・いずれも nit〜should 未満）**:
- 欠落フォールバックの具体寸法固定（上記 nit、`FALLBACK_SRC_LONG_EDGE` 回帰防止）。
- expo 実装の正しさは型チェックのみで担保。`renderAsync` await 漏れ・single-edge resize・実測寸法採用は静的にしか確認できないが、API 照合（research §1 + 本レビューで実物 d.ts 照合）で裏付け済み。実機検証は配線Issue（§9-7後半）に持ち越しで妥当。

---

## 総評: approve

- must: **0件**。
- tsc 0 / jest 72 green / expo native 隔離成立 / スコープ厳守 / セキュリティ該当なし。
- 残る指摘は should 1（コメント整合）+ nit 2（テスト固定の強化・クランプ説明）のみで、いずれもマージをブロックしない。設計の確定仕様（縮小のみ・比率保持・長辺クランプ・最低1px・{0,0}フォールバック）を実装とテストが正確に固定している。

**判定: approve（must なし）。** should/nit は次段 Integrator または別 PR で拾えば足りる。
