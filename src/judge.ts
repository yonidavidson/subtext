import { TypeSafeClient } from "@typesafe-ai/sdk";
import type { EntryType, Questions } from "@typesafe-ai/sdk";
import type { Judge, JudgeResult } from "./types.ts";

export interface LiveJudgeOptions {
  /** Falls back to TYPESAFE_API_KEY. */
  apiKey?: string;
  /** Falls back to the SDK default (jev-latest). */
  model?: string;
}

/**
 * The real judge: one TypeSafe request per publication, with a Noul per
 * subscription. The SDK retries 429/529 responses with backoff.
 */
export class LiveJudge implements Judge {
  readonly kind = "live";
  readonly #client: TypeSafeClient;
  readonly #model: string | undefined;

  constructor(options: LiveJudgeOptions = {}) {
    this.#client = new TypeSafeClient(options.apiKey ? { apiKey: options.apiKey } : {});
    this.#model = options.model;
  }

  async ask(state: unknown, questions: Record<string, unknown>): Promise<JudgeResult> {
    const started = performance.now();
    const response = await this.#client.systemOne({
      state: state as EntryType,
      questions: questions as Questions,
      ...(this.#model ? { model: this.#model } : {}),
    });

    const probabilities: Record<string, number> = {};
    for (const [id, answer] of Object.entries(response.answers)) {
      const noul = (answer as { noul?: number }).noul;
      if (typeof noul === "number") probabilities[id] = noul;
    }

    return {
      probabilities,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
      latencyMs: performance.now() - started,
      model: response.model,
    };
  }
}

const STOPWORDS = new Set([
  "a", "a's", "about", "above", "after", "again", "against", "all", "also", "am", "an",
  "and", "any", "anything", "are", "as", "at", "be", "because", "been", "before",
  "being", "below", "between", "both", "but", "by", "can", "come", "coming", "could",
  "did", "do", "does", "doing", "done", "during", "each", "few", "for", "from",
  "further", "get", "got", "had", "has", "have", "having", "he", "her", "here", "hers",
  "him", "his", "how", "i", "if", "in", "into", "is", "it", "its", "just", "like",
  "made", "make", "may", "me", "might", "more", "most", "much", "must", "my", "new",
  "no", "not", "now", "of", "off", "on", "once", "one", "only", "or", "other", "our",
  "out", "over", "own", "same", "she", "should", "so", "some", "someone", "such",
  "than", "that", "the", "their", "them", "then", "there", "these", "they", "thing",
  "things", "this", "those", "through", "to", "too", "under", "until", "up", "us",
  "use", "used", "using", "very", "was", "we", "were", "what", "when", "where",
  "which", "while", "who", "why", "will", "with", "would", "you", "your",
]);

const SYNONYMS: Record<string, string> = {
  cve: "vulnerability",
  security: "vulnerability",
  sale: "sell",
  sales: "sell",
  sell: "sell",
  selling: "sell",
  sold: "sell",
  shared: "share",
  sharing: "share",
  trained: "train",
  training: "train",
  down: "outage",
  outages: "outage",
  promised: "promise",
  deadlines: "deadline",
  due: "deadline",
};

function stem(word: string): string {
  return word.replace(/(ing|ies|ied|ed|es|s)$/, (suffix) =>
    suffix === "ies" || suffix === "ied" ? "y" : "",
  );
}

/** Surface forms of a canonical word, so "share"/"sharing" and "model"/"models" meet. */
function variants(word: string): string[] {
  const base = stem(word);
  return base === word ? [word] : [word, base, `${base}e`];
}

function canonical(word: string): string {
  return SYNONYMS[word] ?? word;
}

function tokenize(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return words.filter((word) => word.length >= 2 && !STOPWORDS.has(word));
}

interface Units {
  forms: Set<string>;
  words: string[];
}

function units(text: string): Units {
  const forms = new Set<string>();
  const words = new Set<string>();
  for (const raw of tokenize(text)) {
    const word = canonical(raw);
    words.add(word);
    for (const form of variants(word)) forms.add(form);
  }
  return { forms, words: [...words] };
}

function coverage(subscription: string, message: string): number {
  const sub = units(subscription);
  const msg = units(message);
  if (sub.words.length === 0) return 0;
  let hits = 0;
  for (const word of sub.words) {
    if (variants(word).some((form) => msg.forms.has(form))) hits++;
  }
  return hits / sub.words.length;
}

/**
 * A lexical stand-in so the demo and tests run without an API key.
 * It scores word overlap, not meaning — it is not the product.
 */
export class MockJudge implements Judge {
  readonly kind = "mock";

  async ask(state: unknown, questions: Record<string, unknown>): Promise<JudgeResult> {
    const started = performance.now();
    const message = (state as { message?: { text?: string } })?.message?.text ?? "";

    const probabilities: Record<string, number> = {};
    let chars = JSON.stringify(state).length;
    for (const [id, question] of Object.entries(questions)) {
      chars += JSON.stringify(question).length;
      const description = descriptionFromQuestion(question);
      const value = description ? coverage(description, message) : 0;
      probabilities[id] = Math.min(0.97, Math.max(0.02, 0.05 + 0.9 * value ** 0.8));
    }

    return {
      probabilities,
      usage: { inputTokens: Math.ceil(chars / 4), outputTokens: 0 },
      latencyMs: performance.now() - started,
      model: "mock-lexical",
    };
  }
}

function descriptionFromQuestion(question: unknown): string | undefined {
  const instructions = (question as { instructions?: { question?: unknown } })?.instructions;
  const text = instructions?.question;
  if (typeof text !== "string") return undefined;
  const match = text.match(/subscription:\s*"([\s\S]*)"/);
  return match?.[1];
}
