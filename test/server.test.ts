import test from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../src/server.ts";
import type { Judge, JudgeResult } from "../src/types.ts";

class StubJudge implements Judge {
  readonly kind = "stub";

  async ask(_state: unknown, questions: Record<string, unknown>): Promise<JudgeResult> {
    const probabilities: Record<string, number> = {};
    let index = 0;
    for (const id of Object.keys(questions)) probabilities[id] = index++ === 0 ? 0.9 : 0.2;
    return {
      probabilities,
      usage: { inputTokens: 42, outputTokens: 0 },
      latencyMs: 7,
      model: "stub",
    };
  }
}

const json = (body: unknown) => ({
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

/* eslint-disable @typescript-eslint/no-explicit-any -- test fixtures are dynamic JSON */
async function readJson(response: Response): Promise<any> {
  return response.json();
}

test("seeds the starter set by default", async () => {
  const server = await startServer({ judge: new StubJudge(), port: 0 });
  try {
    const state = await readJson(await fetch(`${server.url}/api/state`));
    assert.equal(state.mode, "stub");
    assert.equal(state.subscriptions.length, 6);
    assert.ok(state.subscriptions[0].question);
  } finally {
    await server.close();
  }
});

test("subscribe, publish, patch and remove over the API", async () => {
  const server = await startServer({ judge: new StubJudge(), port: 0, seedDemo: false });
  try {
    const created = await readJson(
      await fetch(`${server.url}/api/subscriptions`, {
        method: "POST",
        ...json({ description: "alpha things" }),
      }),
    );
    assert.equal(created.id, "sub_1");

    const published = await readJson(
      await fetch(`${server.url}/api/messages`, {
        method: "POST",
        ...json({ text: "hello", source: "test" }),
      }),
    );
    assert.equal(published.matches.length, 1);
    assert.equal(published.matches[0].verdict, "deliver");
    assert.equal(published.usage.inputTokens, 42);
    assert.ok(published.costUsd > 0);
    assert.equal(published.message.source, "test");

    const patched = await fetch(`${server.url}/api/subscriptions/sub_1`, {
      method: "PATCH",
      ...json({ deliverAbove: 0.95 }),
    });
    assert.equal(patched.status, 200);
    const afterPatch = await readJson(await fetch(`${server.url}/api/state`));
    assert.equal(afterPatch.subscriptions[0].deliverAbove, 0.95);

    const removed = await fetch(`${server.url}/api/subscriptions/sub_1`, { method: "DELETE" });
    assert.equal(removed.status, 204);
    const state = await readJson(await fetch(`${server.url}/api/state`));
    assert.equal(state.subscriptions.length, 0);
  } finally {
    await server.close();
  }
});

test("serves the page and rejects bad input", async () => {
  const server = await startServer({ judge: new StubJudge(), port: 0, seedDemo: false });
  try {
    const page = await fetch(`${server.url}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /subtext/);

    const bad = await fetch(`${server.url}/api/messages`, { method: "POST", ...json({}) });
    assert.equal(bad.status, 400);

    const traversal = await fetch(`${server.url}/%2e%2e/package.json`);
    assert.equal(traversal.status, 404);
  } finally {
    await server.close();
  }
});
