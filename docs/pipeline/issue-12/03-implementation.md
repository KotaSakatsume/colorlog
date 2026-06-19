# 03 Implementer — 認証UI配線（匿名→Apple連携・Mock基盤）

Issue: #12
Stage: 3/5 Implementer

入力: `01-design.md` + `02-research.md`。ブランチ: `pipeline/issue-12`（main直接コミットなし・未コミット）。

---

## 変更/新規ファイル一覧（意図1行ずつ）

変更（既存）:
- `src/repositories/types.ts` — `AuthUser` に `isAnonymous: boolean`（必須）追加、`AuthService` に `linkWithApple(): Promise<AuthUser>` 追加。
- `src/repositories/mock/mock-auth-service.ts` — `MOCK_CURRENT_USER.isAnonymous: true`、`MOCK_APPLE_DISPLAY_NAME` 定数、`linkWithApple()` の simulate 実装。
- `src/repositories/mock/mock-upload-queue.ts` — `job.user`(永続化構造型) → `AuthUser` 復元境界で `isAnonymous: false` を補完（tsc 追従・persisted 構造は不変）。
- `src/repositories/mock/mock-post-repository.test.ts` — `makeUser` に `isAnonymous: false` 付与（tsc 追従）。
- `src/repositories/mock/mock-upload-queue.test.ts` — `PromotePhotoInput.user` リテラル2箇所に `isAnonymous: false` 付与（tsc 追従）。
- `src/app/(tabs)/profile.tsx` — アカウント状態表示（匿名/連携済み）＋「Apple と連携」UIButton（編集ボタン直後）。
- `src/app/trip/create.tsx` — 匿名時のみ非ブロッキング連携 CTA（note 直後・送信ボタン直前、disabled 非連動）。
- `src/app/trip/join.tsx` — 匿名時のみ非ブロッキング連携 CTA（hint 直後・参加ボタン直前、disabled 非連動）。

新規:
- `src/repositories/mock/mock-auth-service.test.ts` — MockAuthService の新規テスト一式（7 it）。

---

## linkWithApple の simulate 仕様（実装どおり）

```
async linkWithApple(): Promise<AuthUser>
1. this.user.isAnonymous === false なら no-op で現 user を返す（冪等・通知なし）。
2. next = { ...this.user, isAnonymous: false }。
3. next.displayName === MOCK_CURRENT_USER.displayName（='あなた'）のときだけ
   next.displayName = MOCK_APPLE_DISPLAY_NAME（='Apple ユーザー'）に更新。
   編集済み（初期値以外）なら維持。
4. this.user = next を1回確定 → listeners.forEach で1回だけ通知。
5. this.user を返す。
```

- 判定基準はマジック文字列でなく `MOCK_CURRENT_USER.displayName` 参照（初期値定数変更に追従、リスク2対策）。
- 通知は状態確定後に1回のみ（リスク3対策、updateProfile と同経路）。
- 失敗系なし（Mock）。画面側は将来の reject に備え try/catch + Alert の骨だけ用意（Mock では発火しない）。
- `expo-apple-authentication` / Firebase `linkWithCredential` には一切触れていない（スコープ外）。

---

## AuthUser 追従箇所（tsc が赤にした行のみ機械的に修正）

型追加後 `npx tsc --noEmit` で赤になったのは **4箇所**:

| file:line | 種別 | 対応 |
|-----------|------|------|
| `mock-post-repository.test.ts:13` | `makeUser` 戻り値（AuthUser リテラル） | `isAnonymous: false` 追加 |
| `mock-upload-queue.test.ts:12` | `makeInput` の `PromotePhotoInput.user`（AuthUser） | `isAnonymous: false` 追加 |
| `mock-upload-queue.test.ts:423` | `q.enqueue` 直書き `PromotePhotoInput.user`（AuthUser） | `isAnonymous: false` 追加 |
| `mock-upload-queue.ts:198` | `const user: AuthUser = job.user` のアノテーション代入 | 境界で `{ ...job.user, isAnonymous: false }` に復元 |

- `MOCK_CURRENT_USER`（mock-auth-service.ts）は本実装側で `isAnonymous: true` を直接付与。
- **`UploadJob.user`（domain/types.ts:93）の構造型には `isAnonymous` を追加していない**（JSON 永続化前提・設計の禁止事項）。リテラル `user: {...}`（L115/L147 の `UploadJob` 構築）は tsc が赤にせず未変更。
- 研究の予測（追従は A/B + upload-queue の PromotePhotoInput 3件）に対し、`mock-upload-queue.ts:198` が**追加で**必要だった点が差分。記憶でなく tsc に判定させる方針どおり機械的に潰した。

---

## UI 配線

- 全画面 `useRepositories().auth` で `auth.linkWithApple()` を呼び、`useCurrentUser()` で状態購読（既存 `profile/edit.tsx` の updateProfile 配線と同型）。
- `expo-apple-authentication` は画面 import なし。通常 `@/components/ui-button` の `UIButton`（`variant="secondary"` / `loading`）のみ使用。native `AppleAuthenticationButton` 不使用。
- **profile.tsx**: 「プロフィールを編集」直後。匿名→状態テキスト＋「Apple と連携」secondary ボタン（loading=linking）。連携済み→「Apple アカウントと連携済み」テキストのみ（ボタン非表示）。
- **create.tsx**: `note` 直後・`作成する` の前。`host.isAnonymous` のときだけ説明文＋secondary CTA。連携済みは非表示。送信ボタンの `disabled`/`loading` には**非連動**（非ブロッキング）。
- **join.tsx**: `hint` 直後・`参加する` の前。`user.isAnonymous` のときだけ表示。`View` のまま（要素1ブロック追加で溢れず）。送信ボタン非連動。

---

## Investigator リスク3件への対応

- **リスク1（tsc 追従漏れ/過剰修正）**: 型追加後に `tsc` 実行→赤4行のみ修正。`UploadJob.user` 構造型には `isAnonymous` を足さず、AuthUser 復元境界（ts:198）でのみ補完。過剰修正・漏れともになし。tsc = 0 で確認済み。
- **リスク2（displayName 上書きで編集消失）**: `this.user.displayName === MOCK_CURRENT_USER.displayName` のときだけ Apple 名へ更新、編集済みは維持。比較は定数参照でマジック文字列重複なし。テスト「編集済みなら維持」で固定。
- **リスク3（通知重複・テスト手薄・CTA分岐）**: linkWithApple は状態1回確定→1回通知（updateProfile と同経路）。新規 test で「初期匿名/false化/初期名→Apple名・編集済み→維持/通知1回/冪等(通知0)/updateProfile・subscribe 非回帰」を網羅。CTA は匿名時のみ表示で送信ボタン disabled に非連動（非ブロッキング維持）。

---

## 検証結果

- `npx tsc --noEmit` = **0**（exit 0）。
- `npx jest` = **8 suites / 79 tests passed**（既存 72 + 新規 7、回帰なし）。

---

## Reviewer 申し送り

1. **設計外の必須追従1件**: `mock-upload-queue.ts:198`（`const user: AuthUser = job.user`）が `isAnonymous` 必須化で赤化。`UploadJob.user`(永続化構造型・isAnonymous なし)→AuthUser 代入の境界で `{ ...job.user, isAnonymous: false }` を補完。`promotePhoto` は uid/displayName/photoURL のみ参照し `isAnonymous` を見ないため挙動不変。永続化構造（domain/types.ts:93）は未変更。研究の「ts:198 は追従不要」予測との差分（tsc が判定）。
2. **`isAnonymous: false` の既定値選択**: テスト用 `makeUser`/`makeInput` と upload-queue 復元境界はいずれも「アプリ利用中の確定ユーザー」想定のため `false`。匿名初期は `MOCK_CURRENT_USER` のみ `true`。
3. **スコープ厳守**: 実 Apple 認証 / Firebase `linkWithCredential` / サインアウト / 連携必須化には未着手。CTA は非ブロッキング（作成・参加の disabled に非連動）。`expo-apple-authentication` は src/ に import なし（node jest 維持）。
4. コミットはしていない（パイプライン規約どおり Integrator 段階で実施想定）。
