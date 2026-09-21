export type TaskStatus =
  | "open"
  | "claimed"
  | "paid"
  | "rejected"
  | "cancelled"
  /**
   * The task's own deadline passed with nobody holding it, and the reward and
   * the fee went back to the poster. Terminal, like paid and cancelled.
   *
   * Unlike cancelled, anyone can bring a task here, which is the point of it. A
   * poster who funded a task and never came back used to leave the money in the
   * contract for good and an undoable job on the map beside it.
   */
  | "expired";

export type Task = {
  id: number;
  title: string;
  place: string;
  /** The standard, in plain language, frozen before anyone spends time. */
  acceptanceTest: string;
  examplePass: string;
  exampleFail: string;
  /** Whole GEN. */
  reward: number;
  /** How long a claim lasts on this task, in minutes. Chosen by the poster. */
  claimMinutes: number;
  status: TaskStatus;
  /** Unix ms. */
  expiresAt: number;
  /**
   * When the task closes to new claims, in unix ms, or 0 for a task the poster
   * gave no deadline.
   *
   * Zero, not undefined, so that every read is a number comparison and a
   * missing field cannot become NaN - NaN loses every comparison it is in, so a
   * past-deadline task would silently read as still open. It mirrors the
   * contract's empty string sentinel, which carries exactly the same danger in
   * the other direction.
   */
  openUntil: number;
  poster: string;
  /**
   * The claimant's full address, not a shortened one. The task page has to be
   * able to answer "is this claim mine?" for whoever is looking at it, and a
   * truncated address cannot be compared.
   */
  claimedBy?: string;
  challengeCode?: string;
  /**
   * A code the poster published with the task, readable before anyone claims.
   * Empty for the normal one, which is issued at claim time and cannot be known
   * in advance. Set means the task is a test rig, and the site says so.
   */
  fixedCode?: string;
  reason?: string;
  beforeUrl?: string;
  afterUrl?: string;
  contentHash?: string;
  /** Recorded so two photographs can be compared. Never decides a verdict. */
  phash?: string;
  /**
   * When the graders reached a verdict, from the contract.
   *
   * There is deliberately no `agreement` count here. How many validators agreed
   * is consensus metadata on the transaction, not something the contract can
   * see from inside itself, so the receipt cannot honestly print it. It used to
   * be in this type, never populated, behind a condition that therefore never
   * rendered - a promise the page could not keep.
   */
  /** Present only once a submission has actually been graded on chain. */
  verdict?: {
    codeVisible: boolean;
    samePlace: boolean;
    testPassed: boolean;
  };
  /** Unix ms of the grading, from the contract. */
  gradedAt?: number;
};

