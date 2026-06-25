/**
 * Repository インターフェース（SPEC セクション3）
 *
 * ストア/フックはこのインターフェースだけに依存し、Firebase を直接 import しない。
 * Mock 実装と Firebase 実装を差し替え可能にするための境界。
 */

import type { AvatarConfig } from '@/domain/avatar';
import type {
  InviteCode,
  Post,
  ReactionEmoji,
  ReactionSummary,
  Trip,
  UploadJob,
} from '@/domain/types';

/** 購読解除関数 */
export type Unsubscribe = () => void;

/** 認証済みユーザー（Mock では固定ユーザー、Firebase では Firebase Auth のユーザー） */
export type AuthUser = {
  uid: string;
  displayName: string;
  photoURL?: string;
  /** 匿名ユーザーか。Apple 連携後は false。Mock では初期 true。 */
  isAnonymous: boolean;
  /** ユーザーが選んだアバターの見た目。未設定なら seed 既定（後方互換）。 */
  avatarConfig?: AvatarConfig;
};

/** 端末内の撮影候補（クラウド外。ベスト9へ昇格した瞬間だけアップロードされる）。 */
export type LocalImage = {
  uri: string;
  width?: number;
  height?: number;
};

/** リサイズ済みの1枚（本画像 or サムネ）。width/height は実体寸法（将来の Firestore 書き込み用前方データ）。 */
export type ProcessedImage = {
  uri: string;
  width: number;
  height: number;
};

/** `ImageProcessor.process` の結果。本画像（長辺1600）とサムネ（長辺400）の2サイズ。 */
export type ProcessedImages = {
  main: ProcessedImage;
  thumb: ProcessedImage;
};

/**
 * 1枚の端末内画像を本画像・サムネの2サイズへ整える境界。
 * 寸法決定は domain の computeTargetSize に委譲し、Mock（node 完結）と
 * Expo（expo-image-manipulator）を DI で差し替える。実 Storage へのアップロードは別Issue。
 */
export interface ImageProcessor {
  process(input: LocalImage): Promise<ProcessedImages>;
}

export type CreateTripInput = {
  name: string;
  startDate: Date;
  endDate: Date;
  host: AuthUser;
};

export type JoinTripInput = {
  code: string;
  user: AuthUser;
};

export type CreateTripResult = {
  trip: Trip;
  inviteCode: InviteCode;
};

export type PromotePhotoInput = {
  tripId: string;
  user: AuthUser;
  /** 0〜8。差し替え対象 or 追加先のスロット。 */
  slotIndex: number;
  /** ベスト9へ昇格させる端末内の写真。 */
  localImage: LocalImage;
  caption: string;
};

export type ToggleReactionInput = {
  tripId: string;
  postId: string;
  user: AuthUser;
  /** 押した絵文字。同じ絵文字を再度押すと解除。別の絵文字なら付け替え。 */
  emoji: ReactionEmoji;
};

/** プロフィール更新で変更できる項目。 */
export type ProfileUpdate = Partial<Pick<AuthUser, 'displayName' | 'photoURL' | 'avatarConfig'>>;

/** 認証サービス（この段階では Mock の固定ユーザーのみ） */
export interface AuthService {
  getCurrentUser(): AuthUser;
  /** 現在ユーザーのプロフィールを更新する。 */
  updateProfile(patch: ProfileUpdate): void;
  /**
   * 匿名ユーザーを Apple アカウントへ連携させる（isAnonymous を false 化）。
   * 連携後ユーザーを返し、購読者にも同値を通知する。既に連携済みなら冪等（現ユーザーを返す）。
   */
  linkWithApple(): Promise<AuthUser>;
  /** 現在ユーザーの変更を購読する（登録直後に現在値を即時通知）。 */
  subscribe(listener: (user: AuthUser) => void): Unsubscribe;
}

/**
 * トリップの読み書き。
 * リアルタイム同期は subscribe* がコールバックで最新値を流す
 * （Firebase 実装では Firestore の onSnapshot に対応）。
 */
export interface TripRepository {
  /** 自分が参加中のトリップ一覧を購読する。 */
  subscribeToUserTrips(userId: string, listener: (trips: Trip[]) => void): Unsubscribe;
  /** 単一トリップを購読する。存在しなければ null。 */
  subscribeToTrip(tripId: string, listener: (trip: Trip | null) => void): Unsubscribe;

  getTrip(tripId: string): Promise<Trip | null>;
  resolveInviteCode(code: string): Promise<InviteCode | null>;
  /** トリップに紐づく有効な招待コードを返す。無ければ null。 */
  getInviteCodeForTrip(tripId: string): Promise<InviteCode | null>;

  createTrip(input: CreateTripInput): Promise<CreateTripResult>;
  joinTrip(input: JoinTripInput): Promise<Trip>;

  /**
   * トリップを削除する。関連する投稿・招待コードもまとめて消える。
   * 存在しない tripId は no-op（冪等）。
   */
  deleteTrip(tripId: string): Promise<void>;

  /**
   * 色配布（核トランザクション）。
   * 未配布なら全員分の色を1回で書き、配布済みなら例外。二重配布は起きない。
   */
  assignColors(tripId: string): Promise<Trip>;
}

/** 投稿（ベスト9）の読み書き。 */
export interface PostRepository {
  /** トリップ内の全投稿を購読する。 */
  subscribeToTripPosts(tripId: string, listener: (posts: Post[]) => void): Unsubscribe;

  /**
   * 端末内の写真をベスト9へ昇格させる（SPEC 5-7）。
   * 空き枠（postCount < 9）への追加と、9枠埋まり時の差し替えを同じ経路で扱う。
   * 差し替え時は対象スロットの旧 Post を新 Post に置換する。
   */
  promotePhoto(input: PromotePhotoInput): Promise<Post>;

  /**
   * トリップ内の全 Post のリアクション集計を購読する。
   * listener には postId をキーにした Map で「現在ユーザー視点の集計」を流す
   * （userId を引数に取り、mine をユーザーごとに正しく解決する）。
   */
  subscribeToTripReactions(
    tripId: string,
    userId: string,
    listener: (byPost: Map<string, ReactionSummary>) => void,
  ): Unsubscribe;

  /**
   * リアクションをトグルする。
   * - 未押下 → 押す / 同絵文字 → 解除 / 別絵文字 → 付け替え（旧 -1, 新 +1）。
   * 戻り値は更新後の当該 Post の集計（呼び出し側が即時利用したい場合用）。
   */
  toggleReaction(input: ToggleReactionInput): Promise<ReactionSummary>;
}

/**
 * オフライン送信キュー（第4の Repository）。
 *
 * 撮影と昇格(promotePhoto)を分離する。enqueue は即 pending ジョブを返して撮影フローを
 * ブロックせず、注入されたプロセッサが pending を1件ずつ promotePhoto で確定する。
 * 各 mutation で AsyncStorage（注入された KeyValueStore）へ永続化し、tripId 単位で emit する。
 */
export interface UploadQueue {
  /** ジョブを積み、即 pending ジョブを返す（撮影フローをブロックしない）。永続化と emit も行う。 */
  enqueue(input: PromotePhotoInput): Promise<UploadJob>;
  /** トリップ単位で未確定ジョブ一覧を購読する（登録直後に現在値を即時通知）。 */
  subscribe(tripId: string, listener: (jobs: UploadJob[]) => void): Unsubscribe;
  /** failed ジョブを pending に戻して再処理を促す。 */
  retry(jobId: string): Promise<void>;
  /** ジョブをキューから除去する（ユーザー取消 / 成功後の内部除去）。 */
  remove(jobId: string): Promise<void>;
  /**
   * 永続化からの復元と処理ループを開始する（冪等）。
   * Provider の useEffect で1回だけ呼ぶ。テストは明示的に await して制御する。
   */
  start(): Promise<void>;
}

/** 画面へ注入する Repository の束。 */
export type Repositories = {
  auth: AuthService;
  trips: TripRepository;
  posts: PostRepository;
  uploadQueue: UploadQueue;
  imageProcessor: ImageProcessor;
};
