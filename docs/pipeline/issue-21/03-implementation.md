# 03-implementation.md — Storageアップロード実装（FirebasePhotoUploader と promotePhoto 配線）

- Issue: #21
- Stage: 3/5 Implementer
- ブランチ: `pipeline/issue-21`（main 直接コミットなし・本Stageはコミットしない）

---

## 1. 変更/新規ファイル一覧（各1行の意図）

| ファイル | 区分 | 変更意図 |
| --- | --- | --- |
| `storage.rules` | 変更 | `match /trips/{tripId}/{uid}/{postId}/{fileName}` に5セグメント化（main.jpg/thumb.jpg を `{fileName}` で受ける）。本人チェック・size<1.5MiB・contentType==image/jpeg は維持（調査R1）。 |
| `tests/rules/storage.rules.test.ts` | 変更 | 5セグメントパス（`trips/t1/alice/alice_0/main.jpg`・`thumb.jpg`）へ全ケースを更新。thumb.jpg の許可ケースを追加。 |
| `src/repositories/firebase/photo-uploader.ts` | 変更 | `PhotoUploader` interface を `upload(images: ProcessedImages, target: {tripId,uid,postId})` に拡張。passthrough も新シグネチャに追随（main/thumb uri をそのまま返す・Mock 同等）。 |
| `src/repositories/firebase/firebase-photo-uploader.ts` | 新規 | RNFirebase storage modular（getStorage/ref/putFile/getDownloadURL）で main/thumb を `trips/{tripId}/{uid}/{postId}/{main,thumb}.jpg` にアップロードし URL を返す。contentType を image/jpeg 明示（調査R3）。 |
| `src/repositories/firebase/firebase-post-repository.ts` | 変更 | constructor に `ImageProcessor` 注入。promotePhoto を「process→2サイズ→決定的 postId でパス→tx外 upload→URL確定→既存 runTransaction」順に配線（§5-7・調査R4/R5）。tx 内ロジックは不変。 |
| `src/repositories/firebase/index.ts` | 変更 | passthrough を `FirebasePhotoUploader` に差し替え。`ExpoImageProcessor` を const 化し posts(constructor) と束フィールドの両方へ同一インスタンス供給（設計§5）。 |

合計: 変更5・新規1。スコープは設計§6の影響ファイル一覧と一致（追加なし）。

---

## 2. interface 拡張（最終形）

```ts
// src/repositories/firebase/photo-uploader.ts
export interface PhotoUploadTarget { tripId: string; uid: string; postId: string; }
export interface PhotoUploader {
  upload(images: ProcessedImages, target: PhotoUploadTarget): Promise<{ imageURL: string; thumbURL: string }>;
}
```
- passthrough は `images.main.uri` / `images.thumb.uri` をそのまま返し target を無視（Mock/テスト用に保持）。

## 3. FirebasePhotoUploader（新規・modular 統一）

- `getStorage()` → `ref(storage, 'trips/{tripId}/{uid}/{postId}/main.jpg')` → `putFile(ref, image.uri, { contentType: 'image/jpeg' })` → `getDownloadURL(ref)`。
- main/thumb は独立パスのため `Promise.all` で並列。
- `@react-native-firebase/storage` の使用は本ファイル（firebase/ 配下）のみ。namespaced 不使用。

## 4. promotePhoto 配線（§5-7 順序）

1. 既存バリデーション（slotIndex 範囲・caption<=200）不変・先頭のまま。
2. 決定的 `postId = ${user.uid}_${slotIndex}` を**先に**確定（Storage パスに使うため、tx 直前の算出位置から前倒し）。
3. `const processed = await this.imageProcessor.process(localImage);`（tx外）。
4. `const { imageURL, thumbURL } = await this.uploader.upload(processed, { tripId, uid, postId });`（tx外）。
5. 既存 `runTransaction`（trip 検証・slot 差し替え・postCount<=9・members 更新）は**完全に不変**。tx 内は Storage に触れない。

## 5. DI

- `const imageProcessor = new ExpoImageProcessor();` を1つだけ生成し、`new FirebasePostRepository(new FirebasePhotoUploader(), imageProcessor)` と束 `imageProcessor` フィールドの両方に同一インスタンスを渡す（束フィールドは UI 契約として維持）。

---

## 6. Investigator が挙げたリスク箇所3件への対応

- **R1（必須・storage.rules 5セグメント化）**: `storage.rules` を `{fileName}` 追加の5セグメントに変更。`tests/rules/storage.rules.test.ts` を 5セグメントパスに更新し、main.jpg/thumb.jpg 許可・1.5MiB境界・非jpeg拒否・他人uid拒否・未認証拒否・read許可を網羅。`npm run test:rules` の storage suite 9件 pass で実証。
- **R2（PhotoUploader interface 拡張）**: tripId/uid/postId（`PhotoUploadTarget`）+ `ProcessedImages` を受けるシグネチャに拡張。promotePhoto から決定的 postId `${uid}_${slotIndex}` を渡してパスを組む。passthrough も追随。
- **R3（putFile に contentType: image/jpeg 明示）**: `FirebasePhotoUploader` で `JPEG_METADATA = { contentType: 'image/jpeg' }` を `putFile` に毎回明示。storage.rules の contentType 条件を満たす。

（補足 R4: アップロードは tx 外で先行・tx 内は Firestore read→write のみで Storage 不触。R5: ImageProcessor は constructor 注入。いずれも実装済み。）

---

## 7. 検証結果（本Issueのゲート）

- `npx tsc --noEmit` = **0 errors**（storage 実装含め型クリーン）。
- `npx jest`（デフォルト）= **79 passed / 8 suites**（不変）。`npx jest --listTests` に firebase/storage は**非混入**（隔離維持）。
- `npm run test:rules`（emulator）= **57 passed / 2 suites**（storage 9 + firestore 48）。
  - 注: 初回 run は firestore 側 `beforeAll` の emulator 冷起動タイムアウト（5000ms hook）で flaky 失敗 → 再 run で全 pass を確認。storage suite は両 run とも pass。本変更は `storage.rules` のみで firestore.rules には未着手。

---

## 8. 検証境界・Reviewer 申し送り

- **実機・実アップロード検証はゲートC（Dev Build）＋ Blaze（Storage 有効化）後**。本Issueは tsc 0 / jest 79不変 / native 隔離維持 / storage rules エミュレータ検証までのコード先行実装。
- **ルール再デプロイはユーザーが実施**（本PRはソース更新＋エミュレータ検証まで）。`storage.rules` の本番反映は別途デプロイが必要。
- **tx 失敗時の孤児**: アップロード成功後に tx 失敗（旅行終了/postCount=9 等）すると Storage にファイルが残るが、postId・パスとも決定的なため同スロット再昇格で同一パス上書き＝自然回収。即時 Storage 削除（ロールバック）は本Issueでは行わない（定期クリーンは §13.5 別Issue・設計§7）。コードにコメント明記済み。
- **putFile の uri 形式**: `ProcessedImage.uri`（expo-image-manipulator saveAsync 出力・`file://...`）をそのまま `putFile` に渡す（RNFirebase はローカルファイル URI を受ける・調査§3）。`file://` 剥がしは不要と判断。実機未検証のためゲートCで最終確認。
- **スコープ**: 設計§7「やらないこと」（App Check / 孤児定期クリーン / tx失敗ロールバック / 実機検証 / Blaze 有効化）には未着手。スコープ外ファイルの変更なし。
- 申し送り（設計矛盾）: なし。設計方針どおり実装完了。
