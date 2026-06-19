import { describe, expect, it } from '@jest/globals';

import { COLOR_POOL } from '@/domain/colors';
import { countOccupiedSlots, mergeBestNine } from '@/domain/merge-best-nine';
import type { Post, UploadJob } from '@/domain/types';

const BLUE = COLOR_POOL[0];

function makePost(userId: string, slotIndex: number, id = `post_${slotIndex}`): Post {
  return {
    id,
    userId,
    color: BLUE,
    caption: 'c',
    thumbURL: `thumb://${slotIndex}`,
    imageURL: `img://${slotIndex}`,
    createdAt: new Date('2026-06-02'),
    slotIndex,
  };
}

function makeJob(
  userId: string,
  slotIndex: number,
  status: UploadJob['status'] = 'pending',
  id = `job_${slotIndex}`,
): UploadJob {
  return {
    id,
    tripId: 'trip1',
    user: { uid: userId, displayName: userId },
    slotIndex,
    localImage: { uri: `file://${slotIndex}` },
    caption: 'c',
    status,
    attempts: 0,
    createdAt: 1,
  };
}

describe('mergeBestNine', () => {
  it('常に9セルを slotIndex 昇順で返す', () => {
    const cells = mergeBestNine([], [], 'owner');
    expect(cells).toHaveLength(9);
    expect(cells.map((c) => c.slotIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(cells.every((c) => c.state === 'empty')).toBe(true);
  });

  it('Post のみのスロットは filled になる', () => {
    const cells = mergeBestNine([makePost('owner', 0)], [], 'owner');
    expect(cells[0].state).toBe('filled');
    expect(cells[0].post?.slotIndex).toBe(0);
    expect(cells[0].job).toBeNull();
  });

  it('Job のみのスロットはジョブの状態で表示される（プレースホルダ）', () => {
    const cells = mergeBestNine([], [makeJob('owner', 1, 'uploading')], 'owner');
    expect(cells[1].state).toBe('uploading');
    expect(cells[1].job?.slotIndex).toBe(1);
    expect(cells[1].post).toBeNull();
  });

  it('同一スロットに Post と Job が両方あれば Job を優先表示する', () => {
    const cells = mergeBestNine(
      [makePost('owner', 0)],
      [makeJob('owner', 0, 'pending')],
      'owner',
    );
    expect(cells[0].state).toBe('pending');
    expect(cells[0].job).not.toBeNull();
    expect(cells[0].post).not.toBeNull(); // 確定 Post も保持（送信完了で job が消えれば filled に戻る）
  });

  it('他ユーザーの Post / Job は除外される', () => {
    const cells = mergeBestNine(
      [makePost('other', 0)],
      [makeJob('other', 1)],
      'owner',
    );
    expect(cells.every((c) => c.state === 'empty')).toBe(true);
  });

  it('同一スロットに複数 Job があれば後勝ち（配列末尾優先）', () => {
    const cells = mergeBestNine(
      [],
      [makeJob('owner', 0, 'failed', 'job_a'), makeJob('owner', 0, 'pending', 'job_b')],
      'owner',
    );
    expect(cells[0].job?.id).toBe('job_b');
    expect(cells[0].state).toBe('pending');
  });

  it('failed ジョブは failed 状態として残る', () => {
    const cells = mergeBestNine([], [makeJob('owner', 3, 'failed')], 'owner');
    expect(cells[3].state).toBe('failed');
  });
});

describe('countOccupiedSlots', () => {
  it('Post と Job のどちらかがあるスロットを数える（空き枠判定の真実）', () => {
    const cells = mergeBestNine(
      [makePost('owner', 0), makePost('owner', 1)],
      [makeJob('owner', 2, 'pending'), makeJob('owner', 0, 'uploading')], // slot0 は Post と重複
      'owner',
    );
    // slot0(Post+Job), slot1(Post), slot2(Job) の3スロットが占有。
    expect(countOccupiedSlots(cells)).toBe(3);
  });

  it('全て空なら0', () => {
    expect(countOccupiedSlots(mergeBestNine([], [], 'owner'))).toBe(0);
  });
});
