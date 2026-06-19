# 03-implementation.md

- Issue: #10
- Stage: 3/5 Implementer
- ブランチ: `pipeline/issue-10`（コミットなし）

---

## 変更/新規ファイル一覧（各1行の変更意図）

| 区分 | ファイル | 変更意図 |
|------|----------|----------|
| 新規 | `src/domain/image-sizing.ts` | `computeTargetSize` 純関数 + 定数 `MAIN_MAX_LONG_EDGE=1600`/`THUMB_MAX_LONG_EDGE=400`/`JPEG_QUALITY=0.7` を1か所に集約。 |
| 新規 | `src/domain/image-sizing.test.ts` | 純関数の node テスト（横長/縦長/正方/据え置き/ちょうどmax/丸めクランプ/極端比/0・負・NaN・max不正フォールバック）。 |
| 新規 | `src/repositories/mock/mock-image-processor.ts` | expo 非依存の `MockImageProcessor`。computeTargetSize で寸法算出、uri はスタブ、寸法欠落フォールバック実装。 |
| 新規 | `src/repositories/mock/mock-image-processor.test.ts` | Mock の node テスト（main≤1600/thumb≤400/比率保持/小入力据え置き/寸法欠落・片欠落・不正寸法フォールバック/uri スタブ）。 |
| 新規 | `src/repositories/expo/expo-image-processor.ts` | `ExpoImageProcessor`（v14 新 Context API・型のみ・node テスト対象外）。 |
| 変更 | `src/repositories/types.ts` | `ProcessedImage`/`ProcessedImages`/`ImageProcessor` 追加 + `Repositories` 束へ `imageProcessor` 追加。 |
| 変更 | `src/repositories/mock/index.ts` | `createMockRepositories` の返り束へ `imageProcessor: new MockImageProcessor()` を追加（他依存なし）。 |

`context.tsx` は無改修（`createMockRepositories()` が `imageProcessor` を含む束を返すため自動注入）。

## computeTargetSize の仕様（フォールバック含む）

```ts
computeTargetSize(srcW: number, srcH: number, maxLongEdge: number): { width: number; height: number }
```

- **縮小のみ・拡大しない**: 長辺 `max(srcW,srcH) <= maxLongEdge` なら入力を整数化（`Math.round`）して返す。
- **アスペクト比保持**: `scale = maxLongEdge / longEdge` を両辺へ。
- **丸め + クランプ**: 長辺側は `Math.min(Math.round(_), maxLongEdge)`（丸め誤差で max+1px を出さない）、短辺側は `Math.max(1, Math.round(_))`（極端比でも 0px に潰さない）。
- **フォールバック {0,0}**: `srcW/srcH/maxLongEdge` のいずれかが 非有限（NaN/Infinity）・0・負なら `{width:0,height:0}`。`undefined` を数値として渡しても NaN 経由でこの枝に落ちる。呼び出し側が「resize スキップ／原寸保存」の判断に使う安全値。
- 例: `4000x3000→1600` = `{1600,1200}`、`4000x10→1600` = `{1600,4}`、`800x600→1600` = `{800,600}`（据え置き）。

## expo v14（SDK54）API の使い方（ExpoImageProcessor 内のみ）

旧 `manipulateAsync` は `@deprecated` なので不使用。新 Context API のチェーン:

```ts
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

let context = ImageManipulator.manipulate(uri);
context = context.resize({ width: target.width }); // 長辺のみ指定（他方は SDK が比率保持で算出）
const ref = await context.renderAsync();            // await 必須（漏れると Promise を saveAsync して落ちる）
const result = await ref.saveAsync({ compress: JPEG_QUALITY, format: SaveFormat.JPEG });
// result: { uri, width, height } を ProcessedImage にマップ（申告寸法は実測値を採用）
```

- リサイズは **長辺のみ指定**（両辺指定の丸め歪み回避）。寸法不明（target が `{0,0}`）なら resize を呼ばず原寸保存。
- 申告 `width/height` は `saveAsync` の戻り（実測）を採用し、ファイル実体と一致させる。
- このファイルは native 解決が要るため `.test.ts` を作らない（jest 非対象・型のみ通す）。

## Investigator リスク3件への対応

1. **リスク1（旧 deprecated API 誤用 / renderAsync await 漏れ）**: `ExpoImageProcessor` は新 Context API（`manipulate→resize→renderAsync→saveAsync`）のみ使用。`manipulateAsync` を import しない。`renderAsync()` は明示 `await`、その戻り `ImageRef` に対して `saveAsync` を `await`。`SaveFormat.JPEG` enum + `compress: JPEG_QUALITY(0.7)`。
2. **リスク2（寸法 undefined が常態）**: domain は `undefined→NaN→{0,0}` フォールバック。実装側ガードを2層で実装 — Mock は欠落/0/負/NaN を `FALLBACK_SRC_LONG_EDGE(2000)` 正方へ置換し `{0,0}` を resize へ流さない。Expo は `srcW/srcH` 欠落時に `{0,0}` 判定で resize 自体をスキップ（原寸保存）。テストは `image-sizing.test.ts`（0/負/NaN/undefined）と `mock-image-processor.test.ts`（欠落/片欠落/不正寸法で 0px に潰れないことを検証）の両方でカバー。
3. **リスク3（長辺クランプ・両指定の歪み）**: domain は長辺 `Math.min(_, maxLongEdge)` クランプ。テストで「ちょうど max」「丸めで 1601 を出さない（`1601x1600→1600`）」「極端比 `4000x10→1600/4`」「`100000x1→1600/1`」を検証。Expo は **長辺のみ resize** + `saveAsync` 実測寸法採用で申告と実体の不一致を回避。

## 検証結果

- `npx tsc --noEmit` = **0 エラー**（expo 実装含め型クリーン。`TSC_OK`）。
- `npx jest` = **7 suites / 72 tests 全 pass**（既存 51 + 追加 21 = 72。追加 2 suites = image-sizing.test.ts + mock-image-processor.test.ts、合計 21 tests）。
- `jest --listTests` に `src/repositories/expo/expo-image-processor.ts` は**含まれない**（`.test.` 無し・Mock/context から到達なし）。node テストへの native 混入なし。

## スコープ遵守

- 実 Storage / Firebase アップロード配線なし（uri は Mock スタブ / expo ローカル URI のまま）。
- `UploadQueue` / `PostRepository.promotePhoto` への配線なし（束に積むだけの継ぎ目）。
- `context.tsx` 無改修。expo 実装を context から static import していない。
- SPEC 本文 L127「2048px」表記は未修正（別 doc 整合 PR）。expo-camera 非統合。

## Reviewer 申し送り

- 設計の本画像長辺は **1600 確定**（§13.3 規律・`domain/types.ts` の `imageURL` コメントと一致。SPEC L127「2048」は今回触らず別 PR）。
- `MockImageProcessor` の `FALLBACK_SRC_LONG_EDGE = 2000` は Mock 専用の便宜値（実画像を読まないため）。compose 経路は width/height が常に欠落（research §4）するため、Mock では縮小が必ず働く 2000 を採用して main/thumb が上限に張り付くことをテストで確認できるようにした。
- 寸法不明ハンドリングは設計どおり「domain は純粋に数値 in→out（欠落は `{0,0}`）」「undefined ガードは ImageProcessor 実装側の責務」で分離。
- `ProcessedImage.width/height` は将来 Storage 書き込み（別Issue §9-7後半）用の前方データ。現スキーマ `Post.imageURL/thumbURL`（string）は uri のみ書く前提で齟齬なし。
- 設計に実装不能な矛盾は無し（申し送り該当なし）。
