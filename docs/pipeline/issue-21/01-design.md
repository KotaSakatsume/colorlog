# 01-design.md — Storageアップロード実装（FirebasePhotoUploader と promotePhoto 配線）

- Issue: #21
- Stage: 1/5 Architect
- 対象 SPEC: §5-7 / §9-7後半 / §13.3 / SDK 54・RNFirebase storage v24（modular）

---

## 1. 方針サマリー

`PhotoUploader` interface を `LocalImage` 入力 → `ProcessedImages`（main/thumb）+ パス座標（tripId/uid/postId）入力に拡張し、`FirebasePhotoUploader` が RNFirebase storage modular API（`putFile` + `getDownloadURL`）で `trips/{tripId}/{uid}/{postId}/main.jpg`・`/thumb.jpg` にローカル JPEG をアップロードして実 URL を返す。`promotePhoto` は「ImageProcessor.process → 2サイズを Storage アップロード（tx外）→ URL確定 → runTransaction で Firestore 書き込み」の順（§5-7）に配線し、tx 内は Storage に触れない。実機・実アップロード検証はゲートC（Dev Build）＋ Blaze（Storage有効化）後。本Issueのゲートは tsc 0 / jest 79不変 / native 隔離維持のコード先行実装。

---

## 2. `PhotoUploader` interface の最終形

現状（passthrough スタブ・`upload(input: LocalImage)`）は **postId/tripId/uid を受け取らず**、`storage.rules` 準拠パス（`{uid}` 一致・決定的 postId）を組めない。さらに `LocalImage` 1枚しか受けず、ImageProcessor が生む2サイズを渡せない。したがって interface を以下に確定（最小拡張）。

```ts
// src/repositories/firebase/photo-uploader.ts
export interface PhotoUploadTarget {
  tripId: string;
  uid: string;
  postId: string;          // 決定的 `${uid}_${slotIndex}`
}

export interface PhotoUploader {
  // 処理済み2サイズ（ローカル JPEG）+ パス座標 → main/thumb のダウンロード URL。
  upload(images: ProcessedImages, target: PhotoUploadTarget): Promise<{ imageURL: string; thumbURL: string }>;
}
```

- 採用根拠: `storage.rules` の write 条件（パス `{uid}` == auth.uid・image/jpeg・<1.5MiB）を満たすには **アップロード先パスを uploader が知る**必要がある。postId は promotePhoto 側が決定（`${uid}_${slotIndex}`）するので引数で渡す（uploader 側で再計算しない＝単一責任）。
- passthrough スタブも同 interface に追随し、`images.main.uri` / `images.thumb.uri` をそのまま返す（Mock 同等・node 完結を維持）。`target` は無視。
- `ProcessedImages`（`{ main: ProcessedImage, thumb: ProcessedImage }`、`ProcessedImage.uri` はローカルファイル URI）を入力にすることで、**ImageProcessor.process の出力をそのまま渡せる**＝promotePhoto 配線が直線になる。

---

## 3. `FirebasePhotoUploader` 設計

ファイル: `src/repositories/firebase/firebase-photo-uploader.ts`（新規・firebase 隔離内）。

- modular API: `import { getStorage, ref, putFile, getDownloadURL } from '@react-native-firebase/storage';`（R-A modular 統一。`firebase()` 名前空間 API は使わない）。`getStorage()` でインスタンス取得、`ref(storage, path)` で参照。
- アップロード元は `ProcessedImage.uri`＝**端末ローカルファイル URI**（ImageProcessor=expo-image-manipulator saveAsync の出力。`file://...`）。base64 ではないので `putString` ではなく **`putFile(ref, localUri, { contentType: 'image/jpeg' })`** を使う。`putFile` はローカルファイルパスを直接アップロードする RNFirebase 専用 API（`uploadBytes` は Blob 前提でRN非対応寄り）。
- contentType を **明示的に `image/jpeg`**（metadata 引数）で渡す。storage.rules の `request.resource.contentType == 'image/jpeg'` を満たすため必須（拡張子推測に依存しない）。
- パス: `main` → `trips/${tripId}/${uid}/${postId}/main.jpg`、`thumb` → `.../thumb.jpg`。
- 手順（メソッド内）:
  1. `const storage = getStorage();`
  2. main/thumb それぞれ `const r = ref(storage, path); await putFile(r, image.uri, { contentType: 'image/jpeg' });`
  3. `const url = await getDownloadURL(r);`
  4. main/thumb は `Promise.all` で並列可（独立パス）。`{ imageURL, thumbURL }` を返す。
- サイズ制約: ImageProcessor が長辺1600(~300KB)/400(~25KB) JPEG を生成するため `<1.5MiB` 内（rules 準拠）。uploader 側で再圧縮はしない。

### ⚠️ storage.rules パスの不整合（設計上の要対応点）
現 `storage.rules` のマッチは `match /trips/{tripId}/{uid}/{postId}` = **4セグメント**で、`{postId}` は1セグメントだけにマッチ。アップロード先 `trips/{tripId}/{uid}/{postId}/main.jpg` は**5セグメント**になり、現ルールに**マッチせず default-deny**になる懸念が高い。Issue は「rules は既存のまま（要なら最小）」としているので、**最小修正案**を提示する（Investigator 確認の上 Implementer が確定）:

- 案A（採用推奨）: パスを `match /trips/{tripId}/{uid}/{postId}/{fileName}` に1セグメント追加（`main.jpg`/`thumb.jpg` を `{fileName}` で受ける）。write 条件は `{uid}` 一致・jpeg・<1.5MiB のまま。最小差分。
- 案B（却下）: `{postId=**}` の再帰ワイルドカード。配下任意深さにマッチし広すぎ＝最小権限に反する。

---

## 4. promotePhoto 配線（`firebase-post-repository.ts`）

§5-7 の順序「画像アップロード先行 → Firestore tx」に合わせ、現 `await this.uploader.upload(localImage)` を以下に置換:

```
1. 既存のバリデーション（slotIndex 範囲・caption<=200）は不変・先頭のまま。
2. const processed = await this.imageProcessor.process(localImage);   // 2サイズ生成（tx外）
3. const postId = `${user.uid}_${slotIndex}`;                          // 決定的（既存と同じ）
4. const { imageURL, thumbURL } = await this.uploader.upload(processed, { tripId, uid: user.uid, postId });  // tx外アップロード
5. runTransaction(...) { ...既存ロジック不変... } で imageURL/thumbURL を書く
```

- **tx 内は Storage に一切触れない**（既存どおり tx は Firestore read→write のみ）。runTransaction の trip 検証・slot 差し替え・postCount≤9・members 更新ロジックは**全て不変**。
- 失敗時の扱い: アップロード成功後に tx が失敗（旅行終了 / postCount=9 等）すると Storage にファイルが残り**孤児になりうる**。ただし postId は決定的（`${uid}_${slotIndex}`）かつパスも決定的なので、**同スロット再昇格時に同一パスを上書き**＝孤児は次回の正常昇格で自然回収される。本Issueでは tx 失敗時の即時 Storage 削除（ロールバック）は行わない（決定的パスで上書きされる旨をコメントで明記）。定期クリーンは §13.5 別Issue。
- 順序の正当性: 先にアップロードしておくことで、tx が「URL は確定済みのデータを書くだけ」になり、tx を短く保てる（並行昇格でも後勝ち・postCount 二重加算なしの既存性質を維持）。

---

## 5. DI（`createFirebaseRepositories`）

- uploader を passthrough から実装へ差し替え: `const posts = new FirebasePostRepository(new FirebasePhotoUploader(), imageProcessor);`。
- **ImageProcessor の供給経路**: PostRepository **コンストラクタ注入**を採用（uploader と同じ第2引数）。
  - 採用根拠: promotePhoto が `this.imageProcessor.process` を呼ぶ。Repositories 束は画面層の DI 容器であり、Repository 内部で束を参照するのは循環＆責務逆転。コンストラクタ注入なら型が閉じ、テスト時もスタブ差し替え容易。
  - 却下: `Repositories` 束を promotePhoto に渡す案 → Repository が自分の束を知る循環依存になり却下。
  - factory では `const imageProcessor = new ExpoImageProcessor();` を先に const 化し、`posts` と Repositories.imageProcessor の**両方に同一インスタンスを渡す**（束の `imageProcessor` フィールドは UI 用に残す＝既存契約不変）。
- `FirebasePostRepository` のコンストラクタを `constructor(uploader, imageProcessor)` に拡張。

---

## 6. 影響ファイル一覧（想定変更行数オーダー）

- `src/repositories/firebase/photo-uploader.ts`（interface 拡張 + passthrough 追随・~15行）
- `src/repositories/firebase/firebase-photo-uploader.ts`（新規・~40行）
- `src/repositories/firebase/firebase-post-repository.ts`（promotePhoto 配線 + constructor・~15行）
- `src/repositories/firebase/index.ts`（DI 差し替え・~5行）
- `storage.rules`（案A: `{fileName}` 1セグメント追加・~2行・Investigator 確認後）
- 合計 中規模・1PR で完結。

---

## 7. やらないこと（スコープ外）

1. App Check（§13.3）。
2. 終了トリップのアーカイブ / 孤児の定期クリーン処理（§13.5）。tx 失敗時の即時 Storage 削除（ロールバック）も含め行わない。
3. 実機検証・実アップロード動作確認・Storage 本番有効化（Blaze）。検証境界はゲートC（Dev Build）＋ Blaze 後。本Issueは tsc 0 / jest 79不変 / native 隔離維持のコード先行実装まで。

---

## 8. リスク

1. **native 隔離維持**: `@react-native-firebase/storage` を `firebase/` 配下のみで import。起動経路・domain・mock・画面・node テストへ静的 import 厳禁。新規 `firebase-photo-uploader.ts` は context.tsx 動的 require 経由でのみ評価される（既存 firebase 群と同じ）。
2. **modular API**: v24 で `getStorage`/`ref`/`putFile`/`getDownloadURL` が modular export であることの確認（名前空間 API 混在禁止）。
3. **putFile の uri 形式**: expo-image-manipulator saveAsync 出力 uri（`file://...`）を `putFile` がそのまま受けるか。RNFirebase は file path を期待するため `file://` プレフィックスの扱いを要確認（剥がす必要があるか）。
4. **1.5MiB / image/jpeg 制約**: contentType を明示しないと rules で reject。ImageProcessor 出力が常に <1.5MiB か（長辺1600/0.7 で実測 ~300KB 想定だが上限近接時の余裕）。
5. **tx外アップロードの順序と失敗時整合**: アップロード後 tx 失敗で孤児。決定的パス上書きで吸収する設計だが、Storage 課金は発生しうる（Blaze 後）。
6. **ImageProcessor の供給経路**: コンストラクタ注入への変更が他の生成箇所（mock/index.ts は無関係だが）や型に波及しないこと。`Repositories.imageProcessor` フィールドは UI 契約として維持。
7. **storage.rules パス不整合**（§3 ⚠）: 現ルールが5セグメントパスを deny する懸念。案A の最小修正が要るか Investigator が確定。

---

## 9. Investigator 確認事項

1. **RNFirebase storage v24 の正しい modular API**: `getStorage`/`ref`/`putFile`/`getDownloadURL` の export 名・シグネチャ・metadata 引数（contentType の渡し方）。`putFile(ref, localFilePath, metadata)` の引数順とローカル uri 形式（`file://` を受けるか剥がすか）。
2. **現状コード**: `photo-uploader.ts` の `PhotoUploader` interface と passthrough、`firebase-post-repository.ts` promotePhoto の現行 `this.uploader.upload(localImage)` 呼び出し箇所（拡張時の整合）。
3. **ImageProcessor**: `ImageProcessor.process(LocalImage): Promise<ProcessedImages>`、`ProcessedImage.uri` がローカルファイル URI であること、`Repositories` 束での供給（`createFirebaseRepositories` の `new ExpoImageProcessor()`）。コンストラクタ注入へ移しても束フィールドと両立できるか。
4. **storage.rules パス**: `match /trips/{tripId}/{uid}/{postId}` が `.../{postId}/main.jpg` にマッチするか（v2 セグメント数）。案A `{fileName}` 追加が最小修正として妥当か。
5. **node テスト非混入の維持**: 新規 `firebase-photo-uploader.ts` が `npx jest --listTests` に出ないこと（`.test.ts` を作らない・firebase 配下隔離）。jest 79不変・tsc 0 のゲート。
