// Safe, dependency-free markdown -> HTML for the chat feed.
// Escapes everything first, then re-introduces only the tags we generate,
// so brain output can never inject markup into the page.

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const CODE_SENTINEL = "\u0000CODE";
const INLINE_SENTINEL = "\u0000IC";

export function renderMarkdown(input) {
  const codeBlocks = [];
  const inlineCodes = [];

  // 1. pull fenced code blocks out before any escaping so their content is
  //    preserved verbatim (and escaped exactly once, on the way back in).
  let text = String(input).replace(/```([\w-]*)\n?([\s\S]*?)```/g, (m, lang, code) => {
    codeBlocks.push({ lang, code });
    return `${CODE_SENTINEL}${codeBlocks.length - 1}\u0000`;
  });

  // 2. escape everything that remains.
  text = escapeHtml(text);

  // 3. inline code.
  text = text.replace(/`([^`\n]+)`/g, (m, code) => {
    inlineCodes.push(code);
    return `${INLINE_SENTINEL}${inlineCodes.length - 1}\u0000`;
  });

  // 4. headings.
  text = text
    .replace(/^###\s+(.+)$/gm, "<h3>$1</h3>")
    .replace(/^##\s+(.+)$/gm, "<h2>$1</h2>")
    .replace(/^#\s+(.+)$/gm, "<h1>$1</h1>");

  // 5. bold and italic.
  text = text
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");

  // 6. blockquotes.
  text = text.replace(/^&gt;\s?(.+)$/gm, "<blockquote>$1</blockquote>");

  // 7. unordered and ordered lists.
  text = text.replace(/(^|\n)((?:-\s.+(?:\n|$))+)/g, (m, pre, block) => {
    const items = block
      .trim()
      .split("\n")
      .map((line) => `<li>${line.replace(/^-\s/, "")}</li>`)
      .join("");
    return `${pre}<ul>${items}</ul>`;
  });
  text = text.replace(/(^|\n)((?:\d+\.\s.+(?:\n|$))+)/g, (m, pre, block) => {
    const items = block
      .trim()
      .split("\n")
      .map((line) => `<li>${line.replace(/^\d+\.\s/, "")}</li>`)
      .join("");
    return `${pre}<ol>${items}</ol>`;
  });

  // 8. paragraphs on blank lines.
  const parts = text
    .split(/\n{2,}/)
    .map((chunk) => {
      const t = chunk.trim();
      if (!t) return "";
      if (/^<(h\d|ul|ol|blockquote|pre)/.test(t)) return t;
      if (t.includes(`${CODE_SENTINEL}`)) return t;
      return `<p>${t.replace(/\n/g, "<br />")}</p>`;
    })
    .filter(Boolean);

  let html = parts.join("\n");

  // 9. restore inline code, then fenced blocks.
  html = html.replace(
    new RegExp(`${INLINE_SENTINEL}(\\d+)\u0000`, "g"),
    (m, i) => `<code>${inlineCodes[+i]}</code>`
  );
  html = html.replace(
    new RegExp(`${CODE_SENTINEL}(\\d+)\u0000`, "g"),
    (m, i) => {
      const { lang, code } = codeBlocks[+i];
      const cls = lang ? ` class="lang-${escapeHtml(lang)}"` : "";
      return `<pre><code${cls}>${escapeHtml(code)}</code></pre>`;
    }
  );
  return html;
}

export function textOnly(input) {
  const div = document.createElement("div");
  div.innerHTML = renderMarkdown(input);
  return div.textContent || "";
}
