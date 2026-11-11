// Small markdown-to-HTML step for the hub's docs pages. No library.
// Handles: headings, paragraphs, nested lists, tables, fenced and inline code,
// bold, italic, links, bare URLs, blockquotes, rules. Raw HTML is escaped, never passed through.

export const escapeHtml = (text) => String(text)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const FENCE = /^\s*(`{3,}|~{3,})\s*(\S*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const TABLE_DIVIDER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

const isBlank = (line) => /^\s*$/.test(line);
const indentOf = (line) => /^\s*/.exec(line)[0].length;
const isTableStart = (lines, at) =>
  lines[at].includes('|') && at + 1 < lines.length && lines[at + 1].includes('|') && TABLE_DIVIDER.test(lines[at + 1]);
const startsBlock = (lines, at) =>
  FENCE.test(lines[at]) || HEADING.test(lines[at]) || RULE.test(lines[at]) || /^\s*>/.test(lines[at])
  || LIST_ITEM.test(lines[at]) || isTableStart(lines, at);

/** Split one table row into cells. A pipe inside backticks, or written `\|`, stays in its cell. */
function splitRow(line) {
  const cells = [];
  let cell = '';
  let inCode = false;
  const text = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  for (let at = 0; at < text.length; at++) {
    const character = text[at];
    if (character === '\\' && text[at + 1] === '|') { cell += '|'; at++; continue; }
    if (character === '`') inCode = !inCode;
    if (character === '|' && !inCode) { cells.push(cell.trim()); cell = ''; continue; }
    cell += character;
  }
  cells.push(cell.trim());
  return cells;
}

/**
 * Inline markdown to HTML.
 * `rewriteLink(href)` returns the href to use, or null to print the label as plain text.
 */
function inline(text, rewriteLink) {
  const held = [];
  const hold = (html) => `\u0001${held.push(html) - 1}\u0001`;
  const anchor = (href, labelHtml) => {
    const target = rewriteLink(href);
    return target === null ? labelHtml : `<a href="${escapeHtml(target)}">${labelHtml}</a>`;
  };

  let out = text
    // Code spans first, so nothing inside them is read as markdown. A code span that is only a URL becomes a link.
    .replace(/(`+)(.+?)\1/g, (_, ticks, code) => {
      const html = `<code>${escapeHtml(code.trim())}</code>`;
      return hold(/^https?:\/\/\S+$/.test(code.trim()) ? anchor(code.trim(), html) : html);
    })
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => hold(anchor(href, inline(label, () => null))))
    .replace(/https?:\/\/[^\s<>()\]\u0001]+/g, (found) => {
      const url = found.replace(/[.,;:!?]+$/, '');
      return hold(anchor(url, escapeHtml(url))) + found.slice(url.length);
    });

  out = escapeHtml(out)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w*])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<em>$2</em>');

  // Held pieces can hold other held pieces (a code span inside a link label).
  while (/\u0001\d+\u0001/.test(out)) out = out.replace(/\u0001(\d+)\u0001/g, (_, index) => held[Number(index)]);
  return out;
}

function renderBlocks(lines, rewriteLink) {
  const html = [];
  let at = 0;

  while (at < lines.length) {
    const line = lines[at];
    if (isBlank(line)) { at++; continue; }

    const fence = FENCE.exec(line);
    if (fence) {
      const body = [];
      at++;
      while (at < lines.length && !lines[at].trim().startsWith(fence[1])) body.push(lines[at++]);
      at++;
      html.push(`<pre><code>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      html.push(`<h${heading[1].length}>${inline(heading[2], rewriteLink)}</h${heading[1].length}>`);
      at++;
      continue;
    }

    if (RULE.test(line)) { html.push('<hr>'); at++; continue; }

    if (/^\s*>/.test(line)) {
      const quoted = [];
      while (at < lines.length && /^\s*>/.test(lines[at])) quoted.push(lines[at++].replace(/^\s*>\s?/, ''));
      html.push(`<blockquote>${renderBlocks(quoted, rewriteLink)}</blockquote>`);
      continue;
    }

    if (isTableStart(lines, at)) {
      const head = splitRow(lines[at]);
      const aligns = splitRow(lines[at + 1]).map((cell) =>
        (cell.startsWith(':') && cell.endsWith(':') ? 'center' : cell.endsWith(':') ? 'right' : ''));
      at += 2;
      const rows = [];
      while (at < lines.length && !isBlank(lines[at]) && lines[at].includes('|')) rows.push(splitRow(lines[at++]));
      const cellHtml = (tag, text, column) =>
        `<${tag}${aligns[column] ? ` style="text-align:${aligns[column]}"` : ''}>${inline(text, rewriteLink)}</${tag}>`;
      html.push(
        '<div class="table-scroll"><table><thead><tr>'
        + head.map((text, column) => cellHtml('th', text, column)).join('')
        + '</tr></thead><tbody>'
        + rows.map((row) => `<tr>${head.map((_, column) => cellHtml('td', row[column] ?? '', column)).join('')}</tr>`).join('')
        + '</tbody></table></div>',
      );
      continue;
    }

    const first = LIST_ITEM.exec(line);
    if (first) {
      const base = first[1].length;
      const ordered = /\d/.test(first[2]);
      const items = [];
      while (at < lines.length) {
        const marker = LIST_ITEM.exec(lines[at]);
        if (!marker || marker[1].length !== base || /\d/.test(marker[2]) !== ordered) break;
        const contentIndent = base + marker[2].length + 1;
        const item = [marker[3]];
        at++;
        while (at < lines.length) {
          const next = lines[at];
          if (isBlank(next)) {
            let ahead = at;
            while (ahead < lines.length && isBlank(lines[ahead])) ahead++;
            if (ahead < lines.length && indentOf(lines[ahead]) > base) { item.push(''); at++; continue; }
            break;
          }
          if (indentOf(next) > base) { item.push(next.slice(Math.min(indentOf(next), contentIndent))); at++; continue; }
          if (startsBlock(lines, at)) break;
          item.push(next.trim());
          at++;
        }
        items.push(renderBlocks(item, rewriteLink).replace(/^<p>([\s\S]*?)<\/p>/, '$1'));
        // A blank line between two items of the same list does not end the list.
        let ahead = at;
        while (ahead < lines.length && isBlank(lines[ahead])) ahead++;
        const sibling = ahead < lines.length ? LIST_ITEM.exec(lines[ahead]) : null;
        if (sibling && sibling[1].length === base && /\d/.test(sibling[2]) === ordered) at = ahead;
      }
      const start = ordered && Number.parseInt(first[2], 10) !== 1 ? ` start="${Number.parseInt(first[2], 10)}"` : '';
      html.push(`<${ordered ? `ol${start}` : 'ul'}>${items.map((item) => `<li>${item}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }

    const paragraph = [line.trim()];
    at++;
    while (at < lines.length && !isBlank(lines[at]) && !startsBlock(lines, at)) paragraph.push(lines[at++].trim());
    html.push(`<p>${inline(paragraph.join(' '), rewriteLink)}</p>`);
  }

  return html.join('\n');
}

/** Markdown source to an HTML fragment. */
export function renderMarkdown(source, { rewriteLink = (href) => href } = {}) {
  return renderBlocks(source.replace(/\r\n?/g, '\n').split('\n'), rewriteLink);
}

/** The text of the first level-one heading, or null. */
export function firstHeading(source) {
  const found = /^#\s+(.*?)\s*#*\s*$/m.exec(source);
  return found ? found[1] : null;
}
