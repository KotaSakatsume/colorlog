/**
 * ID / 招待コード生成ユーティリティ。
 * Mock 層と画面で使う。Firebase 実装では Firestore の自動 ID に置き換わる。
 */

const CODE_ALPHABET = '0123456789'; // 招待コードは数字のみ

/** 衝突しにくいランダム ID（Mock のドキュメント ID 用）。 */
export function generateId(prefix = 'id'): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36);
  return `${prefix}_${time}${rand}`;
}

/** 6桁の数字の招待コード。読み上げ・テンキー入力しやすいよう数字のみ。 */
export function generateInviteCode(length = 6): string {
  let code = '';
  for (let i = 0; i < length; i += 1) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}
