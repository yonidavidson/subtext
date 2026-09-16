# subtext

**Pub/sub where subscriptions are written in English.**

`subtext` is a message bus that routes by meaning. Instead of subscribing to topics or
keywords, you write down what you care about as a plain-language sentence, and the bus
decides — for every message — whether it belongs to you.

```ts
bus.subscribe({ description: "Anything about my data being sold, shared, or used to train AI models" });
bus.subscribe({ description: "Production incidents for services I depend on" });

await bus.publish({
  text: "Privacy policy update: we may sell aggregated data to advertising partners and use it to train our models.",
});

// privacy   p=0.97  deliver
// incident  p=0.02  drop
```

Topics and keyword rules are brittle: they match words, not intent. A semantic predicate
used to require a person in the routing path, or an LLM prompt-and-parse step. `subtext`
uses [TypeSafe](https://typesafe.ai)'s System One model (Jev) to answer one **Noul**
(yes/no with a calibrated probability) per subscription, then routes in code with
thresholds you own. One request per message, every subscription judged in parallel,
typically a few hundred milliseconds for the whole fan-out.

A local experiment. No deploy, no service.

## Try it: the web demo

Needs Node 22.18+ — no build step, no database, nothing to run besides this process.

```sh
npm install
npm run web          # open http://127.0.0.1:8787
```

The page is three steps:

1. **What do you care about?** — starter subscriptions are already loaded (privacy,
   incidents, deadlines, hiring, mentions, security). Add your own in plain English.
2. **Send a message** — type one, or tap a sample. Each want answers with a face:
   😄 yes, 🤔 maybe, 😴 no.
3. **Who got it?** — the routing in plain words, plus **Share**: one tap turns the result
   into a picture and opens your phone's share sheet (WhatsApp, X, anywhere), or saves the
   PNG.

Everything technical — subscription ids, thresholds, the exact question sent to the model,
token usage, recent messages — lives in the collapsed **For grown-ups** box. Picking
🙅 picky / 👍 normal / 🤝 easy there re-routes the last message instantly: same
probabilities, new policy, no model call.

No API key? It runs with a built-in lexical mock judge so you can still play. With a key
(from https://console.typesafe.ai/settings/keys), judgments are real:

```sh
echo 'TYPESAFE_API_KEY=...' > .env
npm run web          # the page now shows the real-robot badge
```

> The server keeps the API key out of the browser and spends it on behalf of anyone who
> can reach it. Keep the demo on localhost (the default) unless you mean that.

## How routing works

```
publish({ text, source })
  │
  ├─ one TypeSafe request per message
  │    state:     { message: { text, source } }
  │    questions: one Noul per subscription
  │               "Does `message.text` match this subscription: ...?"
  │
  ├─ every subscription gets a probability, evaluated in parallel
  │
  └─ code routes on thresholds you own
       p >= deliverAbove   → deliver   (a subscriber callback)
       p >= reviewAbove    → review    (human / agent looks)
       otherwise           → drop      (recorded, visible in the results)
```

- **One request per message** carries every subscription. Six subscriptions cost about the
  same latency as one; only tokens grow. This is TypeSafe's *speculative fan-out* pattern.
- **Subscriptions can carry examples and counter-examples** (`examples`, `not`), sent as
  structured criteria to sharpen the boundary.
- **Thresholds are policy, not model.** Changing them never requires a new judgment — the
  web demo lets you drag them and watch the same result re-route.

## CLI and scripted demo (also in the box)

```sh
npm run demo          # 6 subscriptions x 9 messages, prints the routing table
npm run cli           # interactive REPL: type messages, /sub <english>, /stats
npm run demo:live     # real judgments (reads TYPESAFE_API_KEY or .env)
npm run cli:live
```

## Library

```ts
import { LiveJudge, SemanticBus } from "./src/index.ts";

const bus = new SemanticBus({ judge: new LiveJudge() });

bus.subscribe({
  description: "Anything about my data being sold, shared, or used to train AI models",
  examples: ["we may share your data with our advertising partners"],
  not: ["how we keep your data secure"],
  deliverAbove: 0.7,
  reviewAbove: 0.4,
  onDeliver: (message, match) =>
    notify(match.subscriptionId, message.text, match.probability),
  onReview: (message, match) => queueForReview(message, match),
});

bus.update("privacy", { deliverAbove: 0.8 }); // change policy, keep counters

const matches = await bus.publish({ text: "...", source: "privacy-watch" });
```

`publish` resolves with one `Match` per subscription — `{ subscriptionId, probability,
verdict }` — so a caller can act on the full routing table, not only the deliveries.
`bus.on("published", ...)` exposes usage and latency; `bus.summary()` totals cost.

## HTTP API (what the web page uses)

| Endpoint | What it does |
| --- | --- |
| `GET /api/state` | subscriptions (with counters and their question JSON), totals, mode |
| `POST /api/subscriptions` | `{ description, examples?, not?, deliverAbove?, reviewAbove? }` |
| `PATCH /api/subscriptions/:id` | change thresholds without losing counters |
| `DELETE /api/subscriptions/:id` | remove a subscription |
| `POST /api/messages` | `{ text, source? }` → matches, probabilities, verdicts, usage |
| `POST /api/demo` | `{ reset: true }` → back to the starter set |
| `GET /api/events` | Server-sent events: `published`, `state` |

## Design notes

- **Noul, not Choice.** Each subscription is an independent yes/no. A Choice over
  subscriptions would force a winner even when nothing matches; independent Nouls give
  every subscriber a probability, and "none of them" is just all-low.
- **Cost.** Input tokens are what you pay for ($0.042 / 1M for `jev-latest`, no output
  cost). A demo message with six subscriptions is a few thousand tokens — well under a
  cent; the demo's full run of nine messages and 54 judgments costs about $0.0004.
- **Validate thresholds on your data.** Probabilities are calibrated in groups, not
  guaranteed per message. Start conservative, log probabilities, tune against real traffic.

## Limitations and roadmap

- Subscriptions and message share one request's token budget (~32k tokens); chunk the
  subscription list if it grows past that.
- `publish` is serialized per bus instance; a busy stream would partition by key.
- The `review` tier is just a callback — bring your own queue.
- Roadmap: persistence, sources (RSS/GitHub/Slack), per-subscription probability history,
  auth for the web demo if it ever leaves localhost.

## License

MIT
