/* subtext — keep it simple. */

const els = {
  mode: document.querySelector("#mode"),
  practice: document.querySelector("#practice"),
  wants: document.querySelector("#wants"),
  wantInput: document.querySelector("#want-input"),
  wantAdd: document.querySelector("#want-add"),
  wantError: document.querySelector("#want-error"),
  reset: document.querySelector("#reset"),
  msgText: document.querySelector("#msg-text"),
  send: document.querySelector("#send"),
  msgError: document.querySelector("#msg-error"),
  samples: document.querySelector("#samples"),
  result: document.querySelector("#result"),
  share: document.querySelector("#share"),
  stats: document.querySelector("#stats"),
  grownWants: document.querySelector("#grown-wants"),
  history: document.querySelector("#history"),
};

const EMOJI_BY_ID = {
  privacy: "🔒",
  incident: "🚨",
  promises: "⏰",
  hiring: "💼",
  mentions: "📣",
  security: "🛠️",
};

const PICKINESS = {
  picky: { label: "🙅 picky", deliverAbove: 0.8, reviewAbove: 0.5 },
  normal: { label: "👍 normal", deliverAbove: 0.6, reviewAbove: 0.4 },
  easy: { label: "🤝 easy", deliverAbove: 0.35, reviewAbove: 0.2 },
};

const LOOKS = {
  idle: { face: "🙂", text: "Waiting for a message…" },
  deliver: { face: "😄", text: "Yes! I want this!" },
  review: { face: "🤔", text: "Hmm… maybe. Ask a person." },
  drop: { face: "😴", text: "No, not for me." },
};

const REPO_URL = "github.com/yonidavidson/subtext";

const SAMPLE_LABELS = {
  "deps-bot": "🛠️ A security fix",
  newsletter: "🧾 A privacy update",
  "status-page": "🚨 The server is down",
  noa: "⏰ You promised something",
  "jobs-digest": "💼 A new job",
  "go-weekly": "📣 Someone mentioned you",
  vendor: "📦 A vendor policy",
  ops: "🔧 Weekend maintenance",
  feed: "🍞 A sourdough recipe",
};
const SHOWN_SAMPLES = ["status-page", "newsletter", "noa", "feed"];

let app = { mode: "live", model: "", subscriptions: [], summary: null };
let last = null;
const history = [];

/* ---- api ---- */

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...options,
  });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? response.statusText);
  return data;
}

async function refresh() {
  app = await api("/api/state");
  renderMode();
  renderWants();
  renderGrown();
  if (last) paintFaces(last.matches);
}

/* ---- header ---- */

function renderMode() {
  const live = app.mode === "live";
  els.mode.textContent = live ? "🤖 real robot" : "🧪 practice robot";
  els.mode.className = `badge ${live ? "live" : "mock"}`;
  els.practice.hidden = live;
}

/* ---- wants (the simple cards) ---- */

function renderWants() {
  els.wants.replaceChildren();
  if (!app.subscriptions.length) {
    els.wants.append(
      el("p", { class: "muted", text: "Nothing yet. Add something you care about, or reset." }),
    );
    return;
  }
  for (const sub of app.subscriptions) {
    const card = el("div", { class: "want", "data-id": sub.id });
    card.append(el("div", { class: "face", text: LOOKS.idle.face }));
    const body = el("div", { class: "body" });
    body.append(el("p", { class: "text", dir: "auto", text: `${emojiFor(sub)} ${sub.description}` }));
    const meter = el("div", { class: "meter" });
    meter.append(el("i"));
    body.append(meter);
    body.append(el("div", { class: "state", text: LOOKS.idle.text }));
    card.append(body);
    const remove = el("button", { class: "remove", type: "button", text: "✕", title: "forget this" });
    remove.addEventListener("click", () => removeWant(sub.id));
    card.append(remove);
    els.wants.append(card);
  }
}

function emojiFor(sub) {
  if (EMOJI_BY_ID[sub.id]) return EMOJI_BY_ID[sub.id];
  const match = sub.description.match(/^(\p{Extended_Pictographic})/u);
  return match ? match[1] : "✨";
}

function paintFaces(matches) {
  for (const match of matches) {
    const card = els.wants.querySelector(`.want[data-id="${cssEscape(match.subscriptionId)}"]`);
    if (!card) continue;
    const verdict = verdictFor(match);
    const look = LOOKS[verdict];
    card.querySelector(".face").textContent = look.face;
    card.querySelector(".state").textContent = `${look.text} (${Math.round(match.probability * 100)}%)`;
    card.querySelector(".meter i").style.width = `${Math.round(match.probability * 100)}%`;
    card.classList.remove("yes", "maybe", "no");
    card.classList.add(verdict === "deliver" ? "yes" : verdict === "review" ? "maybe" : "no");
  }
}

function verdictFor(match) {
  const sub = app.subscriptions.find((entry) => entry.id === match.subscriptionId);
  const deliverAbove = sub ? sub.deliverAbove : 0.6;
  const reviewAbove = sub ? sub.reviewAbove : 0.4;
  if (match.probability >= deliverAbove) return "deliver";
  return match.probability >= reviewAbove ? "review" : "drop";
}

/* ---- result ---- */

function renderResult(pub) {
  els.result.replaceChildren();
  els.result.append(
    el("p", { class: "sent", dir: "auto", text: `You sent: “${truncate(pub.message.text, 140)}”` }),
  );

  const yes = pub.matches.filter((match) => verdictFor(match) === "deliver");
  const maybe = pub.matches.filter((match) => verdictFor(match) === "review");
  const parts = [
    `😄 ${yes.length} said yes`,
    `🤔 ${maybe.length} maybe`,
    `😴 ${pub.matches.length - yes.length - maybe.length} no`,
  ];
  const summary = el("p", { class: "summary", text: parts.join(" · ") });
  if (yes.length) {
    summary.append(el("span", { class: "seal", title: "delivered", text: "承" }));
  }
  els.result.append(summary);

  const names = yes.map((match) => {
    const sub = app.subscriptions.find((entry) => entry.id === match.subscriptionId);
    return sub ? `${emojiFor(sub)} ${sub.description}` : match.subscriptionId;
  });
  if (names.length) {
    els.result.append(el("p", { class: "winners", text: "Delivered to: " }));
    for (const name of names) {
      els.result.append(el("p", { class: "winner", text: `✅ ${name}` }));
    }
  }
  renderShare(pub);
}

/* ---- grown-ups ---- */

function renderGrown() {
  const summary = app.summary ?? { publications: 0, judgments: 0, costUsd: 0 };
  els.stats.textContent = `${app.mode} · ${app.model} · ${summary.publications} messages · ${summary.judgments} questions · $${summary.costUsd.toFixed(6)}`;

  els.grownWants.replaceChildren();
  for (const sub of app.subscriptions) {
    const row = el("div", { class: "grown-want" });
    const head = el("div", { class: "grown-head" });
    head.append(el("code", { text: sub.id }));
    head.append(
      el("span", {
        class: "mono",
        text: `deliver ≥ ${sub.deliverAbove.toFixed(2)} · review ≥ ${sub.reviewAbove.toFixed(2)}`,
      }),
    );
    row.append(head);

    const pick = el("div", { class: "chips" });
    const current = nearestPreset(sub.deliverAbove);
    for (const [key, preset] of Object.entries(PICKINESS)) {
      const button = el("button", {
        class: `chip ${key === current ? "on" : ""}`.trim(),
        type: "button",
        text: preset.label,
      });
      button.addEventListener("click", () => setPickiness(sub.id, preset));
      pick.append(button);
    }
    row.append(pick);

    const details = el("details");
    details.append(el("summary", { text: "the question sent to the model" }));
    const pre = el("pre", { class: "json" });
    pre.textContent = JSON.stringify(sub.question, null, 2);
    details.append(pre);
    row.append(details);
    els.grownWants.append(row);
  }
}

function nearestPreset(deliverAbove) {
  let best = "normal";
  let distance = Infinity;
  for (const [key, preset] of Object.entries(PICKINESS)) {
    const gap = Math.abs(preset.deliverAbove - deliverAbove);
    if (gap < distance) {
      distance = gap;
      best = key;
    }
  }
  return best;
}

async function setPickiness(id, preset) {
  const sub = app.subscriptions.find((entry) => entry.id === id);
  if (!sub) return;
  sub.deliverAbove = preset.deliverAbove;
  sub.reviewAbove = preset.reviewAbove;
  renderGrown();
  if (last) {
    renderResult(last);
    paintFaces(last.matches);
  }
  try {
    await api(`/api/subscriptions/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ deliverAbove: preset.deliverAbove, reviewAbove: preset.reviewAbove }),
    });
  } catch (error) {
    showError(els.wantError, error.message);
  }
}

function renderHistory() {
  els.history.replaceChildren();
  if (!history.length) {
    els.history.append(el("p", { class: "muted", text: "Nothing yet." }));
    return;
  }
  for (const pub of history) {
    const item = el("button", { class: "history-item", type: "button" });
    item.append(el("span", { class: "history-text", dir: "auto", text: `“${truncate(pub.message.text, 80)}”` }));
    const dots = el("span", { class: "dots" });
    for (const match of pub.matches) {
      dots.append(el("span", { class: `dot ${verdictFor(match)}` }));
    }
    item.append(dots);
    item.addEventListener("click", () => {
      last = pub;
      renderResult(pub);
      paintFaces(pub.matches);
    });
    els.history.append(item);
  }
}

/* ---- actions ---- */

async function addWant() {
  const description = els.wantInput.value.trim();
  if (!description) {
    showError(els.wantError, "Write what you care about first.");
    return;
  }
  try {
    await api("/api/subscriptions", { method: "POST", body: JSON.stringify({ description }) });
    els.wantInput.value = "";
    clearError(els.wantError);
    await refresh();
  } catch (error) {
    showError(els.wantError, error.message);
  }
}

async function removeWant(id) {
  try {
    await api(`/api/subscriptions/${encodeURIComponent(id)}`, { method: "DELETE" });
    await refresh();
  } catch (error) {
    showError(els.wantError, error.message);
  }
}

async function send() {
  const text = els.msgText.value.trim();
  if (!text) {
    showError(els.msgError, "Write a message first.");
    return;
  }
  els.send.disabled = true;
  els.send.textContent = "Thinking… 🤔";
  try {
    const pub = await api("/api/messages", { method: "POST", body: JSON.stringify({ text }) });
    last = pub;
    history.unshift(pub);
    history.splice(8);
    renderResult(pub);
    paintFaces(pub.matches);
    renderHistory();
    clearError(els.msgError);
    await refresh();
  } catch (error) {
    showError(els.msgError, error.message);
  } finally {
    els.send.disabled = false;
    els.send.textContent = "Send it! ✉️";
  }
}

/* ---- wiring ---- */

els.wantAdd.addEventListener("click", addWant);
els.wantInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") addWant();
});
els.send.addEventListener("click", send);
els.msgText.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) send();
});
els.reset.addEventListener("click", async () => {
  await api("/api/demo", { method: "POST", body: JSON.stringify({ reset: true }) }).catch((error) =>
    showError(els.wantError, error.message),
  );
  await refresh();
});

api("/api/samples")
  .then((data) => {
    const wanted = SHOWN_SAMPLES.map((source) =>
      data.messages.find((message) => message.source === source),
    ).filter(Boolean);
    for (const sample of wanted) {
      const button = el("button", {
        class: "chip sample",
        type: "button",
        text: SAMPLE_LABELS[sample.source] ?? truncate(sample.text, 40),
      });
      button.addEventListener("click", () => {
        els.msgText.value = sample.text;
        send();
      });
      els.samples.append(button);
    }
  })
  .catch(() => {});

const events = new EventSource("/api/events");
events.addEventListener("published", (event) => {
  const pub = JSON.parse(event.data);
  if (history.some((item) => item.id === pub.id)) return;
  history.unshift(pub);
  history.splice(8);
  renderHistory();
  refresh().catch(() => {});
});
events.addEventListener("state", () => refresh().catch(() => {}));

refresh().catch((error) => showError(els.msgError, `Could not load: ${error.message}`));

/* ---- share ---- */

const FONT = 'system-ui, -apple-system, "Segoe UI", "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
const SERIF = '"Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", Georgia, serif';

function shareText(pub) {
  const yes = pub.matches.filter((match) => verdictFor(match) === "deliver").length;
  const maybe = pub.matches.filter((match) => verdictFor(match) === "review").length;
  return `subtext sorted my message: 😄 ${yes} yes · 🤔 ${maybe} maybe · ${REPO_URL}`;
}

function renderShare(pub) {
  els.share.replaceChildren();
  els.share.hidden = false;

  const share = el("button", { class: "chip", type: "button", text: "📤 Share…", title: "share a picture of this result" });
  share.addEventListener("click", () => shareResult(pub));
  const save = el("button", { class: "chip", type: "button", text: "💾 Save image" });
  save.addEventListener("click", () => downloadCard(pub));
  const x = el("button", { class: "chip", type: "button", text: "𝕏 Post" });
  x.addEventListener("click", () =>
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText(pub))}`, "_blank", "noopener"),
  );
  const whatsapp = el("button", { class: "chip", type: "button", text: "🟢 WhatsApp" });
  whatsapp.addEventListener("click", () =>
    window.open(`https://wa.me/?text=${encodeURIComponent(shareText(pub))}`, "_blank", "noopener"),
  );

  els.share.append(el("span", { class: "sub", text: "share this:" }), share, save, x, whatsapp);
}

async function shareResult(pub) {
  const blob = await cardBlob(pub);
  const file = new File([blob], "subtext.png", { type: "image/png" });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], text: shareText(pub), title: "subtext" });
      return;
    }
    if (navigator.share) {
      await navigator.share({ text: shareText(pub), title: "subtext" });
      return;
    }
  } catch {
    return; // the person closed the share sheet
  }
  await downloadCard(pub);
}

async function downloadCard(pub) {
  const blob = await cardBlob(pub);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "subtext.png";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function cardBlob(pub) {
  const canvas = renderCard(pub);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("could not render the image"))),
      "image/png",
    );
  });
}

function renderCard(pub) {
  const width = 1200;
  const height = 960;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#f7f2e8";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#e3dac8";
  ctx.lineWidth = 4;
  ctx.strokeRect(20, 20, width - 40, height - 40);

  // hanko stamp
  roundRect(ctx, 64, 58, 58, 58, 8);
  ctx.fillStyle = "#b3372c";
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = `36px ${SERIF}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("文", 93, 89);
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";

  ctx.fillStyle = "#262119";
  ctx.font = `700 46px ${SERIF}`;
  ctx.fillText("subtext", 146, 102);
  ctx.fillStyle = "#8c8578";
  ctx.font = `24px ${FONT}`;
  ctx.fillText(REPO_URL, 146, 140);

  const boxX = 64;
  const boxY = 180;
  const boxW = width - 128;
  ctx.font = `30px ${FONT}`;
  const lines = wrapText(ctx, pub.message.text, boxW - 56, 3);
  const boxH = lines.length * 42 + 48;
  roundRect(ctx, boxX, boxY, boxW, boxH, 20);
  ctx.fillStyle = "#fffdf8";
  ctx.fill();
  ctx.strokeStyle = "#e3dac8";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = "#262119";
  lines.forEach((line, index) => ctx.fillText(line, boxX + 28, boxY + 46 + index * 42));

  const rows = [...pub.matches].sort((a, b) => b.probability - a.probability).slice(0, 5);
  const hidden = pub.matches.length - rows.length;
  let y = boxY + boxH + 30;
  for (const match of rows) {
    const sub = app.subscriptions.find((entry) => entry.id === match.subscriptionId);
    const verdict = verdictFor(match);
    const color = verdict === "deliver" ? "#4f7a52" : verdict === "review" ? "#b07d2b" : "#a49d90";

    ctx.font = `40px ${FONT}`;
    ctx.fillText(LOOKS[verdict].face, 64, y + 40);

    ctx.font = `27px ${FONT}`;
    ctx.fillStyle = "#262119";
    ctx.fillText(
      truncateToWidth(ctx, sub ? `${emojiFor(sub)} ${sub.description}` : match.subscriptionId, 760),
      128,
      y + 40,
    );

    ctx.fillStyle = color;
    ctx.font = `800 27px ${FONT}`;
    const percent = `${Math.round(match.probability * 100)}%`;
    ctx.fillText(percent, width - 64 - ctx.measureText(percent).width, y + 40);
    y += 68;
  }
  if (hidden > 0) {
    ctx.fillStyle = "#8c8578";
    ctx.font = `24px ${FONT}`;
    ctx.fillText(`+ ${hidden} more`, 128, y + 30);
  }

  const yes = pub.matches.filter((match) => verdictFor(match) === "deliver").length;
  const maybe = pub.matches.filter((match) => verdictFor(match) === "review").length;
  ctx.fillStyle = "#6f695e";
  ctx.font = `26px ${FONT}`;
  ctx.fillText(
    `😄 ${yes} yes · 🤔 ${maybe} maybe · 😴 ${pub.matches.length - yes - maybe} no`,
    64,
    height - 72,
  );

  if (yes > 0) {
    roundRect(ctx, width - 128, height - 116, 64, 64, 8);
    ctx.fillStyle = "#b3372c";
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = `38px ${SERIF}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("承", width - 96, height - 84);
    ctx.textAlign = "start";
    ctx.textBaseline = "alphabetic";
  }

  return canvas;
}

function wrapText(ctx, text, maxWidth, maxLines) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      line = candidate;
    } else {
      if (line) lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && lines.join(" ").length < text.length) {
    lines[maxLines - 1] = `${lines[maxLines - 1]}…`;
  }
  return lines;
}

function truncateToWidth(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out}…`;
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(x, y, width, height, radius);
    return;
  }
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

/* ---- tiny helpers ---- */

function el(tag, props = {}) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "text") node.textContent = value;
    else if (key === "class") node.className = value;
    else node.setAttribute(key, value);
  }
  return node;
}

function truncate(text, length) {
  return text.length <= length ? text : `${text.slice(0, length - 1)}…`;
}

function showError(node, message) {
  node.textContent = message;
  node.hidden = false;
  clearTimeout(node.__timer);
  node.__timer = setTimeout(() => {
    node.hidden = true;
  }, 6000);
}

function clearError(node) {
  clearTimeout(node.__timer);
  node.hidden = true;
}

function cssEscape(value) {
  return value.replace(/["\\]/g, "\\$&");
}
