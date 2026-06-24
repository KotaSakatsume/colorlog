# 調査レポート — Issue #21 Storageアップロード（§9-7後半）
Stage: 2/5 Investigator（Investigatorサブエージェントがセッション上限で中断→主宰が Read/Grep で事実確認し作成）

## §9 確認事項への回答

### 1. storage.rules のセグメント挙動（最優先・要対応確定）
現 `storage.rules` は `match /b/{bucket}/o { match /trips/{tripId}/{uid}/{postId} {...} }` ＝ **4セグメント**（`trips/{tripId}/{uid}/{postId}`）。Storage Rules のワイルドカードは**1セグメントのみ**マッチ。アップロード先 `trips/{tripId}/{uid}/{postId}/main.jpg` は **5セグメント**＝**現ルールにマッチせず default-deny**。
- **修正（必須）**: ルールを `match /trips/{tripId}/{uid}/{postId}/{fileName}` の5セグメントに。`{uid}` は3番目のままなので `request.auth.uid == uid` の本人チェック・`size<1.5MiB`・`contentType=='image/jpeg'` はそのまま機能。
- `tests/rules/storage.rules.test.ts` は 5セグメントパス（`trips/t1/<uid>/<postId>/main.jpg`）の許可/拒否に更新。`npm run test:rules` で storage 側もエミュレータ検証可（emulator導入済み・前回56件pass）。

### 2. RNFirebase storage v24 modular API（確定）
`node_modules/@react-native-firebase/storage/lib/modular/index.d.ts`:
- `getStorage(app?): Storage`
- `ref(storage, path?): Reference`
- `putFile(storageRef, filePath, metadata?): Task`（`lib/index.d.ts:599` `putFile(localFilePath, metadata?)`）
- `getDownloadURL(storageRef): Promise<string>`
→ modular で統一（namespaced 禁止）。`metadata` は `SettableMetadata`（`contentType` を含む）。**`putFile(ref, localUri, { contentType: 'image/jpeg' })`** が正。

### 3. putFile の uri 形式
`ProcessedImage.uri` は ImageManipulator の `renderAsync()→saveAsync()` 出力のローカルファイル URI（`expo-image-processor.ts:63-64`）。`putFile` はローカルファイルパス/URI を受ける＝そのまま渡せる。

### 4. 現状コード
- `photo-uploader.ts`: `interface PhotoUploader { upload(input: LocalImage): Promise<{imageURL,thumbURL}> }` ＋ passthrough スタブ。**tripId/uid/postId を受け取らない＝rules準拠パスを組めない → interface 拡張が必須**。
- `firebase-post-repository.ts`: `constructor(private readonly uploader: PhotoUploader)`（:52）、`promotePhoto`(:163) が `this.uploader.upload(localImage)`(:178)。**ImageProcessor 未使用**。
- `ImageProcessor`(`types.ts:54`): `process(input: LocalImage): Promise<ProcessedImages>`、`ProcessedImages={main:ProcessedImage, thumb:ProcessedImage}`、`ProcessedImage={uri,width,height}`。`Repositories` 束に `imageProcessor`(:202) あり。
- `createFirebaseRepositories`（`firebase/index.ts`）が posts に uploader を注入。ImageProcessor を posts へも constructor 注入する形に。

### 5. 隔離維持
storage 実装は `src/repositories/firebase/` 配下のみ。`@react-native-firebase/storage` は firebase/ 外に静的 import しない。`firebase/` に `.test.ts` を作らない＝`jest --listTests` に非混入・79不変。`context.tsx` 動的requireガード（`FIREBASE_ENABLED=false`）不変。

## Implementer の落とし穴
- **R1（必須）**: storage.rules 5セグメント化しないと実機で全アップロード deny。テストも更新しエミュレータで確認。
- **R2**: PhotoUploader interface 拡張（tripId/uid/postId + ProcessedImages を渡す）。promotePhoto の決定的 postId `${uid}_${slotIndex}` を uploader に渡してパスを組む。
- **R3**: `putFile` に `{ contentType: 'image/jpeg' }` を明示（rules 必須）。
- **R4**: アップロードは tx 外（§5-7: 画像アップ→URL確定→runTransaction）。tx 内で Storage に触れない。
- **R5**: ImageProcessor を PostRepository コンストラクタに注入（uploader と同じ経路）。factory で Expo実装を供給。
- **R6**: modular 統一・隔離維持・実アップロード検証はゲートC＋Blaze後。

## 確定12色等は無関係（本Issueはdomain不変）
