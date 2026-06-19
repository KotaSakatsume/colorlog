# Issue: #8 — COLOR_POOL を SPEC準拠の12色に
Stage: 4/5 Reviewer

## 総評
**approve（must なし）**

差分は設計 `01-design.md` どおり、データ＋コメント＋テストのみ。配布アルゴリズム不変、tsc 0件・jest 51件 pass を実機 SDK54 で確認済み。SPEC §6 の要件（12色・色相分散・日本語名・色覚多様性を明度差で担保・重複なし・MAX_MEMBERS 導出12）を満たす。波及先（seed / UI / 既存テスト / contrastTextColor）に破綻なし。

## 検証結果（自己実行）
- `npx tsc --noEmit` → **0件**
- `npx jest` → **5 suites / 51 tests pass**
- `git diff main` 対象は `colors.ts` と `assign-colors.test.ts` のみ。`assign-colors.ts` は diff 空＝**ロジック不変を確認**。

## 観点別

### 1. SPEC §6 準拠（確認済み: 合格）
- `colors.ts:24-37` 12要素・全要素有効・コメントアウト方式撤廃。`as const` と `{hex,name}` 構造維持。
- `colors.ts:40` `MAX_MEMBERS = COLOR_POOL.length` 導出不変 → 12。
- hex/名前重複なし（test `colors.ts` 自体＋ `assign-colors.test.ts:46-51` で Set.size===12 を二重担保）。
- 色覚多様性: 近接群を明度差で分離（青系 あいいろ73/あお99/みずいろ168、黄系 だいだい145/きいろ207）。各色に日本語名ラベル。設計の選定根拠と整合。

### 2. 配布アルゴリズム不変（確認済み: 合格）
`assign-colors.ts` の diff は空。`assignColorsToTrip`/`pickColorForJoiner`/`availableColors`/`usedColorHexes` はすべてプール内容に非依存でデータ追従。

### 3. テスト（確認済み: 合格）
- 12人配布・重複ゼロ: `assign-colors.test.ts:93-101`（Set.size===12 かつ ===MAX_MEMBERS）。
- 13人目 TooManyMembersError: `:103-107`（`toHaveLength(13)` で人数明示）。
- 途中参加の残り色: `:125-132`（残り `MAX_MEMBERS-4`）、満員 TripIsFullError `:146-149`。
- length=12 ガード: `:40-52` 追加、妥当。
- 実シャッフル（fisherYates）でも通る: `:55-65` は shuffle 注入なしの本番経路を使い pass。
- 既存 assert は破壊なし（`:67-74` の identityShuffle 先頭一致、`COLOR_POOL[4]`=`:134-139` は配列確定後も成立）。

### 4. 波及（確認済み: 該当なし）
- `seed.ts:16-20` の `color()` は未知名で throw する設計だが、参照 あお/あか/みどり/きいろ/もも は全て新12色に存在（jest pass が裏付け）。しろ 未参照。
- `merge-best-nine.test.ts:7` / `mock-post-repository.test.ts:10` の `COLOR_POOL[0]` は hex値非依存（不透明利用）。中身が `あか#E63946` に変わっても無害。
- `contrastTextColor` 検証: 全12色で黒/白判定が妥当（最暗 あいいろ L=73→白、最明 きいろ L=207→黒）。閾値150近傍で破綻する色なし。
- 旧「無効化中」運用コメントは撤廃済み（`colors.ts:16-23` 更新）。grep で 8/14/無効化 の残存なし。

### 5. セキュリティ（確認済み: 該当なし）
データ定数（静的 hex 文字列）のみ。入力検証・認可・機密情報・インジェクションの新規面なし。Firestore ルール側（#6 で上限12済み）とアプリ側が12で一致。

## 指摘リスト
- **nit** `colors.ts:39` コメント「SPEC: 12人。」— 値は導出なので妥当だが、将来プール数を変えると人数も連動する旨を一言添えると親切（任意）。
- **must / should**: なし。

## マージ可否
**approve** — must 0件。Integrator へ進行可。
