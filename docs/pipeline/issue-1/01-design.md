# 設計ドキュメント — QR招待 + ベスト9リアクション

Issue: #1
Stage: 1/5 Architect

> 重要な事実訂正: パイプラインの指示には「Expo SDK 56」とあるが、本リポジトリの `package.json` は **Expo SDK 54**（`expo: ~54.0.0` / `expo-router: ~6.0.24` / RN 0.81.5 / React 19.1）。以降の API・ライブラリ選定はすべて **SDK 54 の実体**に合わせる。Investigator/Implementer も SDK 54 前提で進めること（docs.expo.dev/versions/v54.0.0）。

---

## 0. 方針（1行）

QR招待は **expo-linking（既存）+ react-native-qrcode-svg** で表示/解決し Repository は無変更、リアクションは **Post に正規化サブドキュメント `reactions/{uid}` を持つ前提の集計モデル**を `PostRepository` に `subscribeToReactions` / `toggleReaction` を追加して Mock で実装する。

## 1. 設計方針サマリー（5-7行）

- 4層を厳守: 画面は hooks 経由、hooks は Repository interface のみ依存。Firebase は import しない。今回触るのは interface（`types.ts`）/ Mock 実装 / domain 型 / hooks / 一部画面 / app.json。
- **QR招待（A）**: データモデル変更ゼロ。既存 `getInviteCodeForTrip` / `resolveInviteCode` を流用。トリップ詳細・作成完了で招待コードを `colorlog://join?code=XXXX`（`Linking.createURL('join', {queryParams:{code}})`）の文字列にして QR 描画。join 画面は `useURL()` + `Linking.parse()` で受信し、`code` を入力欄へ自動投入する。
- **リアクション（B）**: ドメインに `ReactionSummary`（絵文字ごとのカウント + 自分が押した絵文字）を追加。`PostRepository` に購読 + トグルを追加。Mock は Post 本体と別管理の「ユーザー×絵文字」集合をインメモリに保持し、購読時に集計して流す（= Firestore の集計ドキュメント相当を Mock で再現）。
- **データフロー**: `toggleReaction(tripId, postId, uid, emoji)` → Mock backend が `reactionsByPost` を更新 → 当該 post の購読者へ集計済み `ReactionSummary` を emit → album/詳細グリッドが再描画。
- **エラーハンドリング**: 既存パターン踏襲（`throw new Error(日本語)` を画面 `Alert` で表示）。トグルは楽観更新せず購読反映で十分（Mock は同期的）。
- **DB変更**: ドメイン/Mock のみ。Firestore スキーマは本Issueでは実装しないが、§4 に将来設計メモを残す。

## 2. データモデル / 型の変更

### 2.1 `src/domain/types.ts`（新規型）

```ts
/** リアクションに使える絵文字の確定集合（UI の並び順もこの順）。 */
export const REACTION_EMOJIS = ['❤️', '😍', '👏', '🔥', '😂'] as const;
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

/**
 * 1 つの Post に対するリアクション集計。
 * - counts: 絵文字ごとの押下数（0 のキーは省略可）。
 * - mine: 自分が現在押している絵文字（未押下なら null）。1人1リアクション制。
 */
export type ReactionSummary = {
  postId: string;
  counts: Partial<Record<ReactionEmoji, number>>;
  mine: ReactionEmoji | null;
};
```

設計判断: **1ユーザー1リアクション制**（mine は配列でなく単数）。理由は §4 のコスト規律 — 集計ドキュメントへの書き込みを「付け替え1回」に抑え、複数同時押しによる書き込み増を構造的に防ぐ。`Post` 本体は変更しない（リアクションは別購読で重ねる）。

### 2.2 `src/repositories/types.ts`（PostRepository 追加メソッド・正確なシグネチャ）

```ts
import type { Post, ReactionEmoji, ReactionSummary, Trip, InviteCode } from '@/domain/types';

export type ToggleReactionInput = {
  tripId: string;
  postId: string;
  user: AuthUser;
  /** 押した絵文字。同じ絵文字を再度押すと解除。別の絵文字なら付け替え。 */
  emoji: ReactionEmoji;
};

export interface PostRepository {
  subscribeToTripPosts(tripId: string, listener: (posts: Post[]) => void): Unsubscribe;
  promotePhoto(input: PromotePhotoInput): Promise<Post>;

  /**
   * トリップ内の全 Post のリアクション集計を購読する。
   * listener には postId をキーにした Map で「現在ユーザー視点の集計」を流す。
   * (userId を引数に取り、mine をユーザーごとに正しく解決する)
   */
  subscribeToTripReactions(
    tripId: string,
    userId: string,
    listener: (byPost: Map<string, ReactionSummary>) => void,
  ): Unsubscribe;

  /**
   * リアクションをトグルする。
   * - 未押下 → 押す / 同絵文字 → 解除 / 別絵文字 → 付け替え（旧 -1, 新 +1）。
   * 戻り値は更新後の当該 Post の集計（呼び出し側が即時利用したい場合用）。
   */
  toggleReaction(input: ToggleReactionInput): Promise<ReactionSummary>;
}
```

設計判断: 集計は `subscribeToTripPosts` と**別購読**にする。理由 — posts 本体（thumbURL 等の重いデータ）の購読とリアクション（高頻度で変わる軽量データ）の購読を分離すれば、将来 Firestore でリスナー粒度・読み取り回数を独立に最適化できる。posts と一緒に流すと毎リアクションで全 post を再評価することになる。

## 3. QR招待の実装方式

### 3.1 ライブラリ選定（SDK 54 検証済み）

- **QR生成**: `react-native-qrcode-svg`（純 JS、QR エンコードを行い `react-native-svg` で描画）。
- **依存**: `react-native-svg`（peer）。SDK 54 では **Expo がバージョン管理する vendored パッケージ**なので `npx expo install react-native-svg` で SDK 整合版が入る。Expo Go でも動作（ネイティブ追加コードは svg のみで Expo Go 同梱）。
- インストール: `npx expo install react-native-svg` → `npm install react-native-qrcode-svg`。
- 却下案: `expo-barcode-scanner` 系は「読み取り」用途で生成不可。`qrcode`(node) は DOM/canvas 前提で RN 不可。`react-native-qrcode-svg` が SDK 54 + Expo Go で最も摩擦が小さい。

> Investigator への確認依頼: `npx expo install react-native-svg` が解決する正確なバージョン、および `react-native-qrcode-svg` の最新が RN 0.81 / React 19 で型エラーを出さないか（必要なら `@types` か `declare module` の薄いラッパ）を1点検証すること。

### 3.2 ディープリンクのスキーム設計

- スキームは既存の `"scheme": "colorlog"`（app.json に設定済み）をそのまま使う。**app.json の変更は不要**。
- 生成: `Linking.createURL('join', { queryParams: { code } })` → `colorlog://join?code=XXXX`（Expo Router の typed routes と整合する `join` パス）。手書き文字列連結はしない（dev client では scheme が変わるため `createURL` に委譲する）。
- 受信: join 画面で `const url = Linking.useURL()` → `url && Linking.parse(url).queryParams?.code` を取り出し、数字のみへ正規化して `setCode` に投入。ディープリンク経由でも既存の「送信時に数字正規化」ロジックを流用。
- Expo Router 併用の注意: Router 自体も `/trip/join` へルーティングしうるが、本Issueは「入力欄への自動投入」がゴールなので Router の自動ナビゲーションに依存せず、join 画面が能動的に `useURL` を読む方式にする(挙動が予測可能・テスト容易)。

### 3.3 app.json への影響

- **変更なし**。`scheme: "colorlog"` は既存。`react-native-svg` は config plugin 不要(autolinking)。`react-native-qrcode-svg` は純JSでネイティブ追加なし。

## 4. リアクションの実装方式

### 4.1 Mock での集計の持ち方

`MockBackend` に正規化ストアを追加する（Post 本体には混ぜない）:

```ts
// postId -> (uid -> ReactionEmoji)  ユーザー1人1絵文字
private readonly reactionsByPost = new Map<string, Map<string, ReactionEmoji>>();
private readonly reactionListeners = new Map<string /*tripId*/, Set<ReactionsListener>>();
```

- `toggleReaction`: 対象 post の `Map<uid,emoji>` を更新（解除/付け替え）→ そのトリップのリスナーへ「全 post 集計 Map」を emit。
- 集計関数 `summarize(tripId, viewerUid)`: posts を走査し `counts` を積み、`mine` は `reactionsByPost.get(postId)?.get(viewerUid) ?? null`。
- seed: 既存 seed の数件 post に初期リアクションを入れて UI を賑やかに（任意・テスト用）。
- `deleteTrip` 時に当該 tripId 配下の `reactionsByPost` エントリも破棄（孤児防止）。`promotePhoto` の差し替えで postId が変わる場合、旧 postId のリアクションは破棄する（仕様: 差し替えは別写真なのでリアクションは引き継がない）。

### 4.2 将来 Firestore 設計メモ（コスト規律 §13 順守）

- **格納**: `trips/{tripId}/posts/{postId}/reactions/{uid}` に `{ emoji, updatedAt }` を1ドキュメント。1ユーザー1ドキュメントで上限が `9枚 × メンバー数` に線形固定（ベスト9と同じ性質）。
- **書き込み最小化**: 1リアクション = 自分の1ドキュメントの set/update/delete のみ（付け替えも1 write）。複数絵文字同時押しを禁止する仕様がここで効く。
- **集計の読み取り削減**: フィード表示では `reactions` サブコレクションを毎回全読みしない。`post` ドキュメントに **非正規化カウンタ** `reactionCounts: Record<emoji, number>` を持たせ、書き込み時に `FieldValue.increment(±1)` で更新（読み取り0で集計取得）。`mine` だけは自分の1ドキュメント読み（または onSnapshot 1本）で解決。これで「フィード50件表示」でも集計のための読み取りが増えない。
- **App Check / レート**: §13 の App Check 必須・レート制限の対象に reactions write も含める（セキュリティルールで `emoji in REACTION_EMOJIS`、自分の uid のみ書き込み可を強制）。
- 本Issueでは上記は**設計メモのみ**。Mock はカウンタ非正規化を模倣せず素朴に集計してよい（UI/テスト目的には十分、かつ Firestore 移行時に interface は不変）。

## 5. 影響ファイル一覧

### 新規
- `src/components/qr-invite.tsx` — 招待コード→`createURL`→QR 描画コンポーネント（QRコード + コード文字列）。~60行
- `src/components/reaction-bar.tsx` — `ReactionSummary` を受け取り絵文字+件数を表示/トグルする行。~80行
- `src/hooks/use-reactions.ts` — `subscribeToTripReactions` を購読する hook。~40行
- `src/repositories/types.ts` 内に追記する型は既存ファイル変更（下記）。
- `src/repositories/mock/mock-post-repository.test.ts` — toggleReaction のユニットテスト（新規）。~120行
- `src/hooks/use-deep-link-code.ts`（任意・join 画面内インラインでも可）— `useURL`→code 抽出。~25行

### 変更
- `src/domain/types.ts` — `REACTION_EMOJIS` / `ReactionEmoji` / `ReactionSummary` 追加。~15行
- `src/repositories/types.ts` — `PostRepository` に2メソッド + `ToggleReactionInput` 追加。~25行
- `src/repositories/mock/mock-backend.ts` — `reactionsByPost` / リスナー / `toggleReaction`(原子的) / `summarize` / delete 連動。~70行
- `src/repositories/mock/mock-post-repository.ts` — 2メソッド実装（backend 委譲）。~25行
- `src/app/trip/join.tsx` — `useURL` で code 自動投入。~10行
- `src/app/trip/[id]/index.tsx` — 招待コードカードに `<QrInvite>` を追加。~10行
- `src/app/trip/[id]/album.tsx` — 各 post に `<ReactionBar>` を重ねる（要グリッド調整）。~30行
- `src/components/best-nine-grid.tsx` — リアクション表示のための `renderOverlay` か `reactions` prop を任意追加（破壊的変更を避け optional に）。~20行
- `package.json` — `react-native-svg`, `react-native-qrcode-svg` 追加。

想定総変更: **中規模・~500行**。1PRで完結可能。詳細グリッドでのリアクション操作 UI が膨らむ場合は「表示のみ(album) → 操作(詳細)」の2段で切れるが、現状は1PR想定。

## 6. スコープと「やらないこと」

### スコープ（本Issue）
- QR表示（詳細/作成完了）、ディープリンク受信→join 自動投入、データモデル無変更。
- Post リアクション集計（domain型 + interface + Mock + ユニットテスト + album/詳細での表示・操作）。

### やらないこと（3点）
1. **Firebase / Firestore 実装への差し込み**（reactions サブコレクション・increment カウンタ・セキュリティルール）。別Issue。本Issueは設計メモ(§4.2)まで。
2. **QRコードの読み取り（スキャナ）**。生成・ディープリンク受信のみ。カメラでの QR スキャンは別Issue（`expo-camera` の barcode scanning 利用）。
3. **リアクションの通知/プッシュ、複数絵文字同時押し、リアクション一覧(誰が押したか)画面、ウィジェット常駐**。Issue の「スコープ外」記載に従う。

## 7. リスク・落とし穴

- **SDK バージョン齟齬**: 指示は SDK 56 だが実体は 54。Implementer は必ず v54 docs を参照。`react-native-svg` は `npm install` でなく `npx expo install` を使う（SDK 整合版を入れるため）。
- **react-native-qrcode-svg の型**: RN 0.81 / React 19 で型定義が古い可能性。型エラー時は薄い `declare module 'react-native-qrcode-svg'` で回避（strict 維持）。Investigator が検証。
- **dev client での scheme**: `colorlog://` は本番、開発時は `exp+colorlog://...` になりうる。手書き連結せず `Linking.createURL` に委譲すれば両対応。
- **best-nine-grid の破壊的変更**: album/詳細/mini で共有コンポーネント。リアクション用 prop は **optional** にして既存呼び出し(詳細の編集グリッド・mini)を壊さない。
- **差し替え時のリアクション孤児**: `promotePhoto` 差し替えで postId が変わるとリアクションが残る。Mock backend で旧 postId のリアクションを破棄する処理を忘れない（テスト項目）。
- **購読の二重張り**: reactions 購読を画面ごとに張ると §13 の「リスナー1本共有」原則に反する。hook 化し、album/詳細で同じ購読源を使う設計に寄せる。

## 8. テスト方針

- **ユニット（Mock backend / post repository）**: ① 初回トグルで count+1・mine セット ② 同絵文字再トグルで解除(count-1・mine=null) ③ 別絵文字で付け替え(旧-1新+1、合計不変) ④ 別ユーザー視点で mine が独立 ⑤ 購読が即時に初期集計を流す ⑥ `deleteTrip` / 差し替えでリアクション破棄 ⑦ 不正絵文字を弾く(型 + ランタイム)。
- **ディープリンク解析**: `Linking.parse('colorlog://join?code=123456').queryParams.code === '123456'` と数字正規化のユニット（純関数に切り出してテスト）。
- **既存テスト非破壊**: `assign-colors.test.ts` 等を壊さない。`PostRepository` interface 拡張は既存 `promotePhoto` を変えないので Mock 既存テストは維持。
- **手動/Expo Go**: 詳細で QR 表示 → 別端末/シミュレータで `colorlog://join?code=...` を開き join 欄自動投入 → album でリアクション付与が即反映、を Mock のみで確認(Firebase 不要)。
