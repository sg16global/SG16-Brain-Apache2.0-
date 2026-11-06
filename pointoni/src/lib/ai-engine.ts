// SG16 local guard engine: the deterministic last-resort answers used when the
// core and the language model cannot answer. It talks to nothing outside this process, and
// it never relays to a third-party model or pretends to be one.

type Rule = { test: RegExp; paragraphs: string[] };

const CORE_RULES: Rule[] = [
  {
    test: /\b(hi|hello|hey|greetings|good (morning|afternoon|evening))\b/i,
    paragraphs: [
      "Greetings. I am SG16 Brain — a limited deterministic assistant on this platform.",
      "I can explain AI concepts, write short code snippets, walk through arithmetic, and help plan focused tasks within this build's limited knowledge scope. What are we building today?",
    ],
  },
  {
    test: /sovereign|self.?host|ownership|dependency|on-?prem|private deploy/i,
    paragraphs: [
      "This build runs a deterministic structural core in-process. It is not a broad pretrained language model.",
      "Sovereign hosting can keep the structural core inside your deployment. This application does not train models on your chats. Account data may still be stored by the deployment, and logs/backups depend on operator configuration.",
    ],
  },
  {
    test: /\b(claude|gpt|gemini|llama|stable diffusion|model|compare|difference)\b/i,
    paragraphs: [
      "This build answers through one path only: SG16's own safety gate and core, plus its own language model. It does not relay to outside AI providers.",
      "• SG16 safety gate — screens every message first.\n• SG16 language model — answers clean messages.\n• SG16 deterministic core — the fallback if the model cannot answer.",
    ],
  },
  {
    test: /history|dartmouth|timeline|when did ai|neural|deep learning|generative|machine learning\b/i,
    paragraphs: [
      "A short history of AI, as traced on this platform:",
      "\u2022 1956 \u2014 the Dartmouth Conference introduces the term \u201CArtificial Intelligence\u201D.\n\u2022 1960s\u20131970s \u2014 early symbolic systems and expert systems.\n\u2022 1980s\u20131990s \u2014 machine learning and statistical methods.\n\u2022 2000s \u2014 deep learning and neural networks mature.\n\u2022 2010s \u2014 generative AI and large language models emerge.\n\u2022 2020s+ \u2014 Sovereign AI: open, independent and human-centric.",
      "The arc runs 1956 \u2192 Machine Learning \u2192 Deep Learning \u2192 Generative AI \u2192 Sovereign AI. Each era expanded what machines could learn; the current era asks who owns that capability.",
    ],
  },
  {
    test: /\b(api|token|endpoint|integrate|sdk|rest|curl)\b/i,
    paragraphs: [
      "API access is live. Open \u201CAPI Access\u201D in the sidebar to mint an SG16 token, then call the chat endpoint:",
      "curl -X POST https://your-deployment/api/chat \\\n  -H \"Authorization: Bearer sg16_xxxx\" \\\n  -H \"Content-Type: application/json\" \\\n  -d '{\"modelId\":\"sg16-brain\",\"message\":\"Hello SG16\"}'",
      "Responses include the model id and a brain/runtime field identifying which path produced the answer. Account API tokens can be revoked from the API Access panel.",
    ],
  },
  {
    test: /\b(code|function|python|javascript|typescript|bug|debug|script|regex|sql)\b/i,
    paragraphs: [
      "Absolutely \u2014 development work is what the Developer Pilot is built for. Here is a safe JSON-parsing helper in Python:",
      "import json\nfrom typing import Any\n\ndef parse_json(raw: str | bytes, default: Any = None) -> Any:\n    \"\"\"Parse JSON without raising; returns `default` on failure.\"\"\"\n    try:\n        return json.loads(raw)\n    except (json.JSONDecodeError, TypeError, ValueError):\n        return default",
      "Share the language, constraints and any error output and I will write, refactor or debug the exact implementation with you.",
    ],
  },
  {
    test: /ethic|responsib|safety|bias|privacy|trust|wisely|respect/i,
    paragraphs: [
      "Our message to every AI user is simple: use AI wisely, and build a better tomorrow.",
      "AI is not an independent authority. It operates through guidance \u2014 created, trained, configured and directed by humans. The quality of an interaction depends greatly on the instructions, content and context provided by its user. Ask better questions, verify important information, use AI with honesty and respect, support positive and legal use, and help create a fairer planet.",
    ],
  },
  {
    test: /country|countries|global|usa|uk|france|russia|china|germany|time|node/i,
    paragraphs: [
      "The Global Presence interface shows six timezone labels: the USA, the UK, France, Russia, China and Germany. These are presentation clocks, not verified operational nodes.",
      "Each sidebar clock is computed in your browser with IANA timezone data. A correct local time does not prove that an operational facility exists in that region.",
    ],
  },
  {
    test: /price|pricing|plan|subscription|cost|pay|billing|enterprise\b/i,
    paragraphs: [
      "Passes are host-issued, time-limited entitlements: 24-Hour Entry ($3), 1-Week Premium ($5), 15-Day Premium ($8) and 1-Month Premium ($15). The host still applies safety gates and any configured operational limits.",
      "Checkout uses Dodo Payments only when the operator has configured gateway credentials; otherwise paid checkout fails closed. The browser may cache a bearer pass record locally, but it cannot grant access by itself. Regional zero-rate eligibility must be verified by an operator-trusted proxy; browser locale or region overrides do not qualify.",
    ],
  },
  {
    test: /what is ai|artificial intelligence|explain ai\b/i,
    paragraphs: [
      "Artificial Intelligence (AI) is technology designed to process information, recognize patterns, respond over data, and assist humans in solving problems.",
      "Modern AI combines machine learning, deep neural networks and large language models. The SG16 mission is to make that capability open knowledge \u2014 with global impact, real solutions, and a smarter world that people actually own.",
    ],
  },
];

const FALLBACK = [
  "Understood. I will work through that with you directly.",
  "I can help best with focused questions, arithmetic, planning, and short code explanations within this build's limited knowledge scope. Share any constraints or the exact output you need; if the topic is outside that scope, I will say so instead of inventing an answer.",
];

function buildCoreReply(prompt: string): string[] {
  for (const rule of CORE_RULES) {
    if (rule.test.test(prompt)) return rule.paragraphs;
  }
  return FALLBACK;
}

/** Last-resort local answer. Instant: no network, no artificial delay. */
export async function generateReply(prompt: string): Promise<{ content: string; latencyMs: number }> {
  const started = performance.now();
  const content = buildCoreReply(prompt).join("\n\n");
  return { content, latencyMs: Math.round(performance.now() - started) };
}
