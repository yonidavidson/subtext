import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { SemanticBus } from "./bus.ts";
import { LiveJudge, MockJudge } from "./judge.ts";
import type { Usage } from "./types.ts";

const useLive = process.argv.includes("--live");
const bus = new SemanticBus({ judge: useLive ? new LiveJudge() : new MockJudge() });
bus.on("error", (error: unknown) => console.error("bus error:", error));

let last: { usage: Usage; latencyMs: number } = {
  usage: { inputTokens: 0, outputTokens: 0 },
  latencyMs: 0,
};
bus.on("published", (event: { usage: Usage; latencyMs: number }) => {
  last = { usage: event.usage, latencyMs: event.latencyMs };
});

const rl = createInterface({ input: stdin, output: stdout });

console.log(`subtext ${useLive ? "(live)" : "(mock — no API key needed)"}`);
console.log("Type a message to publish it. /help for commands.\n");

try {
  if (stdin.isTTY) await runInteractive();
  else await runPiped();
} finally {
  rl.close();
}

/** Streaming prompts for a human at a terminal. */
async function runInteractive(): Promise<void> {
  rl.setPrompt("> ");
  rl.prompt();
  for await (const raw of rl) {
    if (await handle(raw.trim())) break;
    rl.prompt();
  }
}

/** Piped/scripted input: read every line first, then process them in order. */
async function runPiped(): Promise<void> {
  const lines: string[] = [];
  for await (const raw of rl) lines.push(raw);
  for (const line of lines) {
    if (await handle(line.trim())) break;
  }
}

/** Returns true when the session should end. Works interactively and with piped input. */
async function handle(line: string): Promise<boolean> {
  if (!line) return false;
  if (line === "/quit" || line === "/exit") return true;
  if (line === "/help") {
    help();
    return false;
  }
  if (line === "/subs") {
    const subs = bus.subscriptions;
    if (subs.length === 0) console.log("no subscriptions yet — try /sub incident reports\n");
    for (const sub of subs) {
      console.log(
        `  ${sub.id.padEnd(9)} deliver>=${sub.deliverAbove} review>=${sub.reviewAbove}  ${sub.description}`,
      );
    }
    if (subs.length) console.log();
    return false;
  }
  if (line.startsWith("/sub ")) {
    const sub = bus.subscribe({
      description: line.slice("/sub ".length).trim(),
      deliverAbove: 0.55,
      reviewAbove: 0.35,
    });
    console.log(`subscribed ${sub.id}: ${sub.description}\n`);
    return false;
  }
  if (line.startsWith("/drop ")) {
    const id = line.slice("/drop ".length).trim();
    console.log(bus.unsubscribe(id) ? `dropped ${id}\n` : `no subscription ${id}\n`);
    return false;
  }
  if (line === "/stats") {
    const summary = bus.summary();
    console.log(
      `messages=${summary.publications} judgments=${summary.judgments} tokens~${summary.inputTokens} cost~$${summary.costUsd.toFixed(6)}\n`,
    );
    return false;
  }
  if (line.startsWith("/")) {
    console.log("unknown command — /help\n");
    return false;
  }
  if (bus.subscriptions.length === 0) {
    console.log("no subscriptions yet — add one with /sub <description>\n");
    return false;
  }

  let matches;
  try {
    matches = await bus.publish({ text: line, source: "cli" });
  } catch (error) {
    console.error(`publish failed: ${(error as Error).message}\n`);
    return false;
  }
  for (const match of matches) {
    const mark = match.verdict === "deliver" ? "✓" : match.verdict === "review" ? "~" : "·";
    console.log(
      `  ${mark} ${match.subscriptionId.padEnd(9)} p=${match.probability.toFixed(2)}  ${match.verdict}`,
    );
  }
  console.log(`  (${last.latencyMs.toFixed(0)} ms, ~${last.usage.inputTokens} input tokens)\n`);
  return false;
}

function help(): void {
  console.log("commands");
  console.log("  <text>            publish a message and show where it routes");
  console.log("  /sub <english>    add a subscription, e.g. /sub anything about pricing changes");
  console.log("  /subs             list subscriptions");
  console.log("  /drop <id>        remove a subscription");
  console.log("  /stats            totals");
  console.log("  /quit             exit\n");
}
