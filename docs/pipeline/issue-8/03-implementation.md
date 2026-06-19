# Issue: #8 — COLOR_POOL を SPEC §6 準拠の12色に
Stage: 3/5 Implementer

## サマリー
`src/domain/colors.ts` の `COLOR_POOL` を、コメントアウト方式（有効8色＋無効化6色）から**全要素が有効な12要素の純データ配列**に丸ごと書き直した。配布アルゴリズム（`assignColorsToTrip` / `pickColorForJoiner` / `availableColors` / `usedColorHexes` / シャッフル）は一切変更していない。`MAX_MEMBERS = COLOR_POOL.length` の導出により自動的に12になる。テストに12色前提を明示する検証を追加した。

## 変更ファイル一覧と変更意図（1行ずつ）
- `src/domain/colors.ts`: `COLOR_POOL` を確定12色の全要素有効な配列に書き直し、「無効化中・コメント外すだけ」運用コメント(旧20-22行)を SPEC §6 準拠の選定意図コメントに更新。
- `src/domain/assign-colors.test.ts`: `COLOR_POOL` の length=12・hex/名前重複なしを明示検証する describe を追加し、「ちょうど12人」「13人目で TooManyMembersError」テストに literal 12/13 のアサートを足してタイトルと実数のズレを解消（配布アルゴリズムは未変更）。

## 確定12色（SPEC §6）
あか#E63946 / だいだい#F3722C / きいろ#FFD23F / きみどり#A7C957 / みどり#2A9D4A / あおみどり#1D9A8D / みずいろ#4CC9F0 / あお#1D6FE0 / あいいろ#3F3D9E / むらさき#8E44AD / もも#F072B6 / ちゃいろ#8B5E34

落とした2色: やまぶき#F4A300 / しろ#FFFFFF（設計通り）。

## テスト更新/追加内容
追加（新規 describe `COLOR_POOL (SPEC §6)`、2件）:
- 「ちょうど12色を持ち、MAX_MEMBERS と一致する」: `expect(COLOR_POOL).toHaveLength(12)` ＋ `MAX_MEMBERS === 12` を担保。
- 「hex も名前も重複しない」: hex集合・名前集合がともにサイズ12。

更新（既存テスト、挙動不変・assert 強化のみ）:
- 「ちょうど12人なら全員に異なる色を配布できる」: `Set(hexes).size === 12`（実シャッフルで重複ゼロ）を literal 12 で明示。MAX_MEMBERS 駆動 assert も併存維持。
- 「13人目（12人超）で TooManyMembersError」: `memberIds` が 13 件であることを確認のうえ発火を検証。

既存の自己同値・MAX_MEMBERS 駆動・途中参加・満員(TripIsFull)・純粋関数・二重配布・postCount 保持のテストは無変更で全て pass。

## Investigator リスク3件への対応
- リスク1（必須・12要素化）: コメント解除ではなく配列を丸ごと書き直し、全12要素を有効な配列要素として記述。コメントアウト運用を撤廃。新規テストで `COLOR_POOL.length === 12` を恒久ガード。→ 14/13 になる事故を防止。
- リスク2（無害・BLUE=COLOR_POOL[0]）: リネームはスコープ外として据え置き。`mock-post-repository.test.ts` / `merge-best-nine.test.ts` は `COLOR_POOL[0]` を不透明値利用（hex/name を assert しない）のため、`COLOR_POOL[0]=あか` に変わっても無害。両テストとも変更せず pass を確認。
- リスク3（12人配布の重複ゼロ）: 既存「ちょうど12人」テストは実 fisher-yates シャッフルで `Set(hexes).size === 12` を検証。`npx jest` 全 pass で 12色の重複ゼロを実証。

## 検証結果
- `npx tsc --noEmit`: **0 件**（型は `readonly AssignedColor[]` 不変）。
- `npx jest`: **5 suites / 51 tests 全 pass**（既存49 ＋ 本Issueで追加2 = 51）。実シャッフルでの12人配布（重複ゼロ）含む。

## Reviewer への申し送り
- スコープ厳守: 変更は `colors.ts` と `assign-colors.test.ts` の2ファイルのみ。`assign-colors.ts` はコメント文言も既に「色プール数（12）」「メンバー数 <= 12」で実体と整合していたため**無変更**（設計の「確認のみ」に該当）。seed.ts / UI / 他テストは変更不要を実証（tsc/jest pass）。
- `COLOR_POOL[0]` が あか#E63946 を指すようになった（旧 あか と同値だが、変数名 BLUE とのズレは従前から存在）。リネームは別PR（スコープ外）。
- 配布アルゴリズム・UI配色・Firestore セキュリティルールは未変更。
- コミットは未実施（Integrator 段階）。ブランチ `pipeline/issue-8`。
