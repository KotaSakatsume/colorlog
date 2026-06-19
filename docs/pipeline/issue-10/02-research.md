# 02-research.md

- Issue: #10
- Stage: 2/5 Investigator

調査対象リポジトリ: `/Users/kotasakatsume/colorlog/colorlog54`。SDK54 実 SDK。tsc 0 / jest（現在51）を壊さない前提で、設計（`01-design.md`）の実装に要る事実を集めた。事実は `file:line` / node_modules 実物引用付き。推測は末尾「推測・判断」欄に分離。

---

## 0. 設計末尾「確認事項」への直接回答（結論先出し）

1. **expo-image-manipulator v14（SDK54）API**: 旧 `manipulateAsync(uri, actions, saveOptions)` は **まだ存在するが `@deprecated`**（`build/ImageManipulator.d.ts:15-18`）。新・推奨は **`ImageManipulator.manipulate(uri).resize({width|height}).renderAsync()` → `ImageRef.saveAsync({compress, format})`** のチェーン。戻り値 `saveAsync` は `ImageResult = {uri, width, height, base64?}`（`build/ImageManipulator.types.d.ts:5-25`）。`resize` は `{width?, height?}` の片方指定で比率自動保持。詳細は §1。
2. **jest が expo を拾うか**: 既定 jest の `testMatch` は `**/*.test.ts(x)`（`jest.config.js:21`）。`expo-image-processor.ts` は `.test.` を含まないので**それ自体はテスト対象外**。さらに `context.tsx` は `@/repositories/mock` のみ import し `expo/` を一切参照しない（`context.tsx:10`）ため、Mock 経由の node テストに expo 実装は到達しない。**現状 expo ディレクトリは未作成**（`src/repositories/expo/` なし）。詳細は §2。
3. **DI/型の足し位置**: `Repositories` 束は `types.ts:168-173`、組み立ては `mock/index.ts:15-30`。`imageProcessor` の追加位置を §3 で確定。
4. **`computeTargetSize` の入力**: `LocalImage.width/height` は optional（`types.ts:28-32`）。**実呼び出し側 `compose.tsx:101` は `{ uri: selected }` のみで width/height を渡していない** → 欠落フォールバックは机上でなく現実に必要。詳細は §4。
5. **`Post.imageURL/thumbURL` 型整合**: 共に `string`（`types.ts:55,57`）。`ProcessedImage.{uri,width,height}` から `uri` を書く前提で前方互換に齟齬なし。コメントは既に「長辺1600px」（`types.ts:56`）で設計の 1600 裁定と一致。

---

## 1. expo-image-manipulator v14.0.8（SDK54）の正確な API

`node_modules/expo-image-manipulator/package.json` → `"version": "14.0.8"`。`package.json:21` の依存も `~14.0.8`。

### 1-1. 旧 API（deprecated・使わない）
`build/ImageManipulator.d.ts:15-18`:
```
* @deprecated It has been replaced by the new, contextual and object-oriented API.
* Use [`ImageManipulator.manipulate`](#manipulatesource) or [`useImageManipulator`] instead.
export declare function manipulateAsync(uri: string, actions?: Action[], saveOptions?: SaveOptions): Promise<ImageResult>;
```
動く可能性は高いが deprecated。新規実装では避ける。

### 1-2. 新 API（推奨・これで実装）
- エントリ: `index.d.ts:1` が `ImageManipulator`（= ネイティブモジュール実体）を再エクスポート。`ImageManipulator.manipulate(source)` がコンテキストを返す（`ImageManipulator.types.d.ts:106-119`）。
  ```
  export declare class ImageManipulator extends NativeModule {
    manipulate(source: string | SharedRef<'image'>): ImageManipulatorContext;
  }
  ```
- チェーン: `build/ImageManipulatorContext.d.ts:8-50`
  - `resize(size: { width?: number | null; height?: number | null }): ImageManipulatorContext`（`:14-17`）。**片方だけ指定すると他方は比率自動算出**（同コメント `:10-13`）。
  - `renderAsync(): Promise<ImageRef>`（`:49`）。
- 保存: `build/ImageRef.d.ts:6-20`
  ```
  export declare class ImageRef extends SharedRef<'image'> {
    width: number;
    height: number;
    saveAsync(options?: SaveOptions): Promise<ImageResult>;
  }
  ```

### 1-3. 型（戻り値・SaveOptions・SaveFormat）
`build/ImageManipulator.types.d.ts`:
- `ImageResult = { uri: string; width: number; height: number; base64?: string }`（`:5-25`）。
- `SaveOptions = { base64?: boolean; compress?: number; format?: SaveFormat }`（`:89-105`）。`compress` は **0.0–1.0**（1=無圧縮、`:94-98`）。`format` 既定は JPEG（`:99-104`）。
- `SaveFormat` は **enum**（`:81-85`）: `JPEG = "jpeg"`, `PNG = "png"`, `WEBP = "webp"`。import 名は `SaveFormat`（`index.d.ts:2`）。

### 1-4. 確定する正しい使い方（ExpoImageProcessor 内のみ）
```ts
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
const ctx = ImageManipulator.manipulate(uri).resize({ width: target.width, height: target.height });
const ref = await ctx.renderAsync();
const result = await ref.saveAsync({ compress: JPEG_QUALITY, format: SaveFormat.JPEG });
// result: { uri, width, height }
```
注意:
- `resize` に **width/height 両方**を渡すと比率を崩しうる。`computeTargetSize` が比率保持済みの整数を返す前提なら両指定で一致するが、丸め差で歪む懸念があるなら**長辺のみ指定**（他方は SDK 自動算出）が安全。§6 リスク参照。
- import は名前付き `ImageManipulator`（クラス実体）。`SaveFormat` も名前付き。`manipulateAsync` は使わない。

---

## 2. jest が native（expo）を拾わない構成か

### 2-1. 既定 jest 設定（`jest.config.js`）
- `testEnvironment: 'node'`（`:13`）
- `transform`: `babel-jest` + `babel-preset-expo`（`:14-16`）
- `testMatch: ['**/*.test.ts', '**/*.test.tsx']`（`:21`）
- `testPathIgnorePatterns: ['/node_modules/', '/tests/rules/']`（`:24`）

→ **テスト対象はファイル名が `*.test.ts(x)` のものだけ**。`src/repositories/expo/expo-image-processor.ts` は `.test.` を含まないので**走らない（a 成立）**。

### 2-2. expo 実装が import 経由で node テストに漏れないか（b）
- `context.tsx:10` は `import { createMockRepositories } from '@/repositories/mock';` のみ。**expo を参照しない。**
- `mock/index.ts` は mock-* と storage のみ import（`:1-9`）。expo 非参照。
- `expo/` ディレクトリは**現状存在しない**（`ls` で「NO expo dir」）。新設後も、設計どおり Mock 側からは到達しない経路を保つ限り、`expo-image-manipulator`（ネイティブ解決が要る）は node テストにロードされない。
- リスクは「テストファイルや Mock が誤って `@/repositories/expo/...` を import する」場合のみ。現状そのような import は皆無（grep で 0 件）。

### 2-3. context.tsx をテストが import するか
- `context.tsx` を import するテストは現状なし（テストは `mock-*.test.ts` と `domain/*.test.ts`、`tests/rules/`）。仮に将来 context をテストしても、context は Mock のみ束ねるので expo 非ロード。**DI で本番アダプタを評価しない構成は成立する。**

結論: 設計の「expo を `src/repositories/expo/` に隔離し Mock 経路から到達させない」で **jest 汚染は起きない**。明示的な ignore パターン追加は不要（命名規約 `.test.` で十分）。ただし保険として §6 に注記。

---

## 3. 既存 DI / 型の前例と `imageProcessor` の足し位置

### 3-1. `Repositories` 束（`src/repositories/types.ts:168-173`）
```
export type Repositories = {
  auth: AuthService;
  trips: TripRepository;
  posts: PostRepository;
  uploadQueue: UploadQueue;
};
```
→ ここに `imageProcessor: ImageProcessor;` を 1 行追加。`ProcessedImage` / `ProcessedImages` / `ImageProcessor` interface は `LocalImage`（`:28-32`）の近く、または束定義の直前に追加するのが既存の並び（type → interface → 束）に沿う。

### 3-2. `LocalImage` 型（`src/repositories/types.ts:28-32`）
```
export type LocalImage = {
  uri: string;
  width?: number;
  height?: number;
};
```
`ImageProcessor.process(input: LocalImage)` の入力型として既存をそのまま使える。

### 3-3. Mock 組み立て（`src/repositories/mock/index.ts:15-30`）
```
export function createMockRepositories(): Repositories {
  const db = new MockBackend();
  seedMockData(db);
  const posts = new MockPostRepository(db);
  const uploadQueue = new MockUploadQueue({ promotePhoto: ..., store: ... });
  return {
    auth: new MockAuthService(),
    trips: new MockTripRepository(db),
    posts,
    uploadQueue,
  };
}
```
→ `MockImageProcessor` は他に依存しない（db 不要・引数なしで構成可能）。`return` オブジェクトに `imageProcessor: new MockImageProcessor(),` を追加し、import を `:4-8` の並びに `import { MockImageProcessor } from './mock-image-processor';` で足す。**組み立て順制約なし**（posts/uploadQueue のような相互依存がない）。

### 3-4. context.tsx
`context.tsx:17` の `createMockRepositories()` がそのまま `imageProcessor` を含む束を返すので、**context は無改修で自動注入**（設計どおり 0 行変更）。

---

## 4. `computeTargetSize` 仕様確定に要る事実

- `LocalImage.width/height` は **optional**（`types.ts:28-32`）。
- 実呼び出し側 `src/app/trip/[id]/compose.tsx:101` は `localImage: { uri: selected }` で **width/height を渡していない**。`selected` は画像ピッカー結果の URI 文字列（同ファイル周辺）。
- `UploadJob.localImage` も `{ uri; width?; height? }`（`domain/types.ts:97`）で optional。`mock-upload-queue.ts:69` は `width: input.localImage.width, height: input.localImage.height`（= undefined を保持）。
- 現 Mock 昇格は寸法を使わず `thumbURL = imageURL = localImage.uri`（`mock-post-repository.ts:67-68`）。

帰結（事実に基づく仕様要請）:
- **width/height 欠落が常態**（compose 経路では常に undefined）。`computeTargetSize` の手前で寸法不明をどう扱うか必須。設計は「`srcW<=0 || srcH<=0`（非有限含む）→ `{0,0}`」。undefined は数値でないので呼び出し側（ExpoImageProcessor / Mock）が「寸法不明 → 何もリサイズせず原寸 or resize 省略」を判断する必要がある。
- 実 Expo では `ImageRef.width/height`（`ImageRef.d.ts:10-13`）や `expo-image-picker` 結果に実寸が乗るため、**Expo 経路では実寸を入手可能**。Mock は寸法を持たないのでスタブ寸法を返す。
- よって `computeTargetSize` 自体は純粋に「数値 in → 数値 out」。undefined ハンドリングは `ImageProcessor` 実装側の責務にするのが整合的（設計の「呼び出し側がスキップ判断できる安全値 {0,0}」とも合う）。

`Post.imageURL/thumbURL` は `string`（`types.ts:55-57`）。`ProcessedImage.width/height` は将来 Storage 書き込み（別Issue）で Firestore に寸法を載せたくなった時のための前方データ。現スキーマは `uri`（string）のみ書くので**齟齬なし**。

---

## 5. 既存テストの作法（純関数テスト前例）

- `src/domain/assign-colors.test.ts:1` → `import { describe, expect, it } from '@jest/globals';`（明示 import が規約）。ファクトリ関数 `makeTrip`（`:16-`)で入力を組み、`describe`/`it`/`expect` でケース列挙。
- 他の純関数テスト前例: `src/domain/merge-best-nine.test.ts`, `src/domain/invite-code.test.ts`。いずれも `src/domain/<name>.test.ts` の**同階層・同名 .test.ts** 配置。
- Mock のテスト前例: `src/repositories/mock/mock-post-repository.test.ts`, `mock-upload-queue.test.ts`（同階層配置）。
- 新規テスト置き場所（設計どおり）:
  - `src/domain/image-sizing.test.ts`（`computeTargetSize` 純関数）
  - `src/repositories/mock/mock-image-processor.test.ts`（Mock）
  - **`expo-image-processor` のテストは作らない**（§2、node 解決で native が要るため）。
- 実行: `npm test`（= `jest`、`package.json` scripts）。`test:rules` は別系統（エミュレータ）で無関係。

---

## 6. リスク箇所 3件（壊しうる / 落とし穴 / テスト手薄）

### リスク1【壊しうる・最重要】v14 は旧 `manipulateAsync` が deprecated。誤って旧 API で書くと将来削除/警告
- 根拠: `build/ImageManipulator.d.ts:15-18` に `@deprecated`。`manipulateAsync` のシグネチャ `(uri, actions[], saveOptions)`（`:18`）は新 API（`manipulate().resize().renderAsync()` + `saveAsync()`）と**全く別形**。
- 落とし穴: SDK53 以前の記憶で `ImageManipulator.manipulateAsync(uri, [{resize:{width}}], {compress, format})` と書くと型は通っても deprecated 経路。新 API は **actions 配列ではなくメソッドチェーン**、保存は `ImageRef.saveAsync`（`ImageRef.d.ts:19`）。**`renderAsync()` の await を忘れると `ImageRef` でなく Promise を saveAsync しようとして落ちる**。
- 回避: §1-4 のチェーン形で書く。`SaveFormat.JPEG`（enum, `types.d.ts:81-85`）、`compress: JPEG_QUALITY(0.7)`（範囲 0–1, `:94-98`）。

### リスク2【テスト手薄・現実バグ源】寸法 undefined が常態（compose が width/height を渡さない）
- 根拠: `compose.tsx:101` は `{ uri: selected }` のみ。`LocalImage.width/height` optional（`types.ts:28-32`）、`UploadJob` も同（`domain/types.ts:97`）。
- 落とし穴: `computeTargetSize(undefined, undefined, 1600)` を直接呼ぶと `NaN` 演算 → 設計の「非有限 → {0,0}」に落ちるが、その先で Mock/Expo が `{0,0}` を resize に渡すと**SDK が 0px リサイズで失敗 or 不定動作**。`ImageProcessor` 実装側で「寸法不明なら resize スキップ（原寸保存）」のガードが要る。テストは寸法ありケースだけ書きがちで、**undefined 経路が手薄になる**。
- 回避: `mock-image-processor.test.ts` と `image-sizing.test.ts` の両方で「width/height 欠落」「0/負/NaN」ケースを必ず入れる。Expo 実装は実寸（ImageRef.width/height か picker 結果）を起点にし undefined を計算へ流さない。

### リスク3【壊しうる・丸め】長辺クランプと resize 両指定で 1px はみ出し / 比率歪み
- 根拠: 設計 §computeTargetSize は「長辺 `Math.round` 後 `Math.min(_, maxLongEdge)`」。一方 `ImageManipulatorContext.resize` は `{width?, height?}` 両方指定可（`ImageManipulatorContext.d.ts:14-17`）で、両方渡すと SDK は比率を保証しない。
- 落とし穴: `computeTargetSize` が返す (width,height) を**両方** resize に渡すと、丸めで非整数比になった分だけ SDK 側で歪む / 期待外寸法。逆に長辺だけ渡すと SDK 自動算出値が `computeTargetSize` の短辺と 1px ずれ、`ProcessedImage.width/height` を `computeTargetSize` 由来で返すと**実ファイル寸法と申告寸法が不一致**になりうる。
- 回避: (a) `image-sizing.test.ts` で「ちょうど max」「1599.6→round で 1600、min クランプで 1601 を出さない」「極端比 4000x10→長辺1600/短辺 max(1,round(4))=4」を必ず検証。(b) Expo 実装は `saveAsync` の戻り `ImageResult.{width,height}`（`types.d.ts:5-17`）を **実測値として `ProcessedImage` に採用**し、申告と実体を一致させる（`computeTargetSize` 値は resize 入力にのみ使う）。

---

## 7. 既存テストの状況（カバレッジ補足）

- 現状テスト: `domain/*.test.ts`（assign-colors / merge-best-nine / invite-code）、`mock/*.test.ts`（post-repository / upload-queue）、`tests/rules/`（別系統）。
- **画像処理・寸法計算のテストは皆無**（`image-sizing` / `imageProcessor` 新規）。
- 寸法 undefined 経路（compose→enqueue→promotePhoto）は寸法を一切使わない現実装のためテストされておらず、本Issueで `imageProcessor` を継ぎ目だけ足す段階では未配線（設計「やらないこと2」）。**継ぎ目を足すだけなので既存51テストへの影響は型追加のみ**で挙動不変の想定。

---

## 推測・判断（事実と分離）

- 「長辺のみ resize 指定が比率歪み回避に安全」は型コメント（`types.d.ts:26-34`「片方指定で他方を比率保持算出」）からの**設計判断**であり、両指定が必ず壊れる実測根拠ではない。Implementer は実装方針として長辺指定 + 実測寸法採用を推奨。
- 「`{0,0}` を resize に渡すと SDK が落ちる」は仕様上の安全側推測（型は number を許す）。実機検証はしていない。ゆえに `ImageProcessor` 側ガードで {0,0}/undefined を resize へ流さないのが安全。
- 「expo 実装が node テストに漏れない」は現状の import グラフ（context→mock のみ、expo ディレクトリ未作成）からの事実ベース結論。将来テストや Mock が `@/repositories/expo` を import したら崩れる—その時のみ `testPathIgnorePatterns` に `src/repositories/expo/` 追加を検討（現時点では不要）。
</content>
</invoke>
