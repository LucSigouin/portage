/**
 * What the performance readout shows: a small card while it measures, then a
 * sheet with the text, a Copy button and one line of instruction. Drawn in the
 * interface's own hand (its classes, its paper, its pen), and nothing on it moves.
 */
import './readout.css';

export interface ReadoutPanel {
  /** The one line under the title while it measures. */
  progress(line: string): void;
  /** Replace the card with the finished sheet. */
  finish(text: string, summary: string): void;
}

function element<Tag extends keyof HTMLElementTagNameMap>(tag: Tag, classes: string, text = ''): HTMLElementTagNameMap[Tag] {
  const made = document.createElement(tag);
  made.className = classes;
  if (text) made.textContent = text;
  return made;
}

/**
 * Copy `text`. The clipboard first; if the browser refuses, the old command on
 * the selected text; if that fails too, the text stays selected and the player copies it by hand.
 */
async function copyText(area: HTMLTextAreaElement, text: string): Promise<boolean> {
  area.focus();
  area.select();
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    }
  }
}

export function createReadoutPanel(): ReadoutPanel {
  // The interface's root carries the theme: the same classes on a root of our own give the same hand.
  const root = element('div', 'iw pf-root');
  const paper = document.querySelector<HTMLElement>('#interface')?.style.getPropertyValue('--iw-tex');
  if (paper) root.style.setProperty('--iw-tex', paper);

  const card = element('section', 'iw-paper pf-card');
  card.setAttribute('role', 'status');
  const line = element('p', 'pf-line', 'Starting');
  card.append(element('i', 'iw-tape pf-tape'), element('h2', '', 'Performance readout'), line, element('p', 'iw-sub', 'Nothing to press. Keep this window in front.'));
  root.append(card);
  document.body.append(root);

  // The readout plays the game by itself: keys and the mouse stay with the page, not the canoe.
  // Browser shortcuts (copy, reload) are untouched, since only the game's own listeners are cut off.
  const swallow = (event: Event): void => event.stopImmediatePropagation();
  window.addEventListener('keydown', swallow, true);
  window.addEventListener('keyup', swallow, true);

  return {
    progress(text: string): void {
      if (line.textContent !== text) line.textContent = text;
    },
    finish(text: string, summary: string): void {
      const sheet = element('section', 'iw-panel iw-paper pf-sheet');
      sheet.setAttribute('role', 'dialog');
      sheet.setAttribute('aria-label', 'Performance readout');

      const header = element('header', '');
      header.append(element('h2', '', 'Performance readout'), element('span', 'iw-sub', summary));

      const area = element('textarea', 'pf-text');
      area.readOnly = true;
      area.spellcheck = false;
      area.value = text;
      area.setAttribute('aria-label', 'The readout, as text');
      const body = element('div', 'pf-body');
      body.append(area);

      const footer = element('footer', '');
      const send = element('p', 'pf-send', 'Send this to Luc.');
      const note = element('span', 'iw-sub pf-note');
      note.setAttribute('role', 'status');
      const copy = element('button', 'iw-btn iw-go pf-copy', 'Copy');
      copy.type = 'button';
      copy.addEventListener('click', () => {
        void copyText(area, text).then((copied) => {
          note.textContent = copied
            ? 'Copied. Paste it into a message.'
            : 'The text is selected. Press Ctrl+C (Cmd+C on a Mac) to copy it.';
        });
      });
      const actions = element('div', 'pf-actions');
      actions.append(note, copy);
      footer.append(send, actions);

      sheet.append(element('i', 'iw-tape iw-a'), header, body, footer);
      card.remove();
      root.classList.add('pf-done');
      root.append(sheet);
      copy.focus();
    },
  };
}
