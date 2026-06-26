# レビュー結果: PR #28 / Issue #27「アバター編集からボトムを除外」

> 運用メモ: 本 Issue は通常パイプライン（Architect→…→Integrator）ではなく、既に
> 実装・PR化済み（PR #28, branch `fix/avatar-remove-bottom`）だったため、ユーザー
> 判断により **Reviewer 段階のみ** を PR #28 の差分に対して実行した。

## 設計準拠の判定

**準拠。スコープ逸脱なし。**

Issue #27 の方針「定数（`AVATAR_SELECTION_SLOTS` / `AVATAR_COLOR_SLOTS`）から `bottom`
を外すだけで両編集欄から消える」は事実として正しい（裏取り済み）:

- `avatar.tsx:105` パーツ欄は `AVATAR_SELECTION_SLOTS.map(...)` でタブ生成 → `bottom` 行削除で消える。
- `avatar.tsx:153` 色欄は `AVATAR_COLOR_SLOTS.map(...)` でパレット生成 → `bottom` 行削除で消える。
- 生成系（`buildMemberAvatarSvg`）には一切手を入れていない。設計の非対象範囲を正しく守っている。

差分は定数2箇所＋コメント3箇所＋テスト1件のみ。最小変更で、余計な最適化やリファクタの混入なし。

## 指摘リスト

### [nit] avatar.tsx:51 — `activeSlot` 初期値（情報共有・修正不要）
`useState<SelectionSlotId>(AVATAR_SELECTION_SLOTS[0].id)` は相対参照のため、`bottom` 削除後は
自動的に `body` を指す。`bottom` 固定参照の箇所も grep でヒットゼロ。**バグなし。**

### [nit] avatar.tsx:50/132/160 — 既存 bottom 値の編集不能化は意図どおり（情報共有）
`draft` は `user.avatarConfig ?? {}` 初期化、保存は `draft` 全体を渡し、`selectPart`/`selectColor`
はスプレッドで既存キーを保持。UI から `bottom` を消しても draft 内の既存 `bottom` 値は破棄されず
保存時に永続化される。後方互換の核は保たれる。Issue 記載の「編集ができなくなるだけ」と一致。

### [should] avatar.test.ts — 後方互換の「核」を担保するテストが無い → **対応済み**
Issue #27 が安全性の根拠に掲げた「保存済み bottom 値が生成に渡り続ける」を検証するテストが
欠落していた。定数から `bottom` が消えたことで「未使用キー」と誤認され、将来 `toHumationRecord`
等で「定数に無いキーを弾く」最適化が入るとサイレントに後方互換が壊れるリスク。

→ **反映済み**: `buildMemberAvatarSvg（config 拡張）` describe に
「UI から外した bottom 値も config 経由なら生成に反映される（後方互換の核・Issue #27）」を追加。
`colors.bottom` の hex 焼き込み（`#FF00AA` 出現）と `selections.bottom` の出力変化を固定。
実機確認で bottom は表示上見えなくても生成 SVG には反映される（color hex 出現=true）ことを確認済み。

### [nit] avatar.test.ts:209 — `bakeColorVars` 誤爆テストの `--hm-bottom` 例示 → **対応済み**
「bottom を外す」PR のテストで `--hm-bottom` を例示に残すと削除漏れに見え混乱を招くため、
`--hm-clothes` / `--hm-skin`（UI に残るスロット）へ差し替え。機能影響ゼロ。

## テスト評価

| 観点 | 状態 |
|---|---|
| UI 除外の担保（`bottom` が定数に無い） | カバー済み |
| `background` が color スロットに混入しない回帰 | 維持 |
| 後方互換（保存済み bottom 値の生成反映） | **追加済み**（should 反映） |
| 画面側の `bottom` 前提参照の不在 | grep 確認済み・該当なし |

`npx jest src/domain/avatar.test.ts` → **23 passed**（反映後）。

## セキュリティ
**該当なし。** 静的な UI 定数2行とコメントの削除のみ。攻撃面の増減なし。

## 総評: **要修正（軽微）→ 反映完了**
`must` ゼロ。設計準拠・バグ無し・最小スコープ。should 1件（後方互換テスト欠落）と nit 1件
（テスト例示）を既存ブランチ `fix/avatar-remove-bottom` に反映済み。重複PRは作成していない。
