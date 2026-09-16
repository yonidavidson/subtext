/** Shared demo fixtures: used by the scripted demo and the website's "load demo". */

export interface DemoSubscription {
  id: string;
  description: string;
  deliverAbove: number;
  reviewAbove: number;
  examples?: string[];
  not?: string[];
}

export interface DemoMessage {
  source: string;
  text: string;
}

export const DEMO_SUBSCRIPTIONS: DemoSubscription[] = [
  {
    id: "security",
    description: "Security vulnerabilities in dependencies I use that need an upgrade",
    deliverAbove: 0.6,
    reviewAbove: 0.4,
  },
  {
    id: "privacy",
    description: "Anything about my data being sold, shared, or used to train AI models",
    deliverAbove: 0.6,
    reviewAbove: 0.4,
    examples: ["we may share your data with advertising partners"],
    not: ["how we keep your data secure"],
  },
  {
    id: "incident",
    description: "Production incidents, outages, or postmortems for services I depend on",
    deliverAbove: 0.6,
    reviewAbove: 0.4,
  },
  {
    id: "promises",
    description: "Things I promised someone, or deadlines coming up",
    deliverAbove: 0.5,
    reviewAbove: 0.3,
  },
  {
    id: "hiring",
    description: "Interesting Go or AI engineering roles, remote-friendly or in Israel",
    deliverAbove: 0.55,
    reviewAbove: 0.35,
  },
  {
    id: "mentions",
    description: "Someone mentioning me or my projects by name",
    deliverAbove: 0.55,
    reviewAbove: 0.3,
  },
];

export const DEMO_MESSAGES: DemoMessage[] = [
  {
    source: "deps-bot",
    text: "CVE-2026-4187: a prototype pollution vulnerability found in lodash-utils. Upgrade to 4.17.22 or later.",
  },
  {
    source: "newsletter",
    text: "Privacy policy update: we may sell aggregated data to advertising partners and use it to train our models.",
  },
  {
    source: "status-page",
    text: "Incident: the API is down in eu-west-1. A postmortem will follow. No other service is affected.",
  },
  {
    source: "noa",
    text: "Reminder: you promised to send the slides — that deadline is in two days.",
  },
  {
    source: "jobs-digest",
    text: "We're hiring a senior Go engineer for our AI infrastructure team. Tel Aviv, remote-friendly.",
  },
  {
    source: "go-weekly",
    text: "Nice mention of my rakevet CLI in the latest Go newsletter.",
  },
  {
    source: "vendor",
    text: "Policy update: we share data with selected partners to improve our services.",
  },
  {
    source: "ops",
    text: "Scheduled maintenance window on Saturday for the dashboard.",
  },
  {
    source: "feed",
    text: "Recipe: classic sourdough starter in seven days.",
  },
];
