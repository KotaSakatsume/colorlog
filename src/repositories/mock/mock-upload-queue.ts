/**
 * Mock の UploadQueue 実装（プロセッサ内蔵）。
 *
 * 撮影と昇格(promotePhoto)を分離する送信キュー。enqueue は即 pending ジョブを返し、
 * 注入された逐次プロセッサが pending を1件ずつ uploading→promotePhoto で確定する。
 * - 永続化: 注入された KeyValueStore（本番=AsyncStorage / テスト=createMemoryStore）へ
 *   全ジョブ配列を単一キーに JSON で書く。read/write 例外は握りつぶしログのみ（撮る体験を守る）。
 * - 購読: mock-backend.ts と同形（Map<tripId, Set<listener>> + 登録直後の即時 emit）。
 * - 直列化: enqueue/remove/retry/状態遷移と永続化を単一の Promise チェーンに載せて
 *   「メモリ更新 → 永続化 → emit」順を保つ（write の前後入れ替わり防止）。
 */

import type { UploadJob } from '@/domain/types';
import { generateId } from '@/domain/id';
import type { PromotePhotoInput, Unsubscribe, AuthUser } from '@/repositories/types';
import type { KeyValueStore } from '@/repositories/storage';

/** 永続化キー（スキーマ版 v1）。ジョブ総数は少数なので単一キーに全配列を持つ。 */
export const UPLOAD_QUEUE_KEY = 'colorlog:uploadQueue:v1';

/** 失敗ジョブの自動再試行上限。これを超えたら failed のまま保持（手動 retry 待ち）。 */
const MAX_ATTEMPTS = 5;
/** バックオフの基準 ms と上限 ms。backoff = min(base * 2^(attempts-1), cap)。 */
const BACKOFF_BASE_MS = 1000;
const BACKOFF_CAP_MS = 30000;

type JobsListener = (jobs: UploadJob[]) => void;

type Deps = {
  /** ジョブを確定させる本体（MockPostRepository.promotePhoto を注入）。 */
  promotePhoto: (input: PromotePhotoInput) => Promise<unknown>;
  /** 永続化ストア（本番=AsyncStorage / テスト=memory）。 */
  store: KeyValueStore;
};

export class MockUploadQueue {
  private jobs: UploadJob[] = [];
  private readonly listeners = new Map<string, Set<JobsListener>>();

  // mutation と永続化を直列化する Promise チェーン（write の前後入れ替わり防止）。
  private mutationChain: Promise<void> = Promise.resolve();
  // プロセッサの単一処理ループ。多重起動しないよう1本に束ねる（二重送信防止）。
  private processing: Promise<void> | null = null;
  private started = false;
  // バックオフ中の setTimeout ハンドル。現状は発火時に自己 delete するのみ（leak 監視・
  // 将来の一括 clear/dispose 用の保持点）。dispose API は本 PR スコープ外（mock は単一寿命）。
  private readonly backoffTimers = new Set<ReturnType<typeof setTimeout>>();

  constructor(private readonly deps: Deps) {}

  // --- ライフサイクル -----------------------------------------------------

  /** 永続化から復元し、処理ループを開始する（冪等）。 */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await this.rehydrate();
    this.kick();
  }

  // --- UploadQueue interface ----------------------------------------------

  async enqueue(input: PromotePhotoInput): Promise<UploadJob> {
    const job: UploadJob = {
      id: generateId('job'),
      tripId: input.tripId,
      user: { uid: input.user.uid, displayName: input.user.displayName, photoURL: input.user.photoURL },
      slotIndex: input.slotIndex,
      localImage: { uri: input.localImage.uri, width: input.localImage.width, height: input.localImage.height },
      caption: input.caption,
      status: 'pending',
      attempts: 0,
      createdAt: Date.now(),
    };
    // 末尾に積む。pending は配列の挿入順に取り出すため、同一スロット後勝ち（差し替え）を保証。
    await this.mutate((jobs) => [...jobs, job]);
    this.kick();
    return job;
  }

  subscribe(tripId: string, listener: JobsListener): Unsubscribe {
    const set = this.listeners.get(tripId) ?? new Set<JobsListener>();
    set.add(listener);
    this.listeners.set(tripId, set);
    listener(this.jobsForTrip(tripId)); // 初期値を即時に流す
    return () => set.delete(listener);
  }

  async retry(jobId: string): Promise<void> {
    await this.mutate((jobs) =>
      jobs.map((j) =>
        j.id === jobId && j.status === 'failed'
          ? { ...j, status: 'pending', error: undefined }
          : j,
      ),
    );
    this.kick();
  }

  async remove(jobId: string): Promise<void> {
    await this.mutate((jobs) => jobs.filter((j) => j.id !== jobId));
  }

  // --- 内部: mutation 直列化 / 永続化 / emit -------------------------------

  /**
   * メモリ更新 → 永続化 → emit を1ステップとして直列化する。
   * 影響のあった全 tripId（前後差分）へ emit する。
   */
  private mutate(updater: (jobs: UploadJob[]) => UploadJob[]): Promise<void> {
    const next = this.mutationChain.then(async () => {
      const before = this.jobs;
      const after = updater(before);
      this.jobs = after;
      await this.persist();
      this.emitAffected(before, after);
    });
    // チェーンが reject で止まらないよう握る（永続化例外はログのみ）。
    this.mutationChain = next.catch(() => {});
    return next;
  }

  private async persist(): Promise<void> {
    try {
      await this.deps.store.setItem(UPLOAD_QUEUE_KEY, JSON.stringify(this.jobs));
    } catch (e) {
      // 永続化失敗はメモリ状態を維持しログのみ（撮る体験を止めない）。
      console.warn('[UploadQueue] 永続化に失敗しました', e);
    }
  }

  private async rehydrate(): Promise<void> {
    let loaded: UploadJob[] = [];
    try {
      const raw = await this.deps.store.getItem(UPLOAD_QUEUE_KEY);
      const parsed = raw ? (JSON.parse(raw) as UploadJob[]) : [];
      // クラッシュで uploading のまま残ったジョブは pending に戻す（再送）。
      loaded = parsed.map((j) => (j.status === 'uploading' ? { ...j, status: 'pending' } : j));
    } catch (e) {
      // 壊れた値で機能停止させない。空で開始しログのみ。
      console.warn('[UploadQueue] 復元に失敗しました。空で開始します', e);
      loaded = [];
    }
    await this.mutate(() => loaded);
  }

  private emitAffected(before: UploadJob[], after: UploadJob[]): void {
    const tripIds = new Set<string>();
    for (const j of before) tripIds.add(j.tripId);
    for (const j of after) tripIds.add(j.tripId);
    for (const tripId of tripIds) {
      this.listeners.get(tripId)?.forEach((fn) => fn(this.jobsForTrip(tripId)));
    }
  }

  private jobsForTrip(tripId: string): UploadJob[] {
    return this.jobs.filter((j) => j.tripId === tripId);
  }

  // --- 内部: 逐次プロセッサ -----------------------------------------------

  /** 処理ループを起動する（多重起動しない＝単一チェーンに束ねる）。 */
  private kick(): void {
    if (this.processing) return;
    this.processing = this.runLoop().finally(() => {
      this.processing = null;
      // runLoop 終了判定（nextPending→undefined）と processing=null の窓の間に
      // enqueue/retry された pending を取りこぼさないよう、残があれば自己再キックする。
      if (this.nextPending()) this.kick();
    });
  }

  /** pending を挿入順に1件ずつ確定させる逐次ループ。uploading は再ピックしない。 */
  private async runLoop(): Promise<void> {
    // mutation の直前確定を待ってから次の pending を見る。
    await this.mutationChain;
    let job = this.nextPending();
    while (job) {
      await this.processOne(job);
      await this.mutationChain;
      job = this.nextPending();
    }
  }

  private nextPending(): UploadJob | undefined {
    // 挿入順（配列前方）で最初の pending を取る。uploading/failed は対象外。
    return this.jobs.find((j) => j.status === 'pending');
  }

  private async processOne(job: UploadJob): Promise<void> {
    await this.mutate((jobs) =>
      jobs.map((j) => (j.id === job.id ? { ...j, status: 'uploading' } : j)),
    );

    try {
      // 設計§93: レート制限(lastPostAt 最小間隔)整合の集約点。逐次処理点にフックを1か所だけ確保。
      await this.rateLimitGate(job);
      // UploadJob.user は JSON 永続化用の独立構造型（isAnonymous を持たない）。
      // promotePhoto に渡す AuthUser を境界で復元する。isAnonymous は promotePhoto の
      // 挙動に影響しない（uid/displayName/photoURL のみ参照）ため既定 false を補う。
      const user: AuthUser = { ...job.user, isAnonymous: false };
      await this.deps.promotePhoto({
        tripId: job.tripId,
        user,
        slotIndex: job.slotIndex,
        localImage: job.localImage,
        caption: job.caption,
      });
      // 成功: ジョブ除去（確定 Post は subscribeToTripPosts 経由で画面に出る）。
      await this.remove(job.id);
    } catch (e) {
      const attempts = job.attempts + 1;
      const error = String(e instanceof Error ? e.message : e);
      await this.mutate((jobs) =>
        jobs.map((j) =>
          j.id === job.id ? { ...j, status: 'failed', attempts, error } : j,
        ),
      );
      if (attempts < MAX_ATTEMPTS) {
        this.scheduleRetry(job.id, attempts);
      }
    }
  }

  /**
   * 設計§93 レート制限フック（集約点）。現状は no-op。
   * TODO(Firebase): trip.members[uid].lastPostAt を見て最小間隔(10秒)未満なら遅延する。
   * 逐次処理点はここ1か所なので、本実装時もプロセッサ側を触らずここだけ差し替えられる。
   */
  private async rateLimitGate(_job: UploadJob): Promise<void> {
    // no-op（挙動不変）。
  }

  /** 単純バックオフ後に failed→pending へ戻して再キックする。 */
  private scheduleRetry(jobId: string, attempts: number): void {
    const delay = Math.min(BACKOFF_BASE_MS * 2 ** (attempts - 1), BACKOFF_CAP_MS);
    const timer = setTimeout(() => {
      this.backoffTimers.delete(timer);
      void this.mutate((jobs) =>
        jobs.map((j) =>
          j.id === jobId && j.status === 'failed'
            ? { ...j, status: 'pending', error: undefined }
            : j,
        ),
      ).then(() => this.kick());
    }, delay);
    this.backoffTimers.add(timer);
  }
}
