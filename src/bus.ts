import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { stateFor, subscriptionQuestion } from "./questions.ts";
import type {
  BusMessage,
  BusSummary,
  Judge,
  Match,
  PublishInput,
  PublishedEvent,
  Subscription,
  SubscriptionChanges,
  SubscriptionInput,
  SubscriptionStats,
  Verdict,
} from "./types.ts";

export interface BusOptions {
  judge: Judge;
  /** USD per 1M input tokens, for the cost estimate. Default: 0.042 (TypeSafe jev, 2026-09). */
  inputPricePerMTokens?: number;
  /** USD per 1M output tokens. Default: 0. */
  outputPricePerMTokens?: number;
}

interface Counters {
  deliver: number;
  review: number;
  drop: number;
}

/**
 * A pub/sub bus whose subscriptions are natural-language predicates.
 *
 * Each publication is one TypeSafe request: the message as state, one Noul per
 * subscription. Probabilities are routed through per-subscription thresholds
 * (deliver / review / drop) in code.
 */
export class SemanticBus extends EventEmitter {
  readonly #judge: Judge;
  readonly #inputPrice: number;
  readonly #outputPrice: number;
  readonly #subs = new Map<string, Subscription>();
  readonly #counters = new Map<string, Counters>();
  #nextId = 1;
  #tail: Promise<void> = Promise.resolve();
  #totals = { publications: 0, judgments: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 };

  constructor(options: BusOptions) {
    super();
    this.#judge = options.judge;
    this.#inputPrice = options.inputPricePerMTokens ?? 0.042;
    this.#outputPrice = options.outputPricePerMTokens ?? 0;
  }

  subscribe(input: SubscriptionInput): Subscription {
    const deliverAbove = input.deliverAbove ?? 0.6;
    const reviewAbove = input.reviewAbove ?? 0.4;
    assertThresholds(reviewAbove, deliverAbove, `"${input.description}"`);
    const id = input.id ?? `sub_${this.#nextId++}`;
    if (this.#subs.has(id)) throw new Error(`subscription "${id}" already exists`);

    const subscription: Subscription = {
      id,
      description: input.description,
      deliverAbove,
      reviewAbove,
      onDeliver: input.onDeliver,
      onReview: input.onReview,
      examples: input.examples,
      not: input.not,
    };
    this.#subs.set(id, subscription);
    this.#counters.set(id, { deliver: 0, review: 0, drop: 0 });
    return subscription;
  }

  /** Change a subscription in place. Counters and callbacks are preserved. */
  update(id: string, changes: SubscriptionChanges): Subscription {
    const existing = this.#subs.get(id);
    if (!existing) throw new Error(`no subscription "${id}"`);

    const deliverAbove = changes.deliverAbove ?? existing.deliverAbove;
    const reviewAbove = changes.reviewAbove ?? existing.reviewAbove;
    assertThresholds(reviewAbove, deliverAbove, `"${id}"`);

    const next: Subscription = {
      ...existing,
      description: changes.description ?? existing.description,
      deliverAbove,
      reviewAbove,
      examples: changes.examples ?? existing.examples,
      not: changes.not ?? existing.not,
    };
    this.#subs.set(id, next);
    return next;
  }

  unsubscribe(id: string): boolean {
    this.#counters.delete(id);
    return this.#subs.delete(id);
  }

  get subscriptions(): Subscription[] {
    return [...this.#subs.values()];
  }

  /**
   * Publish a message. Publications are serialized: one message is judged at a
   * time, so results and stats stay ordered.
   */
  publish(input: PublishInput): Promise<Match[]> {
    const run = () => this.#judgeMessage(input);
    const result = this.#tail.then(run, run);
    this.#tail = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  summary(): BusSummary {
    const { publications, judgments, inputTokens, outputTokens, latencyMs } = this.#totals;
    const subscriptions: SubscriptionStats[] = this.subscriptions.map((sub) => {
      const counters = this.#counters.get(sub.id) ?? { deliver: 0, review: 0, drop: 0 };
      return { id: sub.id, description: sub.description, ...counters };
    });
    return {
      publications,
      judgments,
      inputTokens,
      outputTokens,
      costUsd:
        (inputTokens / 1e6) * this.#inputPrice + (outputTokens / 1e6) * this.#outputPrice,
      avgLatencyMs: publications ? latencyMs / publications : 0,
      subscriptions,
    };
  }

  async #judgeMessage(input: PublishInput): Promise<Match[]> {
    const message: BusMessage = {
      id: input.id ?? randomUUID(),
      text: input.text,
      source: input.source,
      data: input.data,
      at: Date.now(),
    };

    const subs = this.subscriptions;
    if (subs.length === 0) {
      this.#totals.publications++;
      this.emit("published", {
        message,
        matches: [],
        usage: { inputTokens: 0, outputTokens: 0 },
        latencyMs: 0,
        model: "none",
      } satisfies PublishedEvent);
      return [];
    }

    const questions: Record<string, unknown> = {};
    for (const sub of subs) questions[sub.id] = subscriptionQuestion(sub);

    const judged = await this.#judge.ask(stateFor(message), questions);

    const matches: Match[] = [];
    for (const sub of subs) {
      const probability = judged.probabilities[sub.id] ?? 0;
      const verdict: Verdict =
        probability >= sub.deliverAbove
          ? "deliver"
          : probability >= sub.reviewAbove
            ? "review"
            : "drop";
      const match: Match = {
        messageId: message.id,
        subscriptionId: sub.id,
        probability,
        verdict,
        at: message.at,
      };
      matches.push(match);

      const counters = this.#counters.get(sub.id);
      if (counters) counters[verdict]++;

      this.emit("match", message, match, sub);
      if (verdict === "deliver") this.#call(sub.onDeliver, message, match, sub.id);
      else if (verdict === "review") this.#call(sub.onReview, message, match, sub.id);
    }

    this.#totals.publications++;
    this.#totals.judgments += subs.length;
    this.#totals.inputTokens += judged.usage.inputTokens;
    this.#totals.outputTokens += judged.usage.outputTokens;
    this.#totals.latencyMs += judged.latencyMs;

    this.emit("published", {
      message,
      matches,
      usage: judged.usage,
      latencyMs: judged.latencyMs,
      model: judged.model,
    } satisfies PublishedEvent);

    return matches;
  }

  #call(
    fn: Subscription["onDeliver"],
    message: BusMessage,
    match: Match,
    subscriptionId: string,
  ): void {
    if (!fn) return;
    try {
      fn(message, match);
    } catch (error) {
      this.emit("error", error, { subscription: subscriptionId });
    }
  }
}

function assertThresholds(reviewAbove: number, deliverAbove: number, label: string): void {
  if (!(0 <= reviewAbove && reviewAbove < deliverAbove && deliverAbove <= 1)) {
    throw new Error(
      `invalid thresholds for ${label}: need 0 <= reviewAbove < deliverAbove <= 1`,
    );
  }
}
