/**
 * Firestore セキュリティルールの rules-unit-testing。
 *
 * 実行はエミュレータ前提（`npm run test:rules` = firebase emulators:exec 経由）。
 * 当環境には firebase-tools / Java が無いためここでの緑確認は不可。エミュレータ起動下で
 * 緑になるよう「エミュレータ前提」で正しく書く。デフォルト jest（npm test）からは
 * jest.config.js の testPathIgnorePatterns で除外される。
 *
 * SPEC §4 のデータモデルに対応:
 * - trips/{tripId}: memberIds: string[], members: Record<uid, { postCount?, lastPostAt?, ... }>
 * - trips/{tripId}/posts/{postId}: userId, caption, slotIndex(0..8)
 * - inviteCodes/{code}: expiresAt(Timestamp)
 */
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import path from 'path';
import {
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';

const PROJECT_ID = 'demo-colorlog';
const RULES_PATH = path.resolve(__dirname, '../../firestore.rules');

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync(RULES_PATH, 'utf8') },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

/** trip ドキュメントを生成する小道具（必要なフィールドのみ）。 */
function tripDoc(
  memberIds: string[],
  members: Record<string, Record<string, unknown>>,
  hostUserId = memberIds[0],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name: 'trip',
    startDate: Timestamp.fromMillis(0),
    endDate: Timestamp.fromMillis(0),
    hostUserId,
    status: 'active',
    colorsAssigned: false,
    memberIds,
    members,
    ...overrides,
  };
}

describe('trips read (isMember)', () => {
  // ケース1: 非メンバーは read できない
  it('非メンバーは trip を read できない', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), 'trips/t1'),
        tripDoc(['alice'], { alice: { displayName: 'Alice', postCount: 0 } }),
      );
    });
    const bob = testEnv.authenticatedContext('bob');
    await assertFails(getDoc(doc(bob.firestore(), 'trips/t1')));
  });

  // ケース2: メンバーは read できる
  it('メンバーは trip を read できる', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), 'trips/t1'),
        tripDoc(['alice'], { alice: { displayName: 'Alice', postCount: 0 } }),
      );
    });
    const alice = testEnv.authenticatedContext('alice');
    await assertSucceeds(getDoc(doc(alice.firestore(), 'trips/t1')));
  });
});

describe('trips update (isJoiningSelf)', () => {
  // ケース3: 他人を memberIds に追加するのは拒否
  it('他人を memberIds に追加する update は拒否', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), 'trips/t1'),
        tripDoc(['alice'], { alice: { displayName: 'Alice', postCount: 0 } }),
      );
    });
    const bob = testEnv.authenticatedContext('bob');
    await assertFails(
      updateDoc(doc(bob.firestore(), 'trips/t1'), {
        memberIds: ['alice', 'carol'],
      }),
    );
  });

  // ケース4: 自分を memberIds に追加する（参加）のは許可
  it('自分を memberIds に追加する update は許可', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), 'trips/t1'),
        tripDoc(['alice'], { alice: { displayName: 'Alice', postCount: 0 } }),
      );
    });
    const bob = testEnv.authenticatedContext('bob');
    await assertSucceeds(
      updateDoc(doc(bob.firestore(), 'trips/t1'), {
        memberIds: ['alice', 'bob'],
      }),
    );
  });

  // ケース5: 13人目（12人超過）の参加は拒否
  it('12人を超える13人目の参加は拒否', async () => {
    const twelve = Array.from({ length: 12 }, (_, i) => `m${i}`);
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), 'trips/t1'),
        tripDoc(twelve, { m0: { displayName: 'M0', postCount: 0 } }),
      );
    });
    const newcomer = testEnv.authenticatedContext('m12');
    await assertFails(
      updateDoc(doc(newcomer.firestore(), 'trips/t1'), {
        memberIds: [...twelve, 'm12'],
      }),
    );
  });
});

describe('trips update (postCount / rate limit)', () => {
  // ケース8: 自分の postCount を 9 にする更新は許可、10 は拒否
  it('postCount を 9 にする更新は許可', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), 'trips/t1'),
        tripDoc(['alice'], { alice: { displayName: 'Alice', postCount: 8 } }),
      );
    });
    const alice = testEnv.authenticatedContext('alice');
    await assertSucceeds(
      updateDoc(doc(alice.firestore(), 'trips/t1'), {
        'members.alice.postCount': 9,
        'members.alice.lastPostAt': serverTimestamp(),
      }),
    );
  });

  it('postCount を 10 にする更新は拒否', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), 'trips/t1'),
        tripDoc(['alice'], { alice: { displayName: 'Alice', postCount: 9 } }),
      );
    });
    const alice = testEnv.authenticatedContext('alice');
    await assertFails(
      updateDoc(doc(alice.firestore(), 'trips/t1'), {
        'members.alice.postCount': 10,
        'members.alice.lastPostAt': serverTimestamp(),
      }),
    );
  });

  // ケース9: 直前投稿から10秒未満の連投は拒否、10秒超は許可
  it('10秒未満の連投は拒否', async () => {
    const recent = Timestamp.fromMillis(Date.now() - 3 * 1000);
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), 'trips/t1'),
        tripDoc(['alice'], {
          alice: { displayName: 'Alice', postCount: 1, lastPostAt: recent },
        }),
      );
    });
    const alice = testEnv.authenticatedContext('alice');
    await assertFails(
      updateDoc(doc(alice.firestore(), 'trips/t1'), {
        'members.alice.postCount': 2,
        'members.alice.lastPostAt': serverTimestamp(),
      }),
    );
  });

  it('10秒以上経過した連投は許可', async () => {
    const old = Timestamp.fromMillis(Date.now() - 60 * 1000);
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), 'trips/t1'),
        tripDoc(['alice'], {
          alice: { displayName: 'Alice', postCount: 1, lastPostAt: old },
        }),
      );
    });
    const alice = testEnv.authenticatedContext('alice');
    await assertSucceeds(
      updateDoc(doc(alice.firestore(), 'trips/t1'), {
        'members.alice.postCount': 2,
        'members.alice.lastPostAt': serverTimestamp(),
      }),
    );
  });

  // serverTimestamp 強制: クライアントが過去値を lastPostAt に書くのは拒否
  it('lastPostAt にクライアント過去値を書く更新は拒否（serverTimestamp 強制）', async () => {
    const old = Timestamp.fromMillis(Date.now() - 60 * 1000);
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), 'trips/t1'),
        tripDoc(['alice'], {
          alice: { displayName: 'Alice', postCount: 1, lastPostAt: old },
        }),
      );
    });
    const alice = testEnv.authenticatedContext('alice');
    await assertFails(
      updateDoc(doc(alice.firestore(), 'trips/t1'), {
        'members.alice.postCount': 2,
        'members.alice.lastPostAt': Timestamp.fromMillis(Date.now() - 60 * 1000),
      }),
    );
  });
});

describe('trips update（改竄拒否・攻撃系）', () => {
  // 2人 trip（alice=host, bob=member）。bob が攻撃者。
  async function seedTwo(): Promise<void> {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), 'trips/t1'),
        tripDoc(['alice', 'bob'], {
          alice: { displayName: 'Alice', postCount: 0 },
          bob: { displayName: 'Bob', postCount: 0 },
        }),
      );
    });
  }

  // must-1: メンバーが他人を memberIds から追放しようとして拒否
  it('メンバーが他人を memberIds から追放する update は拒否', async () => {
    await seedTwo();
    const bob = testEnv.authenticatedContext('bob');
    await assertFails(
      updateDoc(doc(bob.firestore(), 'trips/t1'), {
        memberIds: ['bob'], // alice を追放
      }),
    );
  });

  // must-1: メンバーが memberIds を自分1人に書き換え（read 権限奪取）して拒否
  it('メンバーが memberIds を改竄する update は拒否', async () => {
    await seedTwo();
    const bob = testEnv.authenticatedContext('bob');
    await assertFails(
      updateDoc(doc(bob.firestore(), 'trips/t1'), {
        memberIds: ['bob', 'carol'], // 他人を勝手に追加
      }),
    );
  });

  // must-1: メンバーが hostUserId を自分に書き換え（host 乗っ取り）して拒否
  it('メンバーが hostUserId を書き換える update は拒否', async () => {
    await seedTwo();
    const bob = testEnv.authenticatedContext('bob');
    await assertFails(
      updateDoc(doc(bob.firestore(), 'trips/t1'), {
        hostUserId: 'bob',
      }),
    );
  });

  // must-1: メンバーが他人の members[other] を書き換えて拒否
  it('メンバーが他人の members エントリを書き換える update は拒否', async () => {
    await seedTwo();
    const bob = testEnv.authenticatedContext('bob');
    await assertFails(
      updateDoc(doc(bob.firestore(), 'trips/t1'), {
        'members.alice.postCount': 9, // 他人の postCount を改竄
      }),
    );
  });

  // must-1: メンバーが status / colorsAssigned 等の不変フィールドを書き換えて拒否
  it('メンバーが status を書き換える update は拒否', async () => {
    await seedTwo();
    const bob = testEnv.authenticatedContext('bob');
    await assertFails(
      updateDoc(doc(bob.firestore(), 'trips/t1'), {
        status: 'archived',
      }),
    );
  });

  // 未認証ユーザーの trip update は拒否（isMember / isJoiningSelf / isHost… すべて false）
  it('未認証ユーザーの trip update は拒否', async () => {
    await seedTwo();
    const anon = testEnv.unauthenticatedContext();
    await assertFails(
      updateDoc(doc(anon.firestore(), 'trips/t1'), {
        'members.alice.postCount': 1,
      }),
    );
  });
});

describe('trips update（参加時の改竄拒否）', () => {
  async function seedOne(): Promise<void> {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), 'trips/t1'),
        tripDoc(['alice'], { alice: { displayName: 'Alice', postCount: 0 } }),
      );
    });
  }

  // must-2: 参加と同時に他人の members エントリを混入させて拒否
  it('参加時に他人の members エントリを混入する update は拒否', async () => {
    await seedOne();
    const bob = testEnv.authenticatedContext('bob');
    await assertFails(
      updateDoc(doc(bob.firestore(), 'trips/t1'), {
        memberIds: ['alice', 'bob'],
        'members.bob': { displayName: 'Bob', postCount: 0 },
        'members.carol': { displayName: 'Carol', postCount: 0 }, // 他人混入
      }),
    );
  });

  // must-2: 参加と同時に他人の既存 members を書き換えて拒否
  it('参加時に既存メンバーの members を書き換える update は拒否', async () => {
    await seedOne();
    const bob = testEnv.authenticatedContext('bob');
    await assertFails(
      updateDoc(doc(bob.firestore(), 'trips/t1'), {
        memberIds: ['alice', 'bob'],
        'members.bob': { displayName: 'Bob', postCount: 0 },
        'members.alice.postCount': 9, // 既存メンバー改竄
      }),
    );
  });

  // must-2: 参加と同時に hostUserId を改竄して拒否
  it('参加時に hostUserId を改竄する update は拒否', async () => {
    await seedOne();
    const bob = testEnv.authenticatedContext('bob');
    await assertFails(
      updateDoc(doc(bob.firestore(), 'trips/t1'), {
        memberIds: ['alice', 'bob'],
        'members.bob': { displayName: 'Bob', postCount: 0 },
        hostUserId: 'bob',
      }),
    );
  });

  // 正当な参加（memberIds + 自分の members エントリのみ）は許可
  it('自分を memberIds + members に追加する正当な参加は許可', async () => {
    await seedOne();
    const bob = testEnv.authenticatedContext('bob');
    await assertSucceeds(
      updateDoc(doc(bob.firestore(), 'trips/t1'), {
        memberIds: ['alice', 'bob'],
        'members.bob': { displayName: 'Bob', postCount: 0 },
      }),
    );
  });
});

describe('trips update（host 色配布）', () => {
  // 未配布の trip を seed（alice=host, bob/carol=member）。
  async function seedUnassigned(): Promise<void> {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), 'trips/t1'),
        tripDoc(
          ['alice', 'bob', 'carol'],
          {
            alice: { displayName: 'Alice', postCount: 0 },
            bob: { displayName: 'Bob', postCount: 0 },
            carol: { displayName: 'Carol', postCount: 0 },
          },
          'alice',
          { colorsAssigned: false, status: 'planning' },
        ),
      );
    });
  }

  // host が全員分の color を1トランザクションで書き、配布フラグを立てる正当経路は許可
  it('host による色配布（全員分の color + colorsAssigned=true）は許可', async () => {
    await seedUnassigned();
    const alice = testEnv.authenticatedContext('alice');
    await assertSucceeds(
      updateDoc(doc(alice.firestore(), 'trips/t1'), {
        colorsAssigned: true,
        status: 'active',
        'members.alice.color': { hex: '#f00', name: 'あか' },
        'members.bob.color': { hex: '#0f0', name: 'みどり' },
        'members.carol.color': { hex: '#00f', name: 'あお' },
      }),
    );
  });

  // 非 host（メンバー）が全員分の color を書こうとすると拒否（onlyMyMemberChanged 違反）
  it('非 host が全員分の color を配布する update は拒否', async () => {
    await seedUnassigned();
    const bob = testEnv.authenticatedContext('bob');
    await assertFails(
      updateDoc(doc(bob.firestore(), 'trips/t1'), {
        colorsAssigned: true,
        'members.alice.color': { hex: '#f00', name: 'あか' },
        'members.bob.color': { hex: '#0f0', name: 'みどり' },
        'members.carol.color': { hex: '#00f', name: 'あお' },
      }),
    );
  });

  // 配布済み trip への再配布（colorsAssigned が既に true）は拒否
  it('配布済み trip への host 再配布は拒否', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), 'trips/t1'),
        tripDoc(
          ['alice', 'bob'],
          {
            alice: { displayName: 'Alice', postCount: 0, color: { hex: '#f00', name: 'あか' } },
            bob: { displayName: 'Bob', postCount: 0, color: { hex: '#0f0', name: 'みどり' } },
          },
          'alice',
          { colorsAssigned: true },
        ),
      );
    });
    const alice = testEnv.authenticatedContext('alice');
    await assertFails(
      updateDoc(doc(alice.firestore(), 'trips/t1'), {
        colorsAssigned: true,
        'members.bob.color': { hex: '#00f', name: 'あお' }, // 再配布
      }),
    );
  });

  // host が配布のふりをして memberIds を改竄するのは拒否
  it('host が色配布に乗じて memberIds を改竄する update は拒否', async () => {
    await seedUnassigned();
    const alice = testEnv.authenticatedContext('alice');
    await assertFails(
      updateDoc(doc(alice.firestore(), 'trips/t1'), {
        colorsAssigned: true,
        memberIds: ['alice'], // 配布に乗じて bob/carol を追放
        'members.alice.color': { hex: '#f00', name: 'あか' },
      }),
    );
  });
});

describe('trips create（members 制約）', () => {
  it('作成時に他人の members エントリを混入すると拒否', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertFails(
      setDoc(
        doc(alice.firestore(), 'trips/t2'),
        tripDoc(['alice'], {
          alice: { displayName: 'Alice', postCount: 0 },
          bob: { displayName: 'Bob', postCount: 0 }, // 他人混入
        }),
      ),
    );
  });

  it('作成時に自分の postCount を 0 以外にすると拒否', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertFails(
      setDoc(
        doc(alice.firestore(), 'trips/t2'),
        tripDoc(['alice'], { alice: { displayName: 'Alice', postCount: 5 } }),
      ),
    );
  });

  it('正当な host のトリップ作成は許可', async () => {
    const alice = testEnv.authenticatedContext('alice');
    await assertSucceeds(
      setDoc(
        doc(alice.firestore(), 'trips/t2'),
        tripDoc(['alice'], { alice: { displayName: 'Alice', postCount: 0 } }),
      ),
    );
  });
});

describe('posts create / read', () => {
  // posts read は親 trip の memberIds を get() する → 親 trip を必ず seed する
  async function seedTrip(): Promise<void> {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), 'trips/t1'),
        tripDoc(['alice'], { alice: { displayName: 'Alice', postCount: 0 } }),
      );
    });
  }

  function postDoc(userId: string, caption: string, slotIndex = 0): Record<string, unknown> {
    return {
      userId,
      color: 'あか',
      caption,
      thumbURL: 'https://example.com/t.jpg',
      imageURL: 'https://example.com/i.jpg',
      createdAt: serverTimestamp(),
      slotIndex,
    };
  }

  // ケース6: 他人の userId で post create は拒否
  it('他人の userId での post create は拒否', async () => {
    await seedTrip();
    const alice = testEnv.authenticatedContext('alice');
    await assertFails(
      setDoc(doc(alice.firestore(), 'trips/t1/posts/p1'), postDoc('bob', 'hi')),
    );
  });

  // ケース7: caption 201字は拒否、200字は許可
  it('caption 201字の post create は拒否', async () => {
    await seedTrip();
    const alice = testEnv.authenticatedContext('alice');
    await assertFails(
      setDoc(
        doc(alice.firestore(), 'trips/t1/posts/p1'),
        postDoc('alice', 'x'.repeat(201)),
      ),
    );
  });

  it('caption 200字・正常な post create は許可', async () => {
    await seedTrip();
    const alice = testEnv.authenticatedContext('alice');
    await assertSucceeds(
      setDoc(
        doc(alice.firestore(), 'trips/t1/posts/p1'),
        postDoc('alice', 'x'.repeat(200)),
      ),
    );
  });

  it('メンバーは post を read できる', async () => {
    await seedTrip();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'trips/t1/posts/p1'), postDoc('alice', 'hi'));
    });
    const alice = testEnv.authenticatedContext('alice');
    await assertSucceeds(getDoc(doc(alice.firestore(), 'trips/t1/posts/p1')));
  });

  it('非メンバーは post を read できない', async () => {
    await seedTrip();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'trips/t1/posts/p1'), postDoc('alice', 'hi'));
    });
    const bob = testEnv.authenticatedContext('bob');
    await assertFails(getDoc(doc(bob.firestore(), 'trips/t1/posts/p1')));
  });

  // posts は read/create のみ許可。update/delete は明示ルールが無く暗黙 deny。
  // 昇格の「差し替え」は新 postId への create + 旧画像削除（Storage）で行う設計（SPEC §5-7）。
  it('post の update は所有者でも拒否（create のみ許可・暗黙 deny）', async () => {
    await seedTrip();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'trips/t1/posts/p1'), postDoc('alice', 'hi'));
    });
    const alice = testEnv.authenticatedContext('alice');
    await assertFails(
      updateDoc(doc(alice.firestore(), 'trips/t1/posts/p1'), { caption: 'edited' }),
    );
  });

  it('post の delete は所有者でも拒否（暗黙 deny）', async () => {
    await seedTrip();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'trips/t1/posts/p1'), postDoc('alice', 'hi'));
    });
    const alice = testEnv.authenticatedContext('alice');
    await assertFails(deleteDoc(doc(alice.firestore(), 'trips/t1/posts/p1')));
  });
});

describe('posts update（reactionCounts のみ限定許可）', () => {
  async function seedTripAndPost(): Promise<void> {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), 'trips/t1'),
        tripDoc(['alice', 'bob'], {
          alice: { displayName: 'Alice', postCount: 1 },
          bob: { displayName: 'Bob', postCount: 0 },
        }),
      );
      await setDoc(doc(ctx.firestore(), 'trips/t1/posts/p1'), {
        userId: 'alice',
        color: 'あか',
        caption: 'hi',
        thumbURL: 'https://example.com/t.jpg',
        imageURL: 'https://example.com/i.jpg',
        createdAt: serverTimestamp(),
        slotIndex: 0,
        reactionCounts: { '❤️': 1 },
      });
    });
  }

  // メンバーが reactionCounts のみを更新（increment 相当）するのは許可
  it('メンバーは post の reactionCounts のみ update できる', async () => {
    await seedTripAndPost();
    const bob = testEnv.authenticatedContext('bob');
    await assertSucceeds(
      updateDoc(doc(bob.firestore(), 'trips/t1/posts/p1'), {
        'reactionCounts.🔥': 1,
      }),
    );
  });

  // reactionCounts と同時に投稿本体フィールド（caption）を書き換えるのは拒否
  it('reactionCounts に乗じて caption を書き換える update は拒否', async () => {
    await seedTripAndPost();
    const bob = testEnv.authenticatedContext('bob');
    await assertFails(
      updateDoc(doc(bob.firestore(), 'trips/t1/posts/p1'), {
        'reactionCounts.🔥': 1,
        caption: 'hijacked',
      }),
    );
  });

  // reactionCounts 以外（userId/slotIndex 等）の改竄は拒否
  it('userId / slotIndex を書き換える update は拒否', async () => {
    await seedTripAndPost();
    const bob = testEnv.authenticatedContext('bob');
    await assertFails(
      updateDoc(doc(bob.firestore(), 'trips/t1/posts/p1'), {
        userId: 'bob',
        slotIndex: 5,
      }),
    );
  });

  // 非メンバーは reactionCounts update もできない
  it('非メンバーは post の reactionCounts を update できない', async () => {
    await seedTripAndPost();
    const carol = testEnv.authenticatedContext('carol');
    await assertFails(
      updateDoc(doc(carol.firestore(), 'trips/t1/posts/p1'), {
        'reactionCounts.🔥': 1,
      }),
    );
  });
});

describe('reactions（自分のみ・許可絵文字・メンバー read）', () => {
  async function seedTripAndPost(): Promise<void> {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), 'trips/t1'),
        tripDoc(['alice', 'bob'], {
          alice: { displayName: 'Alice', postCount: 1 },
          bob: { displayName: 'Bob', postCount: 0 },
        }),
      );
      await setDoc(doc(ctx.firestore(), 'trips/t1/posts/p1'), {
        userId: 'alice',
        color: 'あか',
        caption: 'hi',
        thumbURL: 'https://example.com/t.jpg',
        imageURL: 'https://example.com/i.jpg',
        createdAt: serverTimestamp(),
        slotIndex: 0,
      });
    });
  }

  // 自分の uid の reaction を許可絵文字で set するのは許可
  it('自分の reaction を許可絵文字で set できる', async () => {
    await seedTripAndPost();
    const bob = testEnv.authenticatedContext('bob');
    await assertSucceeds(
      setDoc(doc(bob.firestore(), 'trips/t1/posts/p1/reactions/bob'), { emoji: '🔥' }),
    );
  });

  // 自分の reaction を delete するのは許可（解除）
  it('自分の reaction を delete できる', async () => {
    await seedTripAndPost();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'trips/t1/posts/p1/reactions/bob'), { emoji: '🔥' });
    });
    const bob = testEnv.authenticatedContext('bob');
    await assertSucceeds(deleteDoc(doc(bob.firestore(), 'trips/t1/posts/p1/reactions/bob')));
  });

  // 他人の uid の reaction ドキュメントへ書くのは拒否（なりすまし防止）
  it('他人 uid の reaction を set するのは拒否', async () => {
    await seedTripAndPost();
    const bob = testEnv.authenticatedContext('bob');
    await assertFails(
      setDoc(doc(bob.firestore(), 'trips/t1/posts/p1/reactions/alice'), { emoji: '🔥' }),
    );
  });

  // 確定集合に無い絵文字は拒否（集計汚染防止）
  it('不正な絵文字での reaction set は拒否', async () => {
    await seedTripAndPost();
    const bob = testEnv.authenticatedContext('bob');
    await assertFails(
      setDoc(doc(bob.firestore(), 'trips/t1/posts/p1/reactions/bob'), { emoji: '💩' }),
    );
  });

  // 非メンバーは reaction を read できない
  it('非メンバーは reaction を read できない', async () => {
    await seedTripAndPost();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'trips/t1/posts/p1/reactions/bob'), { emoji: '🔥' });
    });
    const carol = testEnv.authenticatedContext('carol');
    await assertFails(getDoc(doc(carol.firestore(), 'trips/t1/posts/p1/reactions/bob')));
  });

  // メンバーは reaction を read できる
  it('メンバーは reaction を read できる', async () => {
    await seedTripAndPost();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'trips/t1/posts/p1/reactions/bob'), { emoji: '🔥' });
    });
    const alice = testEnv.authenticatedContext('alice');
    await assertSucceeds(getDoc(doc(alice.firestore(), 'trips/t1/posts/p1/reactions/bob')));
  });

  // 非メンバーは自分の uid でも reaction を set できない（isPostMember 不成立）
  it('非メンバーは自分の uid でも reaction を set できない', async () => {
    await seedTripAndPost();
    const carol = testEnv.authenticatedContext('carol');
    await assertFails(
      setDoc(doc(carol.firestore(), 'trips/t1/posts/p1/reactions/carol'), { emoji: '🔥' }),
    );
  });
});

describe('inviteCodes read (expiresAt)', () => {
  // ケース10: 有効な inviteCode は認証済みで read できる
  it('未失効の inviteCode は認証済みで read できる', async () => {
    const future = Timestamp.fromMillis(Date.now() + 60 * 60 * 1000);
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'inviteCodes/abc'), {
        code: 'abc',
        tripId: 't1',
        expiresAt: future,
      });
    });
    const alice = testEnv.authenticatedContext('alice');
    await assertSucceeds(getDoc(doc(alice.firestore(), 'inviteCodes/abc')));
  });

  // ケース11: 期限切れの inviteCode は read 拒否
  it('期限切れの inviteCode は read 拒否', async () => {
    const past = Timestamp.fromMillis(Date.now() - 60 * 60 * 1000);
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'inviteCodes/abc'), {
        code: 'abc',
        tripId: 't1',
        expiresAt: past,
      });
    });
    const alice = testEnv.authenticatedContext('alice');
    await assertFails(getDoc(doc(alice.firestore(), 'inviteCodes/abc')));
  });

  it('未認証ユーザーは inviteCode を read できない', async () => {
    const future = Timestamp.fromMillis(Date.now() + 60 * 60 * 1000);
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'inviteCodes/abc'), {
        code: 'abc',
        tripId: 't1',
        expiresAt: future,
      });
    });
    const anon = testEnv.unauthenticatedContext();
    await assertFails(getDoc(doc(anon.firestore(), 'inviteCodes/abc')));
  });
});
