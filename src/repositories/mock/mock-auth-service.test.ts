import { describe, expect, it } from '@jest/globals';

import type { AuthUser } from '@/repositories/types';

import { MOCK_APPLE_DISPLAY_NAME, MOCK_CURRENT_USER, MockAuthService } from './mock-auth-service';

describe('MockAuthService', () => {
  it('初期ユーザーは匿名（isAnonymous === true）', () => {
    const auth = new MockAuthService();
    expect(auth.getCurrentUser().isAnonymous).toBe(true);
    expect(auth.getCurrentUser().displayName).toBe(MOCK_CURRENT_USER.displayName);
  });

  it('linkWithApple で isAnonymous が false 化し、初期表示名なら Apple 名へ更新する', async () => {
    const auth = new MockAuthService();
    const linked = await auth.linkWithApple();

    expect(linked.isAnonymous).toBe(false);
    expect(linked.displayName).toBe(MOCK_APPLE_DISPLAY_NAME);
    expect(auth.getCurrentUser().isAnonymous).toBe(false);
    expect(auth.getCurrentUser().displayName).toBe(MOCK_APPLE_DISPLAY_NAME);
  });

  it('表示名を編集済みなら linkWithApple で表示名を維持する', async () => {
    const auth = new MockAuthService();
    auth.updateProfile({ displayName: 'たろう' });

    const linked = await auth.linkWithApple();

    expect(linked.isAnonymous).toBe(false);
    expect(linked.displayName).toBe('たろう');
  });

  it('linkWithApple は購読者へ連携後ユーザーを1回通知する', async () => {
    const auth = new MockAuthService();
    const received: AuthUser[] = [];
    auth.subscribe((u) => received.push(u));

    // subscribe 直後の初期通知（匿名）。
    expect(received).toHaveLength(1);
    expect(received[0].isAnonymous).toBe(true);

    await auth.linkWithApple();

    // 連携で追加1回のみ（重複通知しない）。
    expect(received).toHaveLength(2);
    expect(received[1].isAnonymous).toBe(false);
    expect(received[1].displayName).toBe(MOCK_APPLE_DISPLAY_NAME);
  });

  it('連携済みでの再 linkWithApple は冪等（状態不変・通知しない）', async () => {
    const auth = new MockAuthService();
    await auth.linkWithApple();

    const received: AuthUser[] = [];
    auth.subscribe((u) => received.push(u));
    // subscribe の初期通知のみ。
    expect(received).toHaveLength(1);

    const again = await auth.linkWithApple();

    expect(again.isAnonymous).toBe(false);
    expect(again.displayName).toBe(MOCK_APPLE_DISPLAY_NAME);
    // 追加通知なし（冪等）。
    expect(received).toHaveLength(1);
  });

  it('updateProfile は表示名を更新し購読者へ通知する（既存挙動・非回帰）', () => {
    const auth = new MockAuthService();
    const received: AuthUser[] = [];
    auth.subscribe((u) => received.push(u));

    auth.updateProfile({ displayName: 'はなこ' });

    expect(auth.getCurrentUser().displayName).toBe('はなこ');
    // 初期通知 + 更新通知。
    expect(received).toHaveLength(2);
    expect(received[1].displayName).toBe('はなこ');
  });

  it('updateProfile は avatarConfig を保存し購読者へ通知する（Issue #25）', () => {
    const auth = new MockAuthService();
    const received: AuthUser[] = [];
    auth.subscribe((u) => received.push(u));

    const config = { selections: { head: 'hm1-p-000005' }, colors: { hair: '#FF0000' } };
    auth.updateProfile({ avatarConfig: config });

    expect(auth.getCurrentUser().avatarConfig).toEqual(config);
    // 初期通知 + 更新通知。
    expect(received).toHaveLength(2);
    expect(received[1].avatarConfig).toEqual(config);
  });

  it('avatarConfig 更新は displayName など他フィールドを壊さない（部分更新）', () => {
    const auth = new MockAuthService();
    auth.updateProfile({ displayName: 'みき' });
    auth.updateProfile({ avatarConfig: { colors: { skin: '#FFCC99' } } });

    expect(auth.getCurrentUser().displayName).toBe('みき');
    expect(auth.getCurrentUser().avatarConfig).toEqual({ colors: { skin: '#FFCC99' } });
  });

  it('avatarConfig に {} を渡すと既定へリセットできる', () => {
    const auth = new MockAuthService();
    auth.updateProfile({ avatarConfig: { colors: { hair: '#FF0000' } } });
    auth.updateProfile({ avatarConfig: {} });

    expect(auth.getCurrentUser().avatarConfig).toEqual({});
  });

  it('subscribe は登録直後に現在値を即時通知し、unsubscribe 後は通知しない', () => {
    const auth = new MockAuthService();
    const received: AuthUser[] = [];
    const unsubscribe = auth.subscribe((u) => received.push(u));

    expect(received).toHaveLength(1);

    unsubscribe();
    auth.updateProfile({ displayName: 'いちろう' });

    expect(received).toHaveLength(1);
  });
});
