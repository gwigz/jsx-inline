/** Generates short CSS class names: a, b, ..., z, aa, ab, ... */
function shortClassName(i: number) {
  if (i < 26) {
    return String.fromCharCode(97 + i);
  }

  const first = Math.floor((i - 26) / 26);
  const second = (i - 26) % 26;

  return String.fromCharCode(97 + first) + String.fromCharCode(97 + second);
}

/** Sorts names longest-first and pairs each with a short generated name. */
function buildPairs(names: Set<string>): [string, string][] {
  return [...names]
    .toSorted((a, b) => b.length - a.length || a.localeCompare(b))
    .map((name, i) => [name, shortClassName(i)]);
}

export interface ShorteningMap {
  classes: [string, string][];
  ids: [string, string][];
  booleanAttrs: string[];
}

/**
 * Builds a shortening map from concatenated HTML strings.
 * Extracts CSS class names, element IDs, and boolean attributes to collapse.
 */
export function buildShorteningMap(allHtml: string, booleanAttrs: string[] = []): ShorteningMap {
  // 1. CSS class names from all <style> blocks
  const classNames = new Set<string>();

  for (const styleMatch of allHtml.matchAll(/<style>([\s\S]*?)<\/style>/g)) {
    for (const match of styleMatch[1].matchAll(/\.([a-z][a-z0-9-]*)/g)) {
      classNames.add(match[1]);
    }
  }

  // 2. Element IDs from id="..."
  const idSet = new Set<string>();

  for (const idMatch of allHtml.matchAll(/id="([a-z][a-z-]+)"/g)) {
    idSet.add(idMatch[1]);
  }

  return { classes: buildPairs(classNames), ids: buildPairs(idSet), booleanAttrs };
}

/**
 * Applies all shortening transformations to an HTML string.
 * Safe to call on any fragment, patterns that don't match are no-ops.
 */
export function applyShorteningMap(html: string, map: ShorteningMap): string {
  // 1. Shorten CSS class names (longest-first to avoid substring collisions)
  for (const [long, short] of map.classes) {
    html = html.replaceAll(long, short);
  }

  // 2. Shorten element IDs and their references (e.g. hx-target="#id")
  for (const [long, short] of map.ids) {
    html = html.replaceAll(`id="${long}"`, `id="${short}"`);
    html = html.replaceAll(`#${long}`, `#${short}`);

    // Also update JS references via global named element access (window.id).
    // Covers onclick="id.method()" and x-on:click="...;id.method()".
    // Only applies to IDs that are valid JS identifiers (no hyphens).
    if (!long.includes("-")) {
      for (const prefix of ['"', "'", ";", "(", ","]) {
        html = html.replaceAll(`${prefix}${long}.`, `${prefix}${short}.`);
      }
    }
  }

  // 3. Collapse boolean attributes (checked="checked" -> checked="")
  for (const attr of map.booleanAttrs) {
    html = html.replaceAll(`${attr}="${attr}"`, `${attr}=""`);
  }

  return html;
}
