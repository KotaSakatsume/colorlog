/**
 * 招待コード（数字）の正規化。Firebase / expo-linking 非依存の純関数。
 * ディープリンク受信・手入力の双方から使えるよう domain 層に置く。
 */

/**
 * ディープリンクの queryParams.code を招待コードへ正規化する。
 *
 * `Linking.parse().queryParams?.code` は strict 下で `string | string[] | undefined`。
 * 配列なら先頭を採用し、数字以外を除去して返す。取り出せなければ空文字。
 * 既存の送信時正規化（join.tsx の `code.replace(/[^0-9]/g, '')`）と同じ規則。
 */
export function normalizeInviteCode(raw: string | string[] | undefined): string {
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (first == null) return '';
  return first.replace(/[^0-9]/g, '');
}
