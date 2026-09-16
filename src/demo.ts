import { SemanticBus } from "./bus.ts";
import { DEMO_MESSAGES, DEMO_SUBSCRIPTIONS } from "./demo-data.ts";
import { LiveJudge, MockJudge } from "./judge.ts";
import { stateFor, subscriptionQuestion } from "./questions.ts";
import type { BusMessage, Judge, Match, Subscription } from "./types.ts";

const useLive = process.argv.includes("--live");
const printRequest = process.argv.includes("--print-request");
const modelIndex = process.argv.indexOf("--model");
const model = modelIndex >= 0 ? process.argv[modelIndex + 1] : undefined;

const judge: Judge = useLive ? new LiveJudge(model ? { model } : {}) : new MockJudge();
const bus = new SemanticBus({ judge });
bus.on("error", (error: unknown) => console.error("bus error:", error));

let deliveries = 0;
let reviews = 0;

for (const sub of DEMO_SUBSCRIPTIONS) {
  bus.subscribe({
    ...sub,
    onDeliver: () => {
      deliveries++;
    },
    onReview: () => {
      reviews++;
    },
  });
}

console.log(
  `subtext demo — ${DEMO_SUBSCRIPTIONS.length} subscriptions, ${DEMO_MESSAGES.length} messages`,
);
console.log(
  useLive
    ? `judge: live${model ? ` (${model})` : ""}\n`
    : "judge: mock (lexical stand-in — set TYPESAFE_API_KEY and add --live for real judgments)\n",
);

if (printRequest) {
  const first = DEMO_MESSAGES[0];
  const questions: Record<string, unknown> = {};
  for (const sub of DEMO_SUBSCRIPTIONS) {
    questions[sub.id] = subscriptionQuestion(sub as Subscription);
  }
  console.log("the request for the first message looks like this:\n");
  console.log(JSON.stringify({ state: stateFor(first), questions }, null, 2));
  console.log();
}

for (const { source, text } of DEMO_MESSAGES) {
  const matches = await bus.publish({ source, text });
  printMessage({ id: "", text, source, at: 0 }, matches);
}

const summary = bus.summary();
console.log("summary");
console.log(`  publications   ${summary.publications}`);
console.log(
  `  judgments      ${summary.judgments} (${DEMO_SUBSCRIPTIONS.length} subscriptions x ${summary.publications} messages — one request per message)`,
);
console.log(
  `  tokens         ~${summary.inputTokens.toLocaleString("en-US")} in / ${summary.outputTokens} out${useLive ? "" : " (estimated)"}`,
);
console.log(`  est. cost      $${summary.costUsd.toFixed(6)} at $0.042 / 1M input tokens`);
console.log(`  callbacks      ${deliveries} delivered, ${reviews} sent to review`);
console.log(
  useLive
    ? `  latency        ${summary.avgLatencyMs.toFixed(0)} ms avg per message`
    : "  latency        ~0 ms (mock) — live judgments are typically 100–300 ms per message",
);
console.log();

function printMessage(message: BusMessage, matches: Match[]): void {
  const shown = matches.filter((match) => match.verdict !== "drop");
  const drops = matches.length - shown.length;
  console.log(`  [${message.source ?? "?"}] ${truncate(message.text, 92)}`);
  for (const match of shown) {
    const mark = match.verdict === "deliver" ? "✓" : "~";
    console.log(
      `      ${mark} ${match.subscriptionId.padEnd(9)} p=${match.probability.toFixed(2)}  ${match.verdict}`,
    );
  }
  console.log(
    shown.length
      ? `      · ${drops} below review threshold`
      : `      · nothing above review (${drops} subscriptions judged)`,
  );
}

function truncate(text: string, length: number): string {
  return text.length <= length ? text : `${text.slice(0, length - 1)}…`;
}
