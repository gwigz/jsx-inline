import type { Options as MinifyOptions } from "html-minifier-terser";
import { evaluateTsxModule, type EvaluatedModule } from "./evaluate";
import { generateTsModule } from "./generate";
import { buildShorteningMap } from "./shorten";

export interface CompileOptions {
  /** Boolean HTML attributes to collapse (e.g. checked="checked" -> checked=""). Default: [] */
  booleanAttrs?: string[];
  /** html-minifier-terser options override */
  minifyOptions?: MinifyOptions;
}

/**
 * Compiles .tsx files to .ts by evaluating JSX at build time,
 * minifying HTML, shortening CSS classes/IDs, and generating
 * optimized string concatenation expressions.
 *
 * Two-phase approach:
 * - Phase A: evaluate all modules, collect minified HTML
 * - Build shortening map from combined HTML
 * - Phase B: apply map + generate .ts for each module
 */
export async function compile(files: string[], options?: CompileOptions): Promise<void> {
  const minifyOptions = options?.minifyOptions;
  const booleanAttrs = options?.booleanAttrs ?? [];

  // Phase A: evaluate all .tsx modules in parallel, collect minified HTML
  const evaluated: EvaluatedModule[] = await Promise.all(
    files.map((tsxPath) => evaluateTsxModule(tsxPath, minifyOptions)),
  );

  // Build shortening map from all combined HTML (including inline JSX)
  const htmlParts: string[] = [];

  for (const e of evaluated) {
    for (const v of Object.values(e.fnHtml)) htmlParts.push(v);
    for (const v of Object.values(e.varHtml)) htmlParts.push(v);
    for (const d of e.inlineJsxData) for (const entry of d.entries) htmlParts.push(entry.html);
  }

  const map = buildShorteningMap(htmlParts.join(""), booleanAttrs);

  // Phase B: apply shortening map and generate .ts files
  for (const mod of evaluated) {
    generateTsModule(mod, map);
  }
}
