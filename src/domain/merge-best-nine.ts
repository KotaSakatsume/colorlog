/**
 * 楽観的UIマージ: 確定 Post と送信中 UploadJob を slotIndex で合成する純関数。
 *
 * ベスト9グリッドは「確定 Post（subscribeToTripPosts）」＋「送信中 Job（uploadQueue.subscribe）」を
 * 同一ユーザー・同一 slotIndex で重ね、送信中バッジ/再送を出すために使う。
 * 副作用なし・入力非破壊。画面はこの結果配列だけを見ればよい。
 */

import type { Post, UploadJob, UploadJobStatus } from './types';

/** マージ後の1スロット分の表示セル。 */
export type BestNineCell = {
  slotIndex: number;
  /** 確定 Post。送信中 Job のみのスロットでは null。 */
  post: Post | null;
  /** 送信中 Job（pending/uploading/failed）。無ければ null。 */
  job: UploadJob | null;
  /**
   * このセルの表示状態。
   * - 'filled': 確定 Post を表示（Job が無い、または同スロットに確定済み）。
   * - 'pending'/'uploading'/'failed': 送信中 Job を優先表示（プレースホルダ）。
   * - 'empty': Post も Job も無い空き枠。
   */
  state: 'empty' | 'filled' | UploadJobStatus;
};

/**
 * 指定ユーザーの確定 Post と送信中 Job を 9 スロットへ合成する。
 * - 同一 slotIndex に Post と Job が両方あれば Job を優先（送信中バッジ）。
 * - Job のみ → プレースホルダ（localImage 表示 + 状態バッジ）。
 * - Post のみ → 従来通り filled。
 * - 同一 slotIndex に Job が複数あれば「後勝ち（配列末尾優先）」＝差し替えの投入順と一致。
 */
export function mergeBestNine(posts: Post[], jobs: UploadJob[], userId: string): BestNineCell[] {
  const myPostsBySlot = new Map<number, Post>();
  for (const p of posts) {
    if (p.userId === userId) myPostsBySlot.set(p.slotIndex, p);
  }
  const myJobsBySlot = new Map<number, UploadJob>();
  // 契約: jobs は投入昇順（配列末尾が最新）。同一 slotIndex は後勝ち＝末尾が残る（差し替え順と一致）。
  for (const j of jobs) {
    if (j.user.uid === userId) myJobsBySlot.set(j.slotIndex, j); // 後勝ち（末尾が残る）
  }

  return Array.from({ length: 9 }, (_, slotIndex) => {
    const post = myPostsBySlot.get(slotIndex) ?? null;
    const job = myJobsBySlot.get(slotIndex) ?? null;
    let state: BestNineCell['state'];
    if (job) {
      state = job.status; // 送信中 Job を優先表示
    } else if (post) {
      state = 'filled';
    } else {
      state = 'empty';
    }
    return { slotIndex, post, job, state };
  });
}

/**
 * マージ後に「枚数（filled+送信中）」を数える。
 * 確定 Post と送信中 Job のどちらかがあるスロットを1枚と数える（空き枠判定の真実）。
 */
export function countOccupiedSlots(cells: BestNineCell[]): number {
  return cells.filter((c) => c.state !== 'empty').length;
}
