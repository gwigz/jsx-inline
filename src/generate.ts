import { writeFileSync } from "node:fs";
import { SLOT_PATTERN } from "./evaluate";
import type { EvaluatedModule } from "./evaluate";
import type { ShorteningMap } from "./shorten";
import { applyShorteningMap } from "./shorten";

/** Returns indices of slots whose predicate returns true. */
function detectBooleanSlots(slotNames: string[], isBoolean: (name: string) => boolean): Set<number> {
  const result = new Set<number>();
  for (let i = 0; i < slotNames.length; i++) {
    if (isBoolean(slotNames[i])) result.add(i);
  }
  return result;
}

/** Builds a string-concat expression from segments and slot values. */
function buildConcatExpr(segments: string[], slotValues: string[], booleanSlots = new Set<number>()): string {
  const segs = booleanSlots.size > 0 ? [...segments] : segments;
  const vals = booleanSlots.size > 0 ? [...slotValues] : slotValues;

  // Rewrite boolean-typed slots: ` attr="` + val + `"` → (val ? ' attr=""' : "")
  for (const i of booleanSlots) {
    const match = segs[i].match(/ ([a-z-]+)="$/);
    if (match && segs[i + 1].startsWith('"')) {
      const attr = match[1];
      segs[i] = segs[i].slice(0, -match[0].length);
      segs[i + 1] = segs[i + 1].slice(1);
      vals[i] = `(${vals[i]} ? ' ${attr}=""' : "")`;
    }
  }

  let expr = JSON.stringify(segs[0]);

  for (let i = 0; i < vals.length; i++) {
    expr += ` + ${vals[i]} + ${JSON.stringify(segs[i + 1])}`;
  }

  return expr;
}

/** Splits HTML on slot markers into segment arrays. */
function splitFragment(name: string, html: string) {
  const parts = html.split(SLOT_PATTERN);
  const segments: string[] = [];
  const slotNames: string[] = [];

  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      segments.push(parts[i]);
    } else {
      slotNames.push(parts[i]);
    }
  }

  for (const seg of segments) {
    if (/__SLOT_/.test(seg)) {
      throw new Error(`Fragment "${name}" has residual slot markers`);
    }
  }

  return { segments, slotNames };
}

/**
 * Generates a .ts file from an evaluated .tsx module.
 *
 * Phase B: applies shortening map to minified HTML, splits on slot markers,
 * builds string-concat expressions, and writes the .ts output.
 */
export function generateTsModule(evaluated: EvaluatedModule, map: ShorteningMap) {
  const { tsxPath, source, templateFns, templateVars, depStmts, fnHtml, varHtml, inlineJsxData } = evaluated;

  // 1. Apply shortening + compile function templates
  for (const fn of templateFns) {
    const fnName = fn.getName()!;
    const html = applyShorteningMap(fnHtml[fnName], map);
    const { segments, slotNames } = splitFragment(fnName, html);

    const booleanSlots = detectBooleanSlots(slotNames, (n) => fn.getParameter(n)?.getType().isBoolean() ?? false);

    fn.setBodyText(`return ${buildConcatExpr(segments, slotNames, booleanSlots)};`);
  }

  // 2. Apply shortening + compile const templates
  for (const decl of templateVars) {
    const html = applyShorteningMap(varHtml[decl.getName()], map);
    decl.setInitializer(JSON.stringify(html));
  }

  // 3. Compile inline JSX expressions (reverse source order to preserve positions)
  for (const { fn, entries } of inlineJsxData) {
    const fnName = fn.getName()!;
    const booleanParams = new Set(
      fn
        .getParameters()
        .filter((p) => p.getType().isBoolean())
        .map((p) => p.getName()),
    );
    const reversedEntries = entries.toSorted((a, b) => b.jsxNode.getStart() - a.jsxNode.getStart());

    for (const entry of reversedEntries) {
      const html = applyShorteningMap(entry.html, map);
      const { segments, slotNames } = splitFragment(`inline_${fnName}`, html);

      const slotLookup = new Map(entry.slots.map((s) => [s.name, s.originalText]));
      const slotValues = slotNames.map((n) => {
        const v = slotLookup.get(n);
        if (v === undefined) throw new Error(`No slot value for marker __SLOT_${n}__`);
        return v;
      });

      const booleanSlots = detectBooleanSlots(slotNames, (n) => {
        const text = slotLookup.get(n);
        return text !== undefined && booleanParams.has(text);
      });

      entry.jsxNode.replaceWithText(`(${buildConcatExpr(segments, slotValues, booleanSlots)})`);
    }
  }

  // 4. Remove dependency-only variable statements (consumed at build time)
  for (const stmt of depStmts) {
    stmt.remove();
  }

  // 5. Remove JSX imports + pragmas
  source
    .getImportDeclarations()
    .filter((imp) => imp.getModuleSpecifierValue().includes("/jsx"))
    .forEach((imp) => imp.remove());

  let output = source.getFullText();
  output = output.replace(/\/\*\*\s*@jsx\s+\w+\s*\*\/\s*\n?/g, "");
  output = output.replace(/\/\*\*\s*@jsxFrag\s+\w+\s*\*\/\s*\n?/g, "");

  writeFileSync(tsxPath.replace(/\.tsx$/, ".ts"), output);
}
