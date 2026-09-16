import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { SemanticBus } from "./bus.ts";
import { DEMO_MESSAGES, DEMO_SUBSCRIPTIONS } from "./demo-data.ts";
import { LiveJudge, MockJudge } from "./judge.ts";
import { subscriptionQuestion } from "./questions.ts";
import type { Judge, PublishedEvent, Subscription } from "./types.ts";

const DEFAULT_PORT = 8787;
const DEFAULT_HOST = "127.0.0.1";
const INPUT_PRICE_PER_MTOKENS = 0.042;
const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

export interface ServerOptions {
  judge: Judge;
  port?: number;
  host?: string;
  webRoot?: string;
  /** Load the demo subscriptions at startup. Default true. */
  seedDemo?: boolean;
}

export interface RunningServer {
  url: string;
  port: number;
  close: () => Promise<void>;
}

/** Starts the subtext web demo. Returns the bound URL and a close function. */
export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const webRoot = resolve(options.webRoot ?? fileURLToPath(new URL("../web", import.meta.url)));
  const host = options.host ?? DEFAULT_HOST;
  const bus = new SemanticBus({ judge: options.judge });
  const events = new Map<string, PublishedEvent>();
  const clients = new Set<ServerResponse>();

  if (options.seedDemo !== false) {
    for (const sub of DEMO_SUBSCRIPTIONS) bus.subscribe({ ...sub });
  }

  function publication(event: PublishedEvent): Record<string, unknown> {
    return {
      id: event.message.id,
      message: event.message,
      matches: event.matches,
      usage: event.usage,
      latencyMs: event.latencyMs,
      model: event.model,
      costUsd: (event.usage.inputTokens / 1e6) * INPUT_PRICE_PER_MTOKENS,
    };
  }

  function broadcast(type: string, payload: unknown): void {
    const frame = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const client of clients) client.write(frame);
  }

  bus.on("published", (event: PublishedEvent) => {
    events.set(event.message.id, event);
    if (events.size > 100) {
      const oldest = events.keys().next().value;
      if (oldest) events.delete(oldest);
    }
    broadcast("published", publication(event));
  });

  const server = createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      sendJson(response, 500, { error: (error as Error).message });
    });
  });

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
      return;
    }
    await serveStatic(response, url.pathname);
  }

  function state(): Record<string, unknown> {
    const summary = bus.summary();
    const counters = new Map(summary.subscriptions.map((entry) => [entry.id, entry]));
    return {
      mode: options.judge.kind,
      model: options.judge.kind === "live" ? "jev-latest" : "mock-lexical",
      subscriptions: bus.subscriptions.map((sub: Subscription) => ({
        id: sub.id,
        description: sub.description,
        deliverAbove: sub.deliverAbove,
        reviewAbove: sub.reviewAbove,
        examples: sub.examples ?? [],
        not: sub.not ?? [],
        counters: counters.get(sub.id) ?? { deliver: 0, review: 0, drop: 0 },
        question: subscriptionQuestion(sub),
      })),
      summary,
    };
  }

  async function handleApi(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
  ): Promise<void> {
    const method = request.method ?? "GET";
    const path = url.pathname;

    if (method === "GET" && path === "/api/state") {
      sendJson(response, 200, state());
      return;
    }

    if (method === "GET" && path === "/api/samples") {
      sendJson(response, 200, { messages: DEMO_MESSAGES });
      return;
    }

    if (method === "GET" && path === "/api/events") {
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      response.write(": connected\n\n");
      clients.add(response);
      const keepAlive = setInterval(() => response.write(": ping\n\n"), 25_000);
      request.on("close", () => {
        clearInterval(keepAlive);
        clients.delete(response);
      });
      return;
    }

    if (method === "POST" && path === "/api/subscriptions") {
      const body = await readJson<Record<string, unknown>>(request);
      if (typeof body.description !== "string" || !body.description.trim()) {
        sendJson(response, 400, { error: "description is required" });
        return;
      }
      try {
        const sub = bus.subscribe({
          description: body.description.trim(),
          deliverAbove: numberOr(body.deliverAbove, undefined),
          reviewAbove: numberOr(body.reviewAbove, undefined),
          examples: stringList(body.examples),
          not: stringList(body.not),
        });
        broadcast("state", {});
        sendJson(response, 201, { id: sub.id, description: sub.description });
      } catch (error) {
        sendJson(response, 400, { error: (error as Error).message });
      }
      return;
    }

    if (method === "DELETE" && path.startsWith("/api/subscriptions/")) {
      const id = decodeURIComponent(path.slice("/api/subscriptions/".length));
      if (!bus.unsubscribe(id)) {
        sendJson(response, 404, { error: `no subscription ${id}` });
        return;
      }
      broadcast("state", {});
      sendJson(response, 204, null);
      return;
    }

    if (method === "PATCH" && path.startsWith("/api/subscriptions/")) {
      const id = decodeURIComponent(path.slice("/api/subscriptions/".length));
      const body = await readJson<Record<string, unknown>>(request);
      try {
        bus.update(id, {
          deliverAbove: numberOr(body.deliverAbove, undefined),
          reviewAbove: numberOr(body.reviewAbove, undefined),
          examples: stringList(body.examples),
          not: stringList(body.not),
        });
        broadcast("state", {});
        sendJson(response, 200, { ok: true });
      } catch (error) {
        sendJson(response, 400, { error: (error as Error).message });
      }
      return;
    }

    if (method === "POST" && path === "/api/demo") {
      const body = await readJson<{ reset?: unknown }>(request).catch(() => ({}) as { reset?: unknown });
      if (body.reset === true) {
        for (const existing of bus.subscriptions) bus.unsubscribe(existing.id);
      }
      let added = 0;
      for (const sub of DEMO_SUBSCRIPTIONS) {
        if (bus.subscriptions.some((existing) => existing.id === sub.id)) continue;
        bus.subscribe({ ...sub });
        added++;
      }
      broadcast("state", {});
      sendJson(response, 201, { added });
      return;
    }

    if (method === "POST" && path === "/api/messages") {
      const body = await readJson<Record<string, unknown>>(request);
      if (typeof body.text !== "string" || !body.text.trim()) {
        sendJson(response, 400, { error: "text is required" });
        return;
      }
      const id = randomUUID();
      const source =
        typeof body.source === "string" && body.source.trim() ? body.source.trim() : undefined;
      try {
        await bus.publish({ id, text: body.text, source });
      } catch (error) {
        sendJson(response, 502, { error: (error as Error).message });
        return;
      }
      const event = events.get(id);
      sendJson(
        response,
        200,
        event
          ? publication(event)
          : { id, matches: [], usage: { inputTokens: 0, outputTokens: 0 }, latencyMs: 0, model: options.judge.kind, costUsd: 0 },
      );
      return;
    }

    sendJson(response, 404, { error: "not found" });
  }

  async function serveStatic(response: ServerResponse, pathname: string): Promise<void> {
    const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const filePath = resolve(webRoot, relative);
    if (filePath !== webRoot && !filePath.startsWith(webRoot + sep)) {
      sendJson(response, 404, { error: "not found" });
      return;
    }
    let data: Buffer;
    try {
      data = await readFile(filePath);
    } catch {
      sendJson(response, 404, { error: "not found" });
      return;
    }
    response.writeHead(200, {
      "content-type": CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    response.end(data);
  }

  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? DEFAULT_PORT, host, () => resolvePromise());
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : (options.port ?? DEFAULT_PORT);

  return {
    url: `http://${host}:${port}`,
    port,
    close: () =>
      new Promise<void>((resolvePromise) => {
        for (const client of clients) client.end();
        clients.clear();
        server.close(() => resolvePromise());
      }),
  };
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  if (response.writableEnded) return;
  if (status === 204 || payload === null) {
    response.writeHead(status);
    response.end();
    return;
  }
  const body = JSON.stringify(payload);
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(body);
}

async function readJson<T>(request: IncomingMessage, limit = 65_536): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > limit) throw new Error("request body too large");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {} as T;
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

function numberOr(value: unknown, fallback: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list = value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "");
  return list.length ? list : undefined;
}

const isDirectRun =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  void (async () => {
    const host = flagValue("--host") ?? DEFAULT_HOST;
    const portFlag = flagValue("--port");
    const enabled = Boolean(process.env.TYPESAFE_API_KEY) && !process.argv.includes("--mock");
    const judge: Judge = enabled ? new LiveJudge() : new MockJudge();
    const running = await startServer({
      judge,
      host,
      port: portFlag ? Number(portFlag) : undefined,
    });
    console.log(`subtext web on ${running.url}`);
    console.log(
      enabled
        ? "judge: live (TYPESAFE_API_KEY found)"
        : "judge: mock (no TYPESAFE_API_KEY — set one for real judgments)",
    );
  })();
}

function flagValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
