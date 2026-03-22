import { minify, type Options as MinifyOptions } from "html-minifier-terser";
import { Node, Project, SyntaxKind } from "ts-morph";
import { basename, dirname, resolve } from "node:path";
import { writeFileSync, unlinkSync } from "node:fs";

/** Slot marker pattern for splitting compiled HTML into segments. */
export const SLOT_PATTERN = /__SLOT_([a-zA-Z0-9_]+)__/;

/** Default html-minifier-terser options (XHTML-safe). */
export const DEFAULT_MINIFY_OPTIONS: MinifyOptions = {
  collapseWhitespace: true,
  removeComments: true,
  minifyCSS: true,
  minifyJS: { output: { comments: /CDATA|\]\]>/ } },
  keepClosingSlash: true,
};

/** Inlined JSX runtime prepended to build-time temp files. */
const JSX_RUNTIME = `/** @jsx h */
/** @jsxFrag Fragment */
const VOID_TAGS = new Set(["area","base","br","col","embed","hr","img","input","link","meta","source","track","wbr"]);
function escapeHtml(value) { return value.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;"); }
function renderChildren(children) { let result = ""; for (const child of children) { if (child === null || child === undefined || child === false || child === true) continue; if (Array.isArray(child)) { result += renderChildren(child); } else { result += String(child); } } return result; }
function h(tag, props, ...children) { if (typeof tag === "function") return tag({ ...props, children: children.length === 1 ? children[0] : children }); let html = "<" + tag; if (props) { for (const [key, value] of Object.entries(props)) { if (key === "children") continue; if (value === null || value === undefined || value === false) continue; if (value === true) html += " " + key; else html += " " + key + '="' + escapeHtml(String(value)) + '"'; } } if (VOID_TAGS.has(tag)) return html + " />"; html += ">"; html += renderChildren(children); return html + "</" + tag + ">"; }
function Fragment({ children }) { if (children == null) return ""; if (Array.isArray(children)) return renderChildren(children); return String(children); }
`;

interface SlotInfo {
  name: string;
  originalText: string;
  marker: string;
  pos: number;
  end: number;
}

interface InlineJsxEntry {
  jsxNode: Node;
  slots: SlotInfo[];
  html: string;
}

interface InlineJsxFunction {
  fn: import("ts-morph").FunctionDeclaration;
  entries: InlineJsxEntry[];
}

export interface EvaluatedModule {
  tsxPath: string;
  source: import("ts-morph").SourceFile;
  templateFns: import("ts-morph").FunctionDeclaration[];
  templateVars: import("ts-morph").VariableDeclaration[];
  depStmts: import("ts-morph").VariableStatement[];
  fnHtml: Record<string, string>;
  varHtml: Record<string, string>;
  inlineJsxData: InlineJsxFunction[];
}

/** Returns true if a ts-morph node is or contains any JSX elements or fragments. */
function hasJsx(node: Node): boolean {
  const kind = node.getKind();

  if (kind === SyntaxKind.JsxElement || kind === SyntaxKind.JsxSelfClosingElement || kind === SyntaxKind.JsxFragment) {
    return true;
  }

  return (
    node.getFirstDescendantByKind(SyntaxKind.JsxElement) !== undefined ||
    node.getFirstDescendantByKind(SyntaxKind.JsxSelfClosingElement) !== undefined ||
    node.getFirstDescendantByKind(SyntaxKind.JsxFragment) !== undefined
  );
}

/** Returns true if a node is a JSX element, self-closing element, or fragment (unwraps parens). */
function isJsxNode(node: Node): boolean {
  if (Node.isParenthesizedExpression(node)) {
    return isJsxNode(node.getExpression());
  }

  const kind = node.getKind();

  return kind === SyntaxKind.JsxElement || kind === SyntaxKind.JsxSelfClosingElement || kind === SyntaxKind.JsxFragment;
}

/** Returns true if a function body is exactly one return statement whose expression is JSX. */
function isPureTemplate(fn: Node): boolean {
  if (!Node.isFunctionDeclaration(fn)) return false;

  const body = fn.getBody();

  if (!body || !Node.isBlock(body)) return false;

  const stmts = body.getStatements();

  if (stmts.length !== 1 || !Node.isReturnStatement(stmts[0])) return false;

  const expr = stmts[0].getExpression();

  return expr !== undefined && isJsxNode(expr);
}

/** Returns true for literals, static object/array literals, and parenthesized static expressions. */
function isStaticExpression(node: Node): boolean {
  const kind = node.getKind();

  if (
    kind === SyntaxKind.StringLiteral ||
    kind === SyntaxKind.NumericLiteral ||
    kind === SyntaxKind.NoSubstitutionTemplateLiteral ||
    kind === SyntaxKind.NullKeyword ||
    kind === SyntaxKind.TrueKeyword ||
    kind === SyntaxKind.FalseKeyword
  ) {
    return true;
  }

  if (Node.isParenthesizedExpression(node)) {
    return isStaticExpression(node.getExpression());
  }

  if (Node.isObjectLiteralExpression(node)) {
    return node.getProperties().every((prop) => {
      if (!Node.isPropertyAssignment(prop)) return false;
      const init = prop.getInitializer();
      return init !== undefined && isStaticExpression(init);
    });
  }

  if (Node.isArrayLiteralExpression(node)) {
    return node.getElements().every((el) => isStaticExpression(el));
  }

  return false;
}

/** Walks a function body and collects root-level JSX nodes (not nested inside other JSX). */
function collectInlineJsxNodes(fn: import("ts-morph").FunctionDeclaration): Node[] {
  const body = fn.getBody();

  if (!body) return [];

  const roots: Node[] = [];

  body.forEachDescendant((node, traversal) => {
    const kind = node.getKind();

    if (
      kind === SyntaxKind.JsxElement ||
      kind === SyntaxKind.JsxSelfClosingElement ||
      kind === SyntaxKind.JsxFragment
    ) {
      roots.push(node);
      traversal.skip();
    }
  });

  return roots;
}

/** Finds dynamic expressions in a JSX tree and returns slot info for each. */
function extractDynamicSlots(jsxNode: Node, startIndex: number): SlotInfo[] {
  const slots: SlotInfo[] = [];
  let index = startIndex;

  for (const jsxExpr of jsxNode.getDescendantsOfKind(SyntaxKind.JsxExpression)) {
    const inner = jsxExpr.getExpression();

    if (!inner || isStaticExpression(inner)) continue;

    const name = String(index);

    slots.push({
      name,
      originalText: inner.getText(),
      marker: `__SLOT_${name}__`,
      pos: inner.getStart(),
      end: inner.getEnd(),
    });

    index++;
  }

  for (const spread of jsxNode.getDescendantsOfKind(SyntaxKind.JsxSpreadAttribute)) {
    const expr = spread.getExpression();

    if (!Node.isObjectLiteralExpression(expr)) continue;

    for (const prop of expr.getProperties()) {
      if (!Node.isPropertyAssignment(prop)) continue;

      const init = prop.getInitializer();

      if (!init || isStaticExpression(init)) continue;

      const name = String(index);

      slots.push({
        name,
        originalText: init.getText(),
        marker: `__SLOT_${name}__`,
        pos: init.getStart(),
        end: init.getEnd(),
      });

      index++;
    }
  }

  return slots;
}

/** Produces JSX text with dynamic expressions replaced by slot markers (right-to-left). */
function buildMarkedJsxText(jsxNode: Node, slots: SlotInfo[]): string {
  let text = jsxNode.getText();
  const jsxStart = jsxNode.getStart();
  const sorted = slots.toSorted((a, b) => b.pos - a.pos);

  for (const slot of sorted) {
    const relStart = slot.pos - jsxStart;
    const relEnd = slot.end - jsxStart;

    text = text.substring(0, relStart) + `"${slot.marker}"` + text.substring(relEnd);
  }

  return text;
}

/**
 * Evaluates a single .tsx file at build time, returning minified HTML strings
 * and AST references for later code generation.
 *
 * Phase A: auto-detects template declarations, evaluates JSX via Bun,
 * and minifies the resulting HTML.
 */
export async function evaluateTsxModule(tsxPath: string, minifyOptions?: MinifyOptions): Promise<EvaluatedModule> {
  const minifyHtml = (html: string) => minify(html, minifyOptions ?? DEFAULT_MINIFY_OPTIONS);

  const project = new Project({ compilerOptions: { jsx: 2 /* React */ } });
  const source = project.addSourceFileAtPath(tsxPath);

  // 1. Auto-detect template declarations by JSX content
  const templateFns = source.getFunctions().filter((fn) => isPureTemplate(fn));
  const inlineJsxFns = source.getFunctions().filter((fn) => hasJsx(fn) && !isPureTemplate(fn));
  const templateVars = source.getVariableDeclarations().filter((decl) => {
    const init = decl.getInitializer();
    return init !== undefined && hasJsx(init);
  });

  // 2. Detect dependency consts (scoped to pure template functions only)
  const templateCode = [
    ...templateFns.map((fn) => fn.getText()),
    ...templateVars.map((decl) => decl.getInitializer()!.getText()),
  ].join("\n");

  const depStmts = source.getVariableStatements().filter((stmt) => {
    const decls = stmt.getDeclarations();

    if (
      decls.some((d) => {
        const init = d.getInitializer();
        return init && hasJsx(init);
      })
    ) {
      return false;
    }
    return decls.some((d) => new RegExp(`\\b${d.getName()}\\b`).test(templateCode));
  });

  // 3. Build temp file: JSX runtime + dependencies + template wrappers
  const tempLines = [JSX_RUNTIME];

  for (const stmt of depStmts) {
    tempLines.push(stmt.getText());
  }

  for (const fn of templateFns) {
    const name = fn.getName()!;
    const paramNames = fn.getParameters().map((p) => p.getName());

    tempLines.push(fn.getText());

    const markerArgs = paramNames.map((p) => `"__SLOT_${p}__"`).join(", ");

    tempLines.push(`export const __${name} = ${name}(${markerArgs});`);
  }

  for (const decl of templateVars) {
    const stmt = decl.getVariableStatement()!;
    const text = stmt.getText();

    tempLines.push(text.startsWith("export") ? text : "export " + text);
  }

  // Collect inline JSX data and add wrappers to temp file
  const inlineJsxData: InlineJsxFunction[] = [];

  for (const fn of inlineJsxFns) {
    const jsxNodes = collectInlineJsxNodes(fn);
    const entries: InlineJsxEntry[] = [];
    let slotCounter = 0;

    for (const jsxNode of jsxNodes) {
      const slots = extractDynamicSlots(jsxNode, slotCounter);
      slotCounter += slots.length;
      entries.push({ jsxNode, slots, html: "" });
    }

    const fnName = fn.getName()!;

    for (let i = 0; i < entries.length; i++) {
      const markedText = buildMarkedJsxText(entries[i].jsxNode, entries[i].slots);
      tempLines.push(`export const __inline_${fnName}_${i} = ${markedText};`);
    }

    inlineJsxData.push({ fn, entries });
  }

  const name = basename(tsxPath, ".tsx");
  const tempPath = resolve(dirname(tsxPath), `.${name}-templates.tsx`);

  writeFileSync(tempPath, tempLines.join("\n"));

  const fnHtml: Record<string, string> = {};
  const varHtml: Record<string, string> = {};

  try {
    delete require.cache[tempPath];

    const mod = require(tempPath);

    // 4. Evaluate and minify all HTML in parallel
    const minifyTasks: Promise<void>[] = [];

    for (const fn of templateFns) {
      const fnName = fn.getName()!;
      minifyTasks.push(
        minifyHtml(mod[`__${fnName}`]).then((html) => {
          fnHtml[fnName] = html;
        }),
      );
    }

    for (const decl of templateVars) {
      const declName = decl.getName();
      minifyTasks.push(
        minifyHtml(mod[declName]).then((html) => {
          varHtml[declName] = html;
        }),
      );
    }

    for (const { fn, entries } of inlineJsxData) {
      const fnName = fn.getName()!;

      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        minifyTasks.push(
          minifyHtml(mod[`__inline_${fnName}_${i}`]).then((html) => {
            entry.html = html;
          }),
        );
      }
    }

    await Promise.all(minifyTasks);
  } finally {
    unlinkSync(tempPath);
  }

  return { tsxPath, source, templateFns, templateVars, depStmts, fnHtml, varHtml, inlineJsxData };
}
