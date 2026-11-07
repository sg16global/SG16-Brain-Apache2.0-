# SG16 Brain — the exact inference format (for fine-tuning)

Written 2026-11-06 from the code and from measurements on the studio PC;
updated 2026-11-07 for the published Ollama build. If the studio fine-tunes
the brain, the training data should use **this** format, or the chat template
of the published build (section 3) must be changed to the format the training
used. Everything below was read from the files or measured, not assumed.

## 1. The weights

| Field (GGUF header) | Value |
|---|---|
| build | `saiftechglobal/sg16-brain:Q4_K_M` on Ollama, ID `f4b21a5d4668` |
| weights layer | 7,477,728,576 bytes, `sha256:966a7e76a38e90bbf46a8a56eea9f2a6bf7a8a16e2c705ae94bbc5ab89623dfd` |
| `general.name` / `general.license` | `SG16 Brain` / `apache-2.0` (the header also carries the copyright and base-model attribution) |
| `general.file_type` | 15 = Q4_K_M |
| architecture | `llama`, 12B (Ollama: 12.2B parameters) |
| layers / hidden / FFN | 40 / 5120 / 14336 |
| attention heads / KV heads / head dim | 32 / 8 / 128 |
| RoPE base / max context | 1,000,000 / 131,072 |
| vocabulary | 131,072, tokenizer `gpt2` with pre-tokenizer `tekken` |
| special tokens | `<unk>`=0, `<s>`=1 (BOS), `</s>`=2 (EOS), `[INST]`=3, `[/INST]`=4, `<pad>`=11 |
| BOS / EOS added automatically | BOS yes, EOS no |
| built-in chat template | `mistral-v3-tekken` |

KV cache at the served 8,192-token context: 2 × 40 × 8 × 128 × 2 bytes =
163,840 bytes per token → 1,342,177,280 bytes (1.34 GB).

## 2. What the server sends (website chat)

Messages, in order:

1. `system`: the SG16 system prompt (`brain-core/src/prompt.ts`, `systemPrompt()`),
   verbatim, 916 characters ≈ 200 tokens. When the visitor's script is detected
   with confidence ≥ 0.3 and at least 2 letters, one more sentence is appended:
   `The user's message is written in the <Script> script. Reply in that same language.`
2. history: at most the visitor's last **6** turns (`recentHistory`), each turn
   trimmed to **800** characters, only `user` / `assistant` roles, dropped from
   the oldest side until message + history ≤ **8,192** characters, and always
   starting with a `user` turn.
3. `user`: the visitor's message (≤ 8,192 characters).

API projects (`/v1/ask`, `/v1/chat/completions`, `/api/brain` with a key) send
their **own** system prompt (optional), their own history and message; the SG16
system prompt is not added. The same template applies.

## 3. The template (shipped in the published build) — "layout A"

```
<s>[INST]{system}

{user 1}[/INST]{assistant 1}</s>[INST]{user 2}[/INST]{assistant 2}</s>[INST]{user N}[/INST]
```

The system prompt rides in front of the **first** user turn (two newlines
between). `<s>` is the BOS the runtime adds. Stop strings: `[INST]`, `[/INST]`,
`</s>`. Sampling (the build's own parameters): `temperature 0.7`, `top_k 40`,
`top_p 0.9`, `repeat_penalty 1.1`, `num_ctx 16384`. The Worker overrides only
`num_ctx` (8192) and sets no `num_predict` cap (an answer ends at EOS, at the
16,384-character output check, or at the 95 s time limit).

Verified 2026-11-06 (earlier local build, same template): Ollama `/api/chat`
and a hand-built raw layout-A prompt give byte-identical answers and identical
prompt token counts (215 and 246 tokens for a 1-turn and a 5-turn test,
temperature 0, seed 1). The published build's template is byte-identical to
the one tested.

The alternative layout ("layout B") puts the system prompt in front of the
**last** user turn instead. To serve that format, the only change is this
template line: `{{ if and $.System (eq (len (slice $.Messages $i)) 1) }}`
instead of `{{ if and $.System $first }}` (then publish a new build).
**Not tested yet** — verify it with the same raw-prompt comparison as above
before serving it.

## 4. Measurement: which layout these weights answer best with

8 tasks with exactly computed answers (arithmetic after chat, recall of earlier
turns), temperature 0, seed 1, the real system prompt, raw prompts:

| Task | Expected | Layout A (first turn) | Layout B (last turn) |
|---|---|---|---|
| 12 × 7 after small talk | 84 | 84 ✓ | 84 ✓ |
| 3 + 5 − 2 apples | 6 | 7 ✗ | 7 ✗ |
| 15 % of 240 | 36 | 36 ✓ | 15 ✗ |
| recall name | Rahim | Rahim ✓ | Rahim ✓ |
| x = 9, y = 4, x·y + 1 | 37 | 37 ✓ | 73 ✗ |
| 1234 + 5678 | 6912 | 7912 ✗ | 2712 ✗ |
| 23 × 19, no history | 437 | 437 ✓ | 437 ✓ |
| recall city | Dhaka | Dhaka ✓ | Dhaka ✓ |
| **score** | | **6 / 8** | **4 / 8** |

The two layout-A errors were questions ending in "Number only." Asked the same
two questions without that constraint, the brain answered correctly ("You have
6 apples left.", "The sum is 6912."). So: forcing a bare number makes this
quantized 12B model skip its working and guess; arithmetic reliability is a
clear fine-tuning target. 8 tasks is a small sample — repeat with a larger set
before drawing final conclusions.

## 5. Cost and speed (studio PC, CPU, 24 GB RAM)

- ~2.3 tokens/s writing, ~5 tokens/s reading the prompt; short reply ~4–8 s
  (prompt cached), first reply of a conversation up to ~35 s (prompt not cached).
- One free chat turn costs ≈ 200 (system prompt) + history + question + answer
  tokens. The 10,000-token free allowance is therefore ≈ 45 very short turns at
  most, ≈ 20–35 in normal use.
- Each model call may take up to 95 s; one chat holds the brain for at most
  draft + retry + self-check = 285 s (queue lease 300 s).
