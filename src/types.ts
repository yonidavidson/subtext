/** A message on the bus. Only `text` and `source` are sent to the model. */
export interface BusMessage {
  id: string;
  text: string;
  source?: string;
  /** Local-only metadata. Never sent to the model. */
  data?: unknown;
  at: number;
}

export interface PublishInput {
  text: string;
  source?: string;
  data?: unknown;
  /** Optional message id; generated when omitted. */
  id?: string;
}

export type Verdict = "deliver" | "review" | "drop";

export interface SubscriptionInput {
  /** The subscription written in plain English. This is the predicate the model judges. */
  description: string;
  /** Optional id; generated when omitted. */
  id?: string;
  /** Deliver when probability >= this. Default 0.6. */
  deliverAbove?: number;
  /** Review when probability >= this and < deliverAbove. Default 0.4. */
  reviewAbove?: number;
  /** Called for `deliver` verdicts. */
  onDeliver?: (message: BusMessage, match: Match) => void;
  /** Called for `review` verdicts. */
  onReview?: (message: BusMessage, match: Match) => void;
  /** Optional examples that belong to this subscription. Sent as criteria. */
  examples?: string[];
  /** Optional counter-examples that do not belong. Sent as criteria. */
  not?: string[];
}

export interface Subscription {
  id: string;
  description: string;
  deliverAbove: number;
  reviewAbove: number;
  onDeliver?: (message: BusMessage, match: Match) => void;
  onReview?: (message: BusMessage, match: Match) => void;
  examples?: string[];
  not?: string[];
}

/** Fields that can be changed after subscribing. Omitted fields stay as they are. */
export interface SubscriptionChanges {
  description?: string;
  deliverAbove?: number;
  reviewAbove?: number;
  examples?: string[];
  not?: string[];
}

export interface Match {
  messageId: string;
  subscriptionId: string;
  /** Probability (0-1) that the message matches the subscription. */
  probability: number;
  verdict: Verdict;
  at: number;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface PublishedEvent {
  message: BusMessage;
  matches: Match[];
  usage: Usage;
  latencyMs: number;
  model: string;
}

export interface SubscriptionStats {
  id: string;
  description: string;
  deliver: number;
  review: number;
  drop: number;
}

export interface BusSummary {
  publications: number;
  /** Questions judged across all publications (subscriptions x messages). */
  judgments: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  avgLatencyMs: number;
  subscriptions: SubscriptionStats[];
}

export interface JudgeResult {
  /** Probability of "yes" per question id. */
  probabilities: Record<string, number>;
  usage: Usage;
  latencyMs: number;
  model: string;
}

/** A judge answers a set of questions about a state. LiveJudge calls TypeSafe. */
export interface Judge {
  readonly kind: string;
  ask(state: unknown, questions: Record<string, unknown>): Promise<JudgeResult>;
}
