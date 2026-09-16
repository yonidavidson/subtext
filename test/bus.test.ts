import test from "node:test";
import assert from "node:assert/strict";
import { SemanticBus } from "../src/bus.ts";
import type { Judge, JudgeResult } from "../src/types.ts";

class StubJudge implements Judge {
  readonly kind = "stub";
  readonly calls: { state: unknown; questions: Record<string, unknown> }[] = [];
  active = 0;
  maxActive = 0;
  #script: number[][];

  constructor(script: number[][] = []) {
    this.#script = script;
  }

  async ask(state: unknown, questions: Record<string, unknown>): Promise<JudgeResult> {
    this.active++;
    this.maxActive = Math.max(this.maxActive, this.active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    this.active--;
    this.calls.push({ state, questions });

    const values = this.#script.shift() ?? [];
    const probabilities: Record<string, number> = {};
    Object.keys(questions).forEach((id, index) => {
      probabilities[id] = values[index] ?? 0;
    });
    return {
      probabilities,
      usage: { inputTokens: 10, outputTokens: 0 },
      latencyMs: 1,
      model: "stub",
    };
  }
}

test("routes with per-subscription thresholds and fires callbacks", async () => {
  const judge = new StubJudge([[0.9, 0.5, 0.1]]);
  const bus = new SemanticBus({ judge });
  const seen: string[] = [];
  bus.subscribe({ id: "a", description: "alpha", onDeliver: () => seen.push("a:deliver") });
  bus.subscribe({ id: "b", description: "beta", onReview: () => seen.push("b:review") });
  bus.subscribe({ id: "c", description: "gamma" });

  const matches = await bus.publish({ text: "hello" });

  assert.deepEqual(
    matches.map((match) => match.verdict),
    ["deliver", "review", "drop"],
  );
  assert.deepEqual(seen, ["a:deliver", "b:review"]);

  const summary = bus.summary();
  assert.equal(summary.publications, 1);
  assert.equal(summary.judgments, 3);
  assert.equal(summary.inputTokens, 10);
  assert.equal(summary.subscriptions.find((sub) => sub.id === "a")?.deliver, 1);
  assert.equal(summary.subscriptions.find((sub) => sub.id === "b")?.review, 1);
});

test("builds exactly one Noul per subscription, with the description in the question", async () => {
  const judge = new StubJudge([[0.1, 0.1]]);
  const bus = new SemanticBus({ judge });
  bus.subscribe({ description: "alpha things" });
  bus.subscribe({ id: "beta", description: "beta things" });

  await bus.publish({ text: "hello" });

  const questions = judge.calls[0]?.questions ?? {};
  assert.deepEqual(Object.keys(questions), ["sub_1", "beta"]);

  const question = questions.sub_1 as {
    type: string;
    instructions: { question: string };
    criteria: { true: unknown; false: unknown };
  };
  assert.equal(question.type, "noul");
  assert.match(question.instructions.question, /alpha things/);
  assert.ok(question.criteria.true);
  assert.ok(question.criteria.false);
});

test("state carries text and source but not local data", async () => {
  const judge = new StubJudge([[0.1]]);
  const bus = new SemanticBus({ judge });
  bus.subscribe({ description: "alpha" });

  await bus.publish({ text: "hello", source: "inbox", data: { secret: true } });

  assert.deepEqual(judge.calls[0]?.state, {
    message: { text: "hello", source: "inbox" },
  });
});

test("does not call the judge when there are no subscriptions", async () => {
  const judge = new StubJudge();
  const bus = new SemanticBus({ judge });

  const matches = await bus.publish({ text: "hello" });

  assert.deepEqual(matches, []);
  assert.equal(judge.calls.length, 0);
  assert.equal(bus.summary().publications, 1);
});

test("serializes publications", async () => {
  const judge = new StubJudge([[0.9], [0.9]]);
  const bus = new SemanticBus({ judge });
  bus.subscribe({ description: "alpha" });

  await Promise.all([bus.publish({ text: "one" }), bus.publish({ text: "two" })]);

  assert.equal(judge.maxActive, 1);
  assert.equal(judge.calls.length, 2);
});

test("recovers after a judge failure", async () => {
  let fail = true;
  const judge: Judge = {
    kind: "flaky",
    async ask(_state, questions) {
      if (fail) {
        fail = false;
        throw new Error("boom");
      }
      const probabilities: Record<string, number> = {};
      for (const id of Object.keys(questions)) probabilities[id] = 0.9;
      return { probabilities, usage: { inputTokens: 1, outputTokens: 0 }, latencyMs: 1, model: "flaky" };
    },
  };
  const bus = new SemanticBus({ judge });
  bus.subscribe({ description: "alpha" });

  await assert.rejects(() => bus.publish({ text: "one" }), /boom/);
  const matches = await bus.publish({ text: "two" });
  assert.equal(matches[0]?.verdict, "deliver");
});

test("updates thresholds without losing counters", async () => {
  const judge = new StubJudge([[0.5], [0.5]]);
  const bus = new SemanticBus({ judge });
  bus.subscribe({ id: "a", description: "alpha" });

  const first = await bus.publish({ text: "x" });
  assert.equal(first[0]?.verdict, "review");

  bus.update("a", { deliverAbove: 0.5 });
  const second = await bus.publish({ text: "x" });
  assert.equal(second[0]?.verdict, "deliver");

  const stats = bus.summary().subscriptions.find((entry) => entry.id === "a");
  assert.equal(stats?.review, 1);
  assert.equal(stats?.deliver, 1);

  assert.throws(() => bus.update("missing", { deliverAbove: 0.9 }));
  assert.throws(() => bus.update("a", { reviewAbove: 0.9 }));
});

test("rejects bad thresholds and duplicate ids", () => {
  const bus = new SemanticBus({ judge: new StubJudge() });
  assert.throws(() => bus.subscribe({ description: "x", reviewAbove: 0.8, deliverAbove: 0.5 }));
  bus.subscribe({ id: "dup", description: "x" });
  assert.throws(() => bus.subscribe({ id: "dup", description: "y" }));
});
