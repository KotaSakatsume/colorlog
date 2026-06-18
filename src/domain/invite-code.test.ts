import { describe, expect, it } from '@jest/globals';

import { normalizeInviteCode } from './invite-code';

describe('normalizeInviteCode', () => {
  it('文字列の数字をそのまま返す', () => {
    expect(normalizeInviteCode('123456')).toBe('123456');
  });

  it('数字以外を除去する', () => {
    expect(normalizeInviteCode('12-34-56')).toBe('123456');
    expect(normalizeInviteCode(' 1 2 3 ')).toBe('123');
  });

  it('配列なら先頭要素を採用する（queryParams が string[] のケース）', () => {
    expect(normalizeInviteCode(['654321', '999999'])).toBe('654321');
  });

  it('undefined / 空配列 / 数字なしは空文字を返す', () => {
    expect(normalizeInviteCode(undefined)).toBe('');
    expect(normalizeInviteCode([])).toBe('');
    expect(normalizeInviteCode('abc')).toBe('');
  });
});
