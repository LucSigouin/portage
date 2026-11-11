/**
 * A very small virtual DOM: views describe the markup as plain objects, and
 * `reconcile` changes only what differs from the last description.
 *
 * Nothing here is rebuilt: an element that is still wanted stays the same
 * element, so focus, scroll position and a slider being dragged all survive
 * the frame. Views are plain data and can be built and checked without a DOM.
 */
import type { InterfaceIntent } from '../client/contracts.ts';

export type AttributeValue = string | number | boolean | null | undefined;

export interface ViewNode {
  /** Element name, or `#text`. */
  tag: string;
  /** Tells one sibling from another when a list changes. Null: matched by order. */
  key: string | null;
  classes: string;
  attributes: Record<string, AttributeValue>;
  /** Fixed inner markup (drawn icons). Such a node has no children. */
  html: string | null;
  /** The characters of a `#text` node. */
  text: string;
  children: ViewNode[];
  /** What to send when this control is used. */
  intent: InterfaceIntent | null;
  element: HTMLElement | Text | null;
}

export type ViewChild = ViewNode | string | number | null | undefined | false | ViewChild[];

const NO_ATTRIBUTES: Record<string, AttributeValue> = {};
const selectorCache = new Map<string, { tag: string; classes: string }>();

function parseSelector(selector: string): { tag: string; classes: string } {
  let parsed = selectorCache.get(selector);
  if (!parsed) {
    const [tag, ...classes] = selector.split('.');
    parsed = { tag: tag || 'div', classes: classes.join(' ') };
    selectorCache.set(selector, parsed);
  }
  return parsed;
}

function appendChildren(target: ViewNode[], child: ViewChild): void {
  if (child === null || child === undefined || child === false) return;
  if (Array.isArray(child)) {
    for (const entry of child) appendChildren(target, entry);
  } else if (typeof child === 'object') {
    target.push(child);
  } else {
    target.push({
      tag: '#text', key: null, classes: '', attributes: NO_ATTRIBUTES, html: null, text: String(child), children: [],
      intent: null, element: null,
    });
  }
}

/**
 * Describe an element. `selector` is `tag.class.class`. The attributes `key`,
 * `class` and `html` are special: a sibling key, extra classes, fixed inner markup.
 */
export function h(selector: string, attributes?: Record<string, AttributeValue> | null, ...children: ViewChild[]): ViewNode {
  const { tag, classes } = parseSelector(selector);
  const node: ViewNode = {
    tag, key: null, classes, attributes: NO_ATTRIBUTES, html: null, text: '', children: [], intent: null, element: null,
  };
  if (attributes) {
    const kept: Record<string, AttributeValue> = {};
    for (const name in attributes) {
      const value = attributes[name];
      if (name === 'key') node.key = value === null || value === undefined ? null : String(value);
      else if (name === 'class') node.classes = value ? `${classes} ${String(value)}`.trim() : classes;
      else if (name === 'html') node.html = String(value);
      else kept[name] = value;
    }
    node.attributes = kept;
  }
  if (node.html === null) appendChildren(node.children, children);
  return node;
}

/** Attach the intent a control sends. */
export function control(node: ViewNode, intent: InterfaceIntent | null): ViewNode {
  node.intent = intent;
  return node;
}

// --- Reconciling ---------------------------------------------------------------

const intents = new WeakMap<Element, InterfaceIntent>();

/** The intent of the control at or above `element`, if any. */
export const intentOf = (element: Element): InterfaceIntent | null => intents.get(element) ?? null;

function apply(element: HTMLElement, previous: ViewNode | null, next: ViewNode): void {
  if (!previous || previous.classes !== next.classes) element.className = next.classes;
  const before = previous ? previous.attributes : NO_ATTRIBUTES;
  const after = next.attributes;
  for (const name in after) {
    if (name === 'value' || name === 'checked') continue;
    const value = after[name];
    if (before[name] === value) continue;
    if (value === null || value === undefined || value === false) element.removeAttribute(name);
    else element.setAttribute(name, value === true ? '' : String(value));
  }
  for (const name in before) {
    if (!(name in after) && name !== 'value' && name !== 'checked') element.removeAttribute(name);
  }
  if (next.intent) intents.set(element, next.intent);
  else if (previous?.intent) intents.delete(element);

  if (next.html !== null) {
    if (!previous || previous.html !== next.html) element.innerHTML = next.html;
  } else {
    if (previous && previous.html !== null) element.innerHTML = '';
    reconcile(element, previous && previous.html === null ? previous.children : [], next.children);
  }

  // The live state of a form control, last: a picker needs its options first.
  // A control the pointer is holding is left alone, so a drag is never fought.
  if ('value' in after) {
    const field = element as HTMLInputElement | HTMLSelectElement;
    const value = String(after.value);
    if (field.value !== value && !field.matches(':active')) field.value = value;
  }
  if ('checked' in after) {
    const box = element as HTMLInputElement;
    const checked = after.checked === true;
    if (box.checked !== checked) box.checked = checked;
  }
}

function create(node: ViewNode): void {
  if (node.tag === '#text') {
    node.element = document.createTextNode(node.text);
    return;
  }
  const element = document.createElement(node.tag);
  node.element = element;
  apply(element, null, node);
}

function update(previous: ViewNode, next: ViewNode): void {
  next.element = previous.element;
  if (next.tag === '#text') {
    if (previous.text !== next.text) (next.element as Text).data = next.text;
    return;
  }
  apply(next.element as HTMLElement, previous, next);
}

/**
 * Make `parent`'s children match `next`, given that they match `previous`.
 * Kept elements are never moved unless their order changed, and never recreated.
 */
export function reconcile(parent: Node, previous: ViewNode[], next: ViewNode[]): void {
  if (previous.length === 0) {
    for (const node of next) {
      create(node);
      parent.appendChild(node.element!);
    }
    return;
  }

  const keyed = new Map<string, ViewNode>();
  const loose: ViewNode[] = [];
  for (const node of previous) {
    if (node.key !== null) keyed.set(`${node.tag}|${node.key}`, node);
    else loose.push(node);
  }
  const matches: (ViewNode | null)[] = [];
  const reused = new Set<ViewNode>();
  let looseIndex = 0;
  for (const node of next) {
    let match: ViewNode | null = null;
    if (node.key !== null) {
      match = keyed.get(`${node.tag}|${node.key}`) ?? null;
      if (match && reused.has(match)) match = null;
    } else {
      while (looseIndex < loose.length && loose[looseIndex]!.tag !== node.tag) looseIndex += 1;
      if (looseIndex < loose.length) {
        match = loose[looseIndex]!;
        looseIndex += 1;
      }
    }
    if (match) reused.add(match);
    matches.push(match);
  }

  // Drop what is gone first, so what stays never has to move around it.
  for (const node of previous) {
    if (!reused.has(node)) node.element?.parentNode?.removeChild(node.element);
  }

  let cursor: ChildNode | null = parent.firstChild;
  for (let index = 0; index < next.length; index += 1) {
    const node = next[index]!;
    const match = matches[index]!;
    if (match) update(match, node);
    else create(node);
    if (cursor !== null && node.element === cursor) cursor = cursor.nextSibling;
    else parent.insertBefore(node.element!, cursor);
  }
}

/** Every intent in a tree of views, in document order. For tests. */
export function collectIntents(nodes: ViewNode[], into: InterfaceIntent[] = []): InterfaceIntent[] {
  for (const node of nodes) {
    if (node.intent) into.push(node.intent);
    collectIntents(node.children, into);
  }
  return into;
}

/** All the text in a tree of views, joined by spaces. For tests. */
export function collectText(nodes: ViewNode[], into: string[] = []): string {
  for (const node of nodes) {
    if (node.tag === '#text') into.push(node.text);
    collectText(node.children, into);
  }
  return into.join(' ');
}
