import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import type { UploadJob } from '@/domain/types';
import { createMemoryStore, type KeyValueStore } from '@/repositories/storage';
import type { PromotePhotoInput } from '@/repositories/types';

import { MockUploadQueue, UPLOAD_QUEUE_KEY } from './mock-upload-queue';

function makeInput(slotIndex: number, uri = 'file://photo.jpg'): PromotePhotoInput {
  return {
    tripId: 'trip1',
    user: { uid: 'owner', displayName: 'Owner', isAnonymous: false },
    slotIndex,
    localImage: { uri },
    caption: 'c',
  };
}

/**
 * マイクロタスクを十分に掃いて処理ループの合流を待つ（fake timers と併用）。
 * 逐次プロセッサは「uploading→promotePhoto→remove」を複数の mutation チェーンに分けて
 * 進めるため、固定回数では足りない。多めに await Promise.resolve() を回して安定させる。
 */
async function flush(): Promise<void> {
  for (let i = 0; i < 30; i += 1) {
    await Promise.resolve();
  }
}

/** store に保存されている全ジョブ配列を読む。 */
async function readStore(store: KeyValueStore): Promise<UploadJob[]> {
  const raw = await store.getItem(UPLOAD_QUEUE_KEY);
  return raw ? (JSON.parse(raw) as UploadJob[]) : [];
}

describe('MockUploadQueue: enqueue と永続化', () => {
  it('enqueue 後に pending ジョブが memory store に永続化され、購読者へ即時 emit される', async () => {
    const store = createMemoryStore();
    // promotePhoto は処理されないよう pending のまま観測するため start() しない。
    const q = new MockUploadQueue({ promotePhoto: async () => ({}), store });

    const received: UploadJob[][] = [];
    q.subscribe('trip1', (jobs) => received.push(jobs));
    expect(received).toHaveLength(1); // 登録直後の即時 emit（空）
    expect(received[0]).toEqual([]);

    const job = await q.enqueue(makeInput(0));
    expect(job.status).toBe('pending');
    expect(job.attempts).toBe(0);

    // 永続化されている。
    const stored = await readStore(store);
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe(job.id);
    expect(stored[0].status).toBe('pending');
    expect(stored[0].localImage.uri).toBe('file://photo.jpg');

    // 購読者へ enqueue 後の状態が emit されている。
    const last = received[received.length - 1];
    expect(last).toHaveLength(1);
    expect(last[0].id).toBe(job.id);
  });
});

describe('MockUploadQueue: 処理ループ（成功）', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('start() で pending を処理し、成功するとジョブが store と購読の両方から消える', async () => {
    const store = createMemoryStore();
    const calls: PromotePhotoInput[] = [];
    const q = new MockUploadQueue({
      promotePhoto: async (input) => {
        calls.push(input);
        return {};
      },
      store,
    });

    const received: UploadJob[][] = [];
    q.subscribe('trip1', (jobs) => received.push(jobs));

    await q.enqueue(makeInput(0));
    await q.start();
    await flush();

    // promotePhoto が enqueue 時の値で呼ばれている。
    expect(calls).toHaveLength(1);
    expect(calls[0].slotIndex).toBe(0);
    expect(calls[0].user.uid).toBe('owner');

    // 成功でジョブは除去（store も購読も空）。
    expect(await readStore(store)).toHaveLength(0);
    expect(received[received.length - 1]).toEqual([]);
  });
});

describe('MockUploadQueue: rehydrate（再起動再開）', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('store に pending を仕込んだ新インスタンスが復元して未送信を再開する', async () => {
    const store = createMemoryStore();
    const seeded: UploadJob = {
      id: 'job_seed',
      tripId: 'trip1',
      user: { uid: 'owner', displayName: 'Owner' },
      slotIndex: 2,
      localImage: { uri: 'file://seed.jpg' },
      caption: 'seeded',
      status: 'pending',
      attempts: 0,
      createdAt: 1,
    };
    await store.setItem(UPLOAD_QUEUE_KEY, JSON.stringify([seeded]));

    const calls: PromotePhotoInput[] = [];
    const q = new MockUploadQueue({
      promotePhoto: async (input) => {
        calls.push(input);
        return {};
      },
      store,
    });

    await q.start();
    await flush();

    expect(calls).toHaveLength(1);
    expect(calls[0].slotIndex).toBe(2);
    expect(await readStore(store)).toHaveLength(0); // 処理されて除去
  });

  it('uploading で固まったジョブは rehydrate で pending に正規化されて再送される', async () => {
    const store = createMemoryStore();
    const stuck: UploadJob = {
      id: 'job_stuck',
      tripId: 'trip1',
      user: { uid: 'owner', displayName: 'Owner' },
      slotIndex: 0,
      localImage: { uri: 'file://stuck.jpg' },
      caption: 'stuck',
      status: 'uploading', // クラッシュ痕跡
      attempts: 0,
      createdAt: 1,
    };
    await store.setItem(UPLOAD_QUEUE_KEY, JSON.stringify([stuck]));

    const calls: PromotePhotoInput[] = [];
    const q = new MockUploadQueue({
      promotePhoto: async (input) => {
        calls.push(input);
        return {};
      },
      store,
    });

    await q.start();
    await flush();

    // uploading→pending 正規化 → 再送 → 成功で除去。
    expect(calls).toHaveLength(1);
    expect(await readStore(store)).toHaveLength(0);
  });
});

describe('MockUploadQueue: 失敗と再試行', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('promotePhoto 拒否で failed + attempts++ + error がセットされ保持される', async () => {
    const store = createMemoryStore();
    const q = new MockUploadQueue({
      promotePhoto: async () => {
        throw new Error('色が未配布のため公開できません');
      },
      store,
    });

    const received: UploadJob[][] = [];
    q.subscribe('trip1', (jobs) => received.push(jobs));

    const job = await q.enqueue(makeInput(0));
    await q.start();
    await flush();

    const stored = await readStore(store);
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe(job.id);
    expect(stored[0].status).toBe('failed');
    expect(stored[0].attempts).toBe(1);
    expect(stored[0].error).toBe('色が未配布のため公開できません');
  });

  it('バックオフ経過で failed→pending に戻り再処理される（advanceTimersByTimeAsync）', async () => {
    const store = createMemoryStore();
    let shouldFail = true;
    let calls = 0;
    const q = new MockUploadQueue({
      promotePhoto: async () => {
        calls += 1;
        if (shouldFail) {
          shouldFail = false; // 2回目以降は成功
          throw new Error('一時失敗');
        }
        return {};
      },
      store,
    });

    await q.enqueue(makeInput(0));
    await q.start();
    await flush();

    expect(calls).toBe(1);
    expect((await readStore(store))[0].status).toBe('failed');

    // base=1000ms のバックオフを進めると pending に戻り再処理 → 成功で除去。
    await jest.advanceTimersByTimeAsync(1000);
    await flush();

    expect(calls).toBe(2);
    expect(await readStore(store)).toHaveLength(0);
  });

  it('retry(jobId) で failed が pending に戻り再処理される', async () => {
    const store = createMemoryStore();
    let shouldFail = true;
    let calls = 0;
    const q = new MockUploadQueue({
      promotePhoto: async () => {
        calls += 1;
        if (shouldFail) {
          shouldFail = false;
          throw new Error('一時失敗');
        }
        return {};
      },
      store,
    });

    const job = await q.enqueue(makeInput(0));
    await q.start();
    await flush();
    expect((await readStore(store))[0].status).toBe('failed');

    await q.retry(job.id);
    await flush();

    expect(calls).toBe(2);
    expect(await readStore(store)).toHaveLength(0);
  });
});

describe('MockUploadQueue: 投入順 / 同一スロット後勝ち', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('同一 slotIndex に2件 enqueue すると投入順に promotePhoto が呼ばれる（逐次・後勝ち）', async () => {
    const store = createMemoryStore();
    const order: string[] = [];
    const q = new MockUploadQueue({
      promotePhoto: async (input) => {
        order.push(input.localImage.uri);
        return {};
      },
      store,
    });

    await q.enqueue(makeInput(0, 'file://first.jpg'));
    await q.enqueue(makeInput(0, 'file://second.jpg'));
    await q.start();
    await flush();
    await flush();

    // 投入順に2回 promotePhoto が呼ばれ、後勝ち（second）が最後に確定。
    expect(order).toEqual(['file://first.jpg', 'file://second.jpg']);
    expect(await readStore(store)).toHaveLength(0);
  });

  it('remove(jobId) でジョブが store と購読から消える', async () => {
    const store = createMemoryStore();
    // 処理させないため start() しない。
    const q = new MockUploadQueue({ promotePhoto: async () => ({}), store });

    const received: UploadJob[][] = [];
    q.subscribe('trip1', (jobs) => received.push(jobs));

    const job = await q.enqueue(makeInput(0));
    expect(await readStore(store)).toHaveLength(1);

    await q.remove(job.id);
    expect(await readStore(store)).toHaveLength(0);
    expect(received[received.length - 1]).toEqual([]);
  });
});

// --- 差し戻し対応の回帰テスト（穴1〜5）---------------------------------------

describe('MockUploadQueue: 処理中 enqueue の取りこぼし（should-1 回帰）', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('1件目処理中に届いた enqueue が、処理ループ完了後に必ず拾われて処理される（取りこぼし無し）', async () => {
    // should-1 の不変条件を固定する: 「処理中（processing 非null）に enqueue された pending は
    // ループ完了までに必ず処理され、store/購読に取り残されない」。
    // 1件目の promotePhoto を手動ゲートで滞留させ、その uploading 中に 2件目を enqueue する。
    // enqueue 内の kick() は processing 非null で早期 return するため、ループ側（while 継続 ＋
    // finally 自己再キック）だけが 2件目を拾える経路となる。
    const store = createMemoryStore();
    const calls: string[] = [];
    const gates: Array<() => void> = [];
    const q = new MockUploadQueue({
      promotePhoto: async (input) => {
        calls.push(input.localImage.uri);
        await new Promise<void>((resolve) => gates.push(resolve));
        return {};
      },
      store,
    });

    await q.enqueue(makeInput(0, 'file://first.jpg'));
    await q.start();
    await flush();
    expect(calls).toEqual(['file://first.jpg']); // 1件目 uploading で滞留

    // 処理中（processing 非null）に 2件目を enqueue。kick() は早期 return する。
    await q.enqueue(makeInput(1, 'file://second.jpg'));
    await flush();
    expect(calls).toEqual(['file://first.jpg']); // まだ 1件目を処理中

    // 1件目・2件目の順に解放 → 取りこぼさず両方処理され store は空。
    gates[0]();
    await flush();
    gates[1]?.();
    await flush();

    expect(calls).toEqual(['file://first.jpg', 'file://second.jpg']);
    expect(await readStore(store)).toHaveLength(0);
  });
});

describe('MockUploadQueue: バックオフ上限（穴2）', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('常時失敗だと attempts が上限(5)で止まり、それ以上自動再試行されず failed 保持', async () => {
    const store = createMemoryStore();
    let calls = 0;
    const q = new MockUploadQueue({
      promotePhoto: async () => {
        calls += 1;
        throw new Error('恒常失敗');
      },
      store,
    });

    await q.enqueue(makeInput(0));
    await q.start();
    await flush();

    // backoff = min(1000*2^(n-1), 30000): 1000,2000,4000,8000 を順に進める。
    for (const delay of [1000, 2000, 4000, 8000]) {
      await jest.advanceTimersByTimeAsync(delay);
      await flush();
    }

    const stored = await readStore(store);
    expect(stored).toHaveLength(1);
    expect(stored[0].status).toBe('failed');
    expect(stored[0].attempts).toBe(5); // 上限で停止
    expect(calls).toBe(5);

    // 上限到達後はタイマーを進めても再試行されない。
    await jest.advanceTimersByTimeAsync(60000);
    await flush();
    expect(calls).toBe(5);
    expect((await readStore(store))[0].attempts).toBe(5);
  });
});

describe('MockUploadQueue: 複数 tripId の emit 分離（穴3）', () => {
  it('ある tripId への enqueue で、無関係 tripId のリスナーには余計な emit が飛ばない', async () => {
    const store = createMemoryStore();
    const q = new MockUploadQueue({ promotePhoto: async () => ({}), store });

    const trip1Received: UploadJob[][] = [];
    const trip2Received: UploadJob[][] = [];
    q.subscribe('trip1', (jobs) => trip1Received.push(jobs));
    q.subscribe('trip2', (jobs) => trip2Received.push(jobs));

    // 登録直後の即時 emit（各1回・空）。
    expect(trip1Received).toHaveLength(1);
    expect(trip2Received).toHaveLength(1);

    // trip1 にだけ enqueue。
    await q.enqueue({
      tripId: 'trip1',
      user: { uid: 'owner', displayName: 'Owner', isAnonymous: false },
      slotIndex: 0,
      localImage: { uri: 'file://a.jpg' },
      caption: 'c',
    });

    // trip1 リスナーには追加 emit、trip2 リスナーには増えていない。
    expect(trip1Received.length).toBe(2);
    expect(trip1Received[1]).toHaveLength(1);
    expect(trip2Received.length).toBe(1); // 余計な emit なし
  });
});

describe('MockUploadQueue: 永続化 write 例外の握り潰し（穴4）', () => {
  it('setItem が throw する store でも mutate は reject せず、メモリ状態（購読）が維持される', async () => {
    // setItem が常に throw。getItem は空を返す。
    const throwingStore: KeyValueStore = {
      getItem: async () => null,
      setItem: async () => {
        throw new Error('disk full');
      },
      removeItem: async () => {},
    };
    const q = new MockUploadQueue({ promotePhoto: async () => ({}), store: throwingStore });

    const received: UploadJob[][] = [];
    q.subscribe('trip1', (jobs) => received.push(jobs));

    // reject しないこと（throw が握り潰される）。
    const job = await q.enqueue(makeInput(0));
    expect(job.status).toBe('pending');

    // メモリ状態は維持され購読に流れている。
    const last = received[received.length - 1];
    expect(last).toHaveLength(1);
    expect(last[0].id).toBe(job.id);
  });
});

describe('MockUploadQueue: 壊れ永続化からの起動（穴5）', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('getItem が壊れ JSON を返しても落ちず、空配列で開始する', async () => {
    const brokenStore: KeyValueStore = {
      getItem: async () => '{壊れ',
      setItem: async () => {},
      removeItem: async () => {},
    };
    const q = new MockUploadQueue({ promotePhoto: async () => ({}), store: brokenStore });

    const received: UploadJob[][] = [];
    q.subscribe('trip1', (jobs) => received.push(jobs));

    // start() が throw せず完了し、空で開始。
    await expect(q.start()).resolves.toBeUndefined();
    await flush();

    expect(received[received.length - 1]).toEqual([]);
  });
});
