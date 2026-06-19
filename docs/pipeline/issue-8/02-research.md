# 調査レポート — Issue #8 COLOR_POOL 12色化
Stage: 2/5 Investigator

## 結論
データ層のみの変更で安全に実装可能。人数/色数のハードコード「8」は存在せず全て `MAX_MEMBERS = COLOR_POOL.length`(colors.ts:41) に追従。提案12色は hex/名前ともに重複なし、`contrastTextColor` 判定も設計表と完全一致（node実測）。更新が**必須**な assert は実質ゼロ。

## 1. ハードコード残存: なし
- ドメイン上限: `assign-colors.ts:76` `> MAX_MEMBERS`
- リポジトリ上限: `mock-trip-repository.ts:109` `>= MAX_MEMBERS`、メッセージも `最大${MAX_MEMBERS}人`(L110) で動的
- 残り色: `assign-colors.ts:121` `available.length === 0`（プール内容非依存）
- grep の「8」は全て無関係: `seed.ts:131` postCount、`color-chip.tsx:25` padding、`album.tsx:68` /9 スロット
- `firestore.rules:62` は既に `after.size() <= 12`（本PR対象外・アプリ側を12にすれば一致）

## 2. 既存テスト（assign-colors.test.ts）の色/人数依存
- 自己同値比較で不変: `:57-59` `COLOR_POOL[0..2]` と toEqual、`:121` `toEqual(COLOR_POOL[4])`（4人配布の残り先頭）
- MAX_MEMBERS 駆動で自動追従: `:79` 「ちょうど12人」(`makeTrip(MAX_MEMBERS)`＋`Set(hexes).size===MAX_MEMBERS`)、`:87` 「+1人で TooManyMembersError」(`MAX_MEMBERS+1`→12色化後は13人で発火)、`:114` `toHaveLength(MAX_MEMBERS-4)`、`:129` 満員で TripIsFull
- 生hex/`=== 8` の直接 assert は無し。**必須更新ゼロ**（タイトル「12人」は現状8で実行されていたズレが12色化で実体と一致）
- 設計言及の `COLOR_POOL[0]=BLUE`: `mock-post-repository.test.ts:10` / `merge-best-nine.test.ts:7` は `.hex/.name` を assert せず不透明値として使用のみ → 12色化後 `COLOR_POOL[0]=あか` でも無害

## 3. seed.ts
`color(name)` ヘルパが `COLOR_POOL.find(name)` で引き、参照色名は **あお/あか/みどり/きいろ/もも の5種のみ**（全て新12色に存在）。**しろ は未参照** → 安全。他テストに生pool hex 依存なし。

## 4. UI 参照
- `profile.tsx:50` `COLOR_POOL.map`＋`:78` `flexWrap:'wrap'` → 色数非依存。見出し `:45` は既に「色プール（12色）」表記
- `color-chip.tsx:16` `contrastTextColor` で文字色 → 色数非依存
- 色数固定レイアウトは存在しない

## 5. 12色 検証（node実測・contrastTextColor 閾値 L>150 で黒）
全12 hex ユニーク・全12名前ユニーク・重複なし。黒/白判定が設計表と完全一致。最暗 あいいろ#3F3D9E→白文字、最明 きいろ#FFD23F→黒文字。破綻なし。
（設計表の L 概数は別輝度式由来で実測と数十ズレるが、黒/白の結論は一致）

## 6. Implementer への落とし穴
- **リスク1（必須）**: 配列を**12要素に丸ごと書き直す**。コメント解除方式だと有効8+解除6=14、しろ消し忘れで13になる。確定後 `COLOR_POOL.length === 12` を必ず確認。
- **リスク2（無害）**: `BLUE = COLOR_POOL[0]` が あか を指すようになる。値非依存で機能影響なし。リネームはスコープ外、据え置き推奨。
- **リスク3**: `:79` の「12人配布」は実シャッフルで `Set(hexes).size===12` を検証 → 12色の重複ゼロが前提（5で確認済み）。12色確定後に jest が通ることを必ず実行確認。
- 運用コメント `colors.ts:20-22`（「無効化中・コメント外すだけ」）は撤廃/更新する。
- ゲート: `npx tsc --noEmit`（型は `readonly AssignedColor[]` 不変で0件見込み）と `npx jest` を実行確認。

## 確定12色（設計より・参照用）
あか#E63946 / だいだい#F3722C / きいろ#FFD23F / きみどり#A7C957 / みどり#2A9D4A / あおみどり#1D9A8D / みずいろ#4CC9F0 / あお#1D6FE0 / あいいろ#3F3D9E / むらさき#8E44AD / もも#F072B6 / ちゃいろ#8B5E34
