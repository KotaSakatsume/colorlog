# コードレビュー — Issue #1 (QR招待 + ベスト9リアクション)

Stage: 4/5 Reviewer / 対象: Mock 段階 (SDK 54, Firebase なし)
基準: `01-design.md`。初期コミットが無く `git diff` 不可のため変更/新規ファイルを直接 Read してレビュー。

## 総評: 要修正 (must あり)

must が **2件**（設計準拠の明確な逸脱1件 + 購読/状態のバグ1件）。Implementer へ差し戻す。実装の骨格・型・テストは概ね良好で、孤児破棄や viewer ごとの mine 解決など難所は押さえられている。差し戻し理由は局所的。

---

## must (マージ前に直す)

### must-1: ディープリンクのパスが設計と不一致 — `trip/join` は expo-router 実ルートと衝突
- 該当: `src/components/qr-invite.tsx:23`、`src/hooks/use-deep-link-code.ts:12`、設計 `01-design.md`
- 設計は `Linking.createURL('join', …)`（router に存在しないパス）を選び、「router 自動遷移に依存せず join 画面が能動的に `useURL` を読む」前提。実装は `trip/join` に変更しており、`colorlog://trip/join?code=…` は router の実パス `/trip/join` と一致してしまうため、起動時に router 遷移と `useURL` 読み取りの二経路が同時に走る恐れ。コード抽出自体はパス非依存で動くが、設計判断の無断上書き。
- 修正提案: 設計どおり `join` に戻す。`trip/join` を積極採用する理由があるなら 03 メモに明記し二重発火しない手動確認証跡を添えて Architect 承認（設計差し戻し）を取る。どちらかに統一。

### must-2: `useDeepLinkCode` が一度セットした code を初期化しないため stale 状態が残る
- 該当: `src/hooks/use-deep-link-code.ts:13-21`
- truthy のときだけ `setCode` し null に戻すパスがない。code 無しリンク（`colorlog://`）やフォアグラウンド復帰で前回の code が join 画面に残り続ける。
- 修正提案: state レスにして `useMemo` で url から直接導出:
  ```ts
  export function useDeepLinkCode(): string | null {
    const url = Linking.useURL();
    return useMemo(() => {
      if (!url) return null;
      const n = normalizeInviteCode(Linking.parse(url).queryParams?.code);
      return n || null;
    }, [url]);
  }
  ```

---

## should (直すべき)

- **should-1**: `emitReactions` が空 Map を渡し各 wrapper が自前再集計する構造が型シグネチャと乖離（`mock-backend.ts:196-223`）。`reactionListeners` を `() => void` トリガ型にして `new Map()` を渡す不自然さを解消。
- **should-2**: `emitReactions` が毎回新規 Map で全 `ReactionBar` を再レンダリング（`album.tsx`/`mock-backend.ts:222`）。Mock では実害小だが Firebase で §1 のアンチパターン。`ReactionBar` を `React.memo` 化＋「Firebase では post 単位 onSnapshot に分割」を 03 メモに残す。
- **should-3**: `BestNineMini.renderOverlay` を追加したが album で未使用＝デッドコード prop（`best-nine-grid.tsx:61-73`）。削除してスコープを締めるか、設計意図どおりグリッド上にバッジを重ねるか択一。
- **should-4**: `handleToggle` が memberIds を見ない（`album.tsx:23-30`）。Mock では到達不能だが `if (!trip.memberIds.includes(user.uid)) return;` を入れ Firebase ルール前提と一致させる。最低限 03 メモに「メンバー検証は Firebase ルール側」と記録。

## nit
- **nit-1**: import グルーピング順が既存規約とずれ（`reaction-bar.tsx:3-5` 等）。
- **nit-2**: `qr-invite.tsx:31`「QR を読み取って参加」はスキャナ非実装段階では誤解を招く文言。
- **nit-3**: `seed.ts:85-94` の postId 直書きが id 生成規則変更に弱い。

---

## 設計準拠の判定

| 項目 | 判定 |
|---|---|
| 1ユーザー1絵文字集計 | 準拠 |
| posts と別購読 | 準拠 |
| 孤児破棄を backend に集約 | 準拠 |
| deep link 受信 | **逸脱（must-1）** |
| コスト規律 §13 将来 Firestore 設計 | 準拠（should-2 留意） |
| 不正絵文字を弾く | 準拠 |
| best-nine-grid 非破壊 | 準拠（ただし未使用 should-3） |

Implementer の逸脱4点: ①deep linkパス→**不可(must-1)** ②create.tsx QR見送り→妥当 ③純関数 domain 切り出し→妥当・良い ④操作UIを album のみ→妥当。

## テスト評価
カバー済み（良い）: 初回/解除/付け替えトグル・viewer 独立 mine・即時 emit・再通知・不正絵文字・delete/差し替え孤児破棄・normalizeInviteCode。
カバー漏れ（追加すべき）:
- should: **Unsubscribe 後に通知されない**ケース（解除の回帰）。
- should: 複数ユーザーが同一 post に異なる絵文字 → counts 合算の検証。
- nit: 他人がいる状態での付け替えが他人カウントに干渉しない。
- nit: deep link round-trip（`Linking.parse(...).queryParams.code`）。must-1 のパス確定後に1ケース。

セキュリティ・コスト規律: 追加の脆弱性なし。不正絵文字ランタイムガードあり、書き込み1ユーザー1ドキュメント相当、購読1本共有で §13 整合。

## 差し戻しサマリー
- **must-1 / must-2 を修正**（must-1 はパスを `join` に戻すか承認取得の択一）。
- should-1〜4 は本Issue内対応推奨、最低限 03 メモに判断記録。
- テストに Unsubscribe / 複数ユーザー合算ケースを追加。

must が残っているため **要修正**。Implementer 段階へ戻す。

---

## 再レビュー結果（2往復目）: must なし = 承認

- **must-1 解消**: `qr-invite.tsx` の生成 URL が設計どおり `Linking.createURL('join', …)`（`colorlog://join?code=...`）に復帰。`trip/join` 独自採用を撤回。router 実ルートとの二重発火懸念も解消。
- **must-2 解消**: `use-deep-link-code.ts` が state レス（`useMemo([url])` で直接導出、`string|null`）。stale code が残らない。`join.tsx` の自動投入も新シグネチャで破綻なし。
- **should 全反映**: emit を `() => void` トリガ型に整理 / `ReactionBar` を `React.memo` 化 / 未使用 `renderOverlay` 削除 / `album.handleToggle` に memberIds ガード。
- **テスト**: ⑤c Unsubscribe 回帰 / ⑧ 複数ユーザー合算 を追加。jest 26件 pass。
- リグレッション・新規 must の混入なし。**Integrator 段階へ進行可。**
