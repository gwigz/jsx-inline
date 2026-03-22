# `@gwigz/jsx-inline`

Compile JSX templates into optimized inline string literals at build time. No runtime, no virtual DOM, just concatenated strings.

Write your markup with JSX for type safety and composability, then run `compile()` as a build step. It evaluates each `.tsx` file, minifies the HTML, shortens CSS class names, and outputs a plain `.ts` file with string concatenation in place of every JSX expression.

## When is this useful?

When your target environment doesn't have a DOM or JSX runtime, but you still want to author HTML with JSX. This is especially handy for [TypeScriptToLua](https://github.com/TypeScriptToLua/TypeScriptToLua) projects that need to embed markup in Lua strings, you get the ergonomics of JSX during development and compact string output in the compiled result.

## Install

```sh
bun add -D @gwigz/jsx-inline
# or
npm install -D @gwigz/jsx-inline
```

## Setup

Configure JSX in your `tsconfig.json`:

```diff
{
  "compilerOptions": {
+   "jsx": "react",
+   "jsxFactory": "h",
+   "jsxFragmentFactory": "Fragment"
  }
}
```

## Usage

Call `compile()` in your build script before transpilation:

```ts
import { compile } from "@gwigz/jsx-inline";

await compile(["src/template.tsx", "src/ui.tsx"], {
  booleanAttrs: ["checked", "defer"],
});
```

This reads each `.tsx` file, evaluates the JSX, and writes a corresponding `.ts` file with all markup replaced by string literals. Run your normal build step after.

## Options

| Option          | Type       | Default | Description                                                                             |
| --------------- | ---------- | ------- | --------------------------------------------------------------------------------------- |
| `booleanAttrs`  | `string[]` | `[]`    | HTML attributes to collapse (e.g. `checked=""`)                                         |
| `minifyOptions` | `object`   |         | Override [html-minifier-terser](https://github.com/terser/html-minifier-terser) options |

## Example

Given a template:

```tsx
// @jsx h
export function pageShell(title: string) {
  return (
    <html>
      <head>
        <title>{title}</title>
      </head>
      <body>
        <h1>{title}</h1>
      </body>
    </html>
  );
}
```

After `compile()`, the generated `.ts` file contains:

```ts
export function pageShell(title: string) {
  return "<html><head><title>" + title + "</title></head><body><h1>" + title + "</h1></body></html>";
}
```

CSS classes and IDs are shortened across all files (`toolbar` → `a`, `status` → `b`, etc.) to minimize output size.

## How it works

1. **Evaluate** parses each `.tsx` with [ts-morph](https://github.com/dsherret/ts-morph), detects template functions and inline JSX, evaluates them with an embedded minimal JSX runtime, and minifies the resulting HTML
2. **Shorten** builds a shortening map from all combined HTML, replacing CSS class names and IDs with single-letter equivalents
3. **Generate** replaces each JSX node in the AST with a string concatenation expression, splicing dynamic values back in at their original positions
