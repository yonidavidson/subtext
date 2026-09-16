import type { Subscription } from "./types.ts";

/**
 * The state sent to the model. Only `text` and `source` are included; any local
 * `data` attached to a message stays on this side.
 */
export function stateFor(message: { text: string; source?: string }): Record<string, unknown> {
  const messageJson: Record<string, unknown> = { text: message.text };
  if (message.source) messageJson.source = message.source;
  return { message: messageJson };
}

/**
 * Builds the Noul question for one subscription.
 *
 * The question id is for code; everything the model sees lives in `instructions`
 * and `criteria`. Examples and counter-examples are only included when provided,
 * so a bare subscription stays a short question.
 */
export function subscriptionQuestion(sub: Subscription): Record<string, unknown> {
  const trueSide: Record<string, unknown> = {
    what: "The message is clearly the kind of thing the subscription describes",
  };
  if (sub.examples?.length) trueSide.examples = sub.examples;

  const falseSide: Record<string, unknown> = {
    what: "It is not that kind of thing, or only mentions it in passing",
  };
  if (sub.not?.length) falseSide.not_for = sub.not;

  return {
    type: "noul",
    instructions: {
      question: `Does \`message.text\` match this subscription: "${sub.description}"?`,
      inspect: "`message.text`",
      focus:
        "Judge whether the message is something the subscriber asked to be notified about. Match on meaning, not wording; sharing a keyword alone is not a match.",
    },
    criteria: { true: trueSide, false: falseSide },
  };
}
