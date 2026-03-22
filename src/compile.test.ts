import { describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { compile } from "./index";

const FIXTURES_DIR = resolve(import.meta.dir, "__fixtures__");

function setupFixture(name: string): { file: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "jsx-inline-test-"));
  const src = join(FIXTURES_DIR, `${name}.tsx`);
  const dest = join(dir, `${name}.tsx`);
  cpSync(src, dest);
  return { file: dest, dir };
}

function readOutput(dir: string, name: string): string {
  return readFileSync(join(dir, `${name}.ts`), "utf-8");
}

describe("compile", () => {
  test("basic template, JSX becomes string concatenation", async () => {
    const { file, dir } = setupFixture("basic");

    try {
      await compile([file]);

      expect(readOutput(dir, "basic")).toMatchInlineSnapshot(`
"export function greeting(name: string) {
    return "<div><h1>Hello, " + name + "!</h1></div>";
}
"
`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("classes/IDs, CSS class names and IDs are shortened", async () => {
    const { file, dir } = setupFixture("classes");

    try {
      await compile([file]);

      expect(readOutput(dir, "classes")).toMatchInlineSnapshot(`
"export function styledBox(content: string) {
    return "<div><style>.a{color:red}.b{font-weight:700}</style><div class=\\"a\\" id=\\"a\\"><span class=\\"b\\">" + content + "</span></div></div>";
}
"
`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("inline JSX, JSX inside non-template functions is compiled", async () => {
    const { file, dir } = setupFixture("inline");

    try {
      await compile([file]);

      expect(readOutput(dir, "inline")).toMatchInlineSnapshot(`
"export function conditionalRender(show: boolean, label: string) {
  const items: string[] = [];
  if (show) {
    items.push(("<p>" + label + "</p>"));
  }
  return items.join("");
}
"
`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("dynamic boolean attrs, pure template conditionally includes checked", async () => {
    const { file, dir } = setupFixture("boolean-dynamic");

    try {
      await compile([file]);

      expect(readOutput(dir, "boolean-dynamic")).toMatchInlineSnapshot(`
"export function dynamicCheckbox(label: string, enabled: boolean) {
    return "<form><input type=\\"checkbox\\"" + (enabled ? ' checked=""' : "") + "/><label>" + label + "</label></form>";
}
"
`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("dynamic boolean attrs, inline JSX conditionally includes checked", async () => {
    const { file, dir } = setupFixture("boolean-inline");

    try {
      await compile([file]);

      expect(readOutput(dir, "boolean-inline")).toMatchInlineSnapshot(`
"export function toggleRow(name: string, active: boolean) {
  const rows: string[] = [];
  rows.push(("<input type=\\"checkbox\\"" + (active ? ' checked=""' : "") + " name=\\"" + name + "\\"/>"));
  return rows.join("");
}
"
`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("static boolean attrs, checked={true} renders checked attribute", async () => {
    const { file, dir } = setupFixture("boolean");

    try {
      await compile([file]);

      expect(readOutput(dir, "boolean")).toMatchInlineSnapshot(`
"export function checkboxForm(name: string) {
    return "<form><input type=\\"checkbox\\" checked=\\"\\" name=\\"" + name + "\\"/><label>" + name + "</label></form>";
}
"
`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
