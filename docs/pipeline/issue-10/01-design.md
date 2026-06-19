# 01-design.md

- Issue: #10
- Stage: 1/5 Architect
- 対象: 画像2サイズ生成（本画像・サムネ）のサイズ決定純ロジック + `ImageProcessor` 抽象（Mock + expo-image-manipulator 実装）。実 Storage は別Issue。

---

## 方針（1行）

サイズ決定は domain 層の純粋関数 `computeTargetSize` に閉じ込め、`ImageProcessor` interface を repository 層に切って Mock（node 完結）と Expo 実装（型のみ）の2実装を DI で隔離する。`Repositories` 束に `imageProcessor` を Mock 既定で追加するが、UploadQueue/promote には継ぎ目だけ用意して**まだ配線しない**。

## 設計方針（5-7行）

1. **アーキテクチャ**: domain（純ロジック・定数）→ repository（interface + Mock + Expo 実装）→ context（DI）の既存4層に従う。`expo-image-manipulator` は `ExpoImageProcessor` 内のみで import し、domain / Mock / types からは一切触らない（node テスト隔離の核）。
2. **データフロー**: `process(input: LocalImage)` → 入力 `width/height` を起点に `computeTargetSize(srcW,srcH,1600)`（main）と `(srcW,srcH,400)`（thumb）で目標寸法を算出 → Mock は uri をスタブ生成、Expo は manipulate を2回呼び `ProcessedImages` を返す。
3. **主要インターフェース**: `computeTargetSize(srcW,srcH,maxLongEdge): {width,height}`、`ImageProcessor.process(input): Promise<ProcessedImages>`、`ProcessedImage = {uri,width,height}`、`ProcessedImages = {main,thumb}`。
4. **DB変更**: なし（Firestore / Storage は別Issue。`Post.imageURL/thumbURL` のスキーマは既存のまま）。
5. **エラーハンドリング**: `computeTargetSize` は純粋・例外を投げない（0/負/極端比は安全にクランプ）。`width/height` 欠落（`LocalImage` は optional）時の入力寸法フォールバックを明示し、Investigator に正の仕様確認を回す。Expo 実装の I/O 例外は呼び出し側（将来の §9-7後半 配線）に透過。

## computeTargetSize の確定仕様（Implementer がそのまま書ける粒度）

```ts
// src/domain/image-sizing.ts
export function computeTargetSize(
  srcW: number,
  srcH: number,
  maxLongEdge: number,
): { width: number; height: number };
```

- **縮小のみ・拡大しない**: 長辺 `max(srcW,srcH)` が `maxLongEdge` 以下なら入力寸法をそのまま返す（整数化のみ）。
- **アスペクト比保持**: `scale = maxLongEdge / longEdge`（縮小時のみ <1）。両辺に同じ scale を掛ける。
- **丸め**: `Math.round`。ただし**長辺は max を絶対に超えない**よう、長辺側は `Math.round` 後に `Math.min(_, maxLongEdge)` でクランプ（丸め誤差で 1601px が出るのを封じる。リスク7参照）。短辺は `Math.max(1, Math.round(...))` で最低1px保証。
- **0・負・NaN**: `srcW<=0 || srcH<=0`（または非有限）の場合は `{width:0,height:0}` を返す（呼び出し側がスキップ判断できる安全値）。`maxLongEdge<=0` も同様。← この返り値仕様は Investigator 確認事項に含める。
- **極端比**: 例 4000x10 を 1600 に → 長辺 1600 / 短辺 `Math.max(1, round(10*0.4))=4`。短辺が 0 に潰れない保証を満たす。

## 型 / 定数の置き場所

- `src/domain/image-sizing.ts`: `computeTargetSize` と定数 `MAIN_MAX_LONG_EDGE = 1600` / `THUMB_MAX_LONG_EDGE = 400` / `JPEG_QUALITY = 0.7`（§13.3 を1か所に集約）。
- `src/repositories/types.ts`: `ProcessedImage` / `ProcessedImages` / `ImageProcessor` interface を追加し、`Repositories` 束に `imageProcessor: ImageProcessor` を追加。

## 本画像長辺 = 1600 の確定（食い違いの裁定）

- SPEC §5-5 本文(L91 `imageURL` コメント)と L127 は「2048px」表記が混在。一方 **§13.3 実装コスト規律（L269-270）は「長辺1600px・JPEG0.7・約300KB目安、サムネ400px」**、`src/domain/types.ts` の `imageURL` フィールドコメントも「長辺1600px」。
- **裁定: 1600 を正とする。** 根拠＝(a) コスト規律 §13.3 は実装で守る数値として明記されている、(b) 無料枠運用が事業性の核（Issue 明記）、(c) 既存 domain 型コメントが既に 1600。
- **副作用**: SPEC L127 の「2048px」表記は §13.3 と矛盾。今回 SPEC 本文は**修正しない**（別途 doc 整合 PR）。本Issue の定数は 1600 で確定。

## 採用理由とトレードオフ

- **採用: 純関数を domain に分離 + interface を repository に + 2実装を DI 隔離。** node テストが native 非依存で完結し、Expo 実装を型チェックのみに切れる（Issue 制約に直結）。
- 却下A: `ExpoImageProcessor` に寸法計算も同居 → 実装速いが純ロジックを node テストできず、expo-image-manipulator が node テストに混入してリスク7が現実化。
- 却下B: `imageProcessor` を `PostRepository.promotePhoto` 内へ直結 → 配線は減るが Storage 未実装の今は死にコード化し、別Issue の責務境界（§9-7後半）を侵食。

## スコープ（影響範囲）

| 区分 | ファイル | 内容 | 規模オーダー |
|------|----------|------|------|
| 新規 | `src/domain/image-sizing.ts` | `computeTargetSize` + 3定数 | ~40行 |
| 新規 | `src/domain/image-sizing.test.ts` | 純関数の node テスト | ~70行 |
| 新規 | `src/repositories/mock/mock-image-processor.ts` | `MockImageProcessor`（expo 非依存） | ~30行 |
| 新規 | `src/repositories/mock/mock-image-processor.test.ts` | Mock の node テスト | ~50行 |
| 新規 | `src/repositories/expo/expo-image-processor.ts` | `ExpoImageProcessor`（型のみ・node テスト対象外） | ~40行 |
| 変更 | `src/repositories/types.ts` | `ProcessedImage`/`ProcessedImages`/`ImageProcessor` 追加 + 束へ `imageProcessor` | ~25行 |
| 変更 | `src/repositories/mock/index.ts` | `createMockRepositories` に `imageProcessor: new MockImageProcessor()` | ~3行 |
| 変更 | `src/repositories/context.tsx` | 束に Mock が入るのでロジック変更不要（自動的に注入）。原則ノータッチ | 0行 |

合計 1 PR 完結サイズ（小〜中、テスト込み ~300行）。

## やらないこと（3点）

1. 実 Storage / Firebase アップロード（§9-7後半・別Issue）。`ProcessedImages.uri` は Mock ではローカル/スタブ、Expo では manipulate 出力のローカル URI のまま。
2. `UploadQueue` / `PostRepository.promotePhoto` への実配線。`imageProcessor` は束に積むだけ（継ぎ目のみ）。
3. expo-camera 実カメラ統合、および SPEC 本文 L127「2048px」表記の文面修正。

## リスク

1. **node テスト汚染**: `expo-image-manipulator` を domain / Mock / types に import しない。Expo 実装は `src/repositories/expo/` に隔離し、`createMockRepositories` 経路からは到達しない。jest は既存設定で `expo/` を実行しても native モジュール解決で落ちる懸念 → Investigator に「expo-image-processor を jest が拾わない or 落ちない構成か」を確認させる。
2. **SDK54 API シグネチャ未確定**: `manipulateAsync` か新 `ImageManipulator.manipulate(...).resize(...).renderAsync().saveAsync(...)` か、`SaveFormat.JPEG`・`compress` の引数形が v14 で変わっている可能性。docs.expo.dev/versions/v54.0.0 で要実機確認（Investigator）。
3. **丸めで長辺が max を 1px 超える**: `computeTargetSize` で長辺側を `Math.min(_, maxLongEdge)` クランプ。テストで「ちょうど max」「丸め境界（例 1599.6→1600 で超えない）」を必ず検証。
4. `LocalImage.width/height` は optional。欠落時のフォールバック（入力寸法不明をどう扱うか）が未定義 → Investigator 確認。

## Investigator への確認事項

1. **expo-image-manipulator v14（SDK54）の正確な API と戻り値型**: `manipulateAsync(uri, actions, options)` の現行可否 / 新 Context API（`ImageManipulator.manipulate`）の要否、`resize({width} or {height})` の指定方法、`SaveFormat.JPEG` + `compress: 0.7` の指定箇所、返り値（`{uri,width,height}` か）。`ExpoImageProcessor` のシグネチャ確定に必須。
2. **jest が `src/repositories/expo/*.ts` を実行対象から外す / native import で落ちない構成か**（testPathIgnorePatterns or 命名規約）。既存51テストの jest 設定確認。
3. `computeTargetSize` の 0・負・NaN 入力時の返り値仕様（`{0,0}` でよいか、呼び出し側のスキップ前提と整合するか）と、`LocalImage.width/height` 欠落時のフォールバック方針。
4. `ProcessedImage` に `width/height` を持たせる前提で、将来 `Post.imageURL/thumbURL` 書き込み（§9-7後半）と齟齬がないか（型の前方互換）。
