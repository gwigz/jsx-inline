import { describe, expect, test } from "bun:test";
import { buildShorteningMap, applyShorteningMap } from "./shorten";

describe("buildShorteningMap", () => {
  test("extracts class names from style blocks", () => {
    const html = `<style>.container { color: red } .title { font-weight: bold }</style>
      <div class="container"><span class="title">hi</span></div>`;

    const map = buildShorteningMap(html);

    expect(map.classes).toMatchInlineSnapshot(`
[
  [
    "container",
    "a",
  ],
  [
    "title",
    "b",
  ],
]
`);
    expect(map.ids).toMatchInlineSnapshot(`[]`);
  });

  test("extracts IDs from id attributes", () => {
    const html = `<div id="main-box"><span id="sub-item">hi</span></div>`;
    const map = buildShorteningMap(html);

    expect(map.ids).toMatchInlineSnapshot(`
[
  [
    "main-box",
    "a",
  ],
  [
    "sub-item",
    "b",
  ],
]
`);
    expect(map.classes).toMatchInlineSnapshot(`[]`);
  });

  test("sorts longest names first", () => {
    const html = `<style>.a-very-long-name { } .mid-name { } .x { }</style>`;
    const map = buildShorteningMap(html);

    expect(map.classes).toMatchInlineSnapshot(`
[
  [
    "a-very-long-name",
    "a",
  ],
  [
    "mid-name",
    "b",
  ],
  [
    "x",
    "c",
  ],
]
`);
  });

  test("extracts class names from HTML class attributes", () => {
    const html = `<div class="obj-group"><div class="obj-header">hi</div></div>`;
    const map = buildShorteningMap(html);

    expect(map.classes).toMatchInlineSnapshot(`
[
  [
    "obj-header",
    "a",
  ],
  [
    "obj-group",
    "b",
  ],
]
`);
  });

  test("merges class names from style blocks and HTML attributes", () => {
    const html = `<style>.styled { color: red }</style><div class="styled"><div class="js-only">hi</div></div>`;
    const map = buildShorteningMap(html);

    expect(map.classes).toMatchInlineSnapshot(`
[
  [
    "js-only",
    "a",
  ],
  [
    "styled",
    "b",
  ],
]
`);
  });

  test("passes through booleanAttrs", () => {
    const map = buildShorteningMap("<div></div>", ["checked", "disabled"]);
    expect(map.booleanAttrs).toEqual(["checked", "disabled"]);
  });
});

describe("applyShorteningMap", () => {
  test("replaces class names in HTML", () => {
    const html = `<style>.container{color:red}.title{font-weight:bold}</style><div class="container"><span class="title">hi</span></div>`;
    const map = {
      classes: [
        ["container", "a"],
        ["title", "b"],
      ] as [string, string][],
      ids: [],
      booleanAttrs: [],
    };

    expect(applyShorteningMap(html, map)).toMatchInlineSnapshot(
      `"<style>.a{color:red}.b{font-weight:bold}</style><div class="a"><span class="b">hi</span></div>"`,
    );
  });

  test("replaces IDs and #id references", () => {
    const html = `<div id="main-box" hx-target="#main-box">content</div>`;
    const map = {
      classes: [],
      ids: [["main-box", "a"]] as [string, string][],
      booleanAttrs: [],
    };

    expect(applyShorteningMap(html, map)).toMatchInlineSnapshot(`"<div id="a" hx-target="#a">content</div>"`);
  });

  test("collapses boolean attributes", () => {
    const html = `<input checked="checked" disabled="disabled" />`;
    const map = {
      classes: [],
      ids: [],
      booleanAttrs: ["checked", "disabled"],
    };

    expect(applyShorteningMap(html, map)).toMatchInlineSnapshot(`"<input checked="" disabled="" />"`);
  });

  test("replaces JS references to element IDs via global named access", () => {
    const html = `<button onclick="fd.showModal()">Open</button><dialog id="fd">content</dialog>`;
    const map = {
      classes: [],
      ids: [["fd", "a"]] as [string, string][],
      booleanAttrs: [],
    };

    expect(applyShorteningMap(html, map)).toMatchInlineSnapshot(
      `"<button onclick="a.showModal()">Open</button><dialog id="a">content</dialog>"`,
    );
  });

  test("replaces JS references after semicolons", () => {
    const html = `<button x-on:click="x='';fd.close()">Cancel</button><dialog id="fd">content</dialog>`;
    const map = {
      classes: [],
      ids: [["fd", "a"]] as [string, string][],
      booleanAttrs: [],
    };

    expect(applyShorteningMap(html, map)).toMatchInlineSnapshot(
      `"<button x-on:click="x='';a.close()">Cancel</button><dialog id="a">content</dialog>"`,
    );
  });

  test("does not replace JS references for hyphenated IDs", () => {
    const html = `<button onclick="test">click</button><div id="my-dialog">content</div>`;
    const map = {
      classes: [],
      ids: [["my-dialog", "a"]] as [string, string][],
      booleanAttrs: [],
    };

    expect(applyShorteningMap(html, map)).toMatchInlineSnapshot(
      `"<button onclick="test">click</button><div id="a">content</div>"`,
    );
  });

  test("handles combined classes, IDs, and boolean attrs", () => {
    const html = `<style>.wrapper{margin:0}</style><div class="wrapper" id="root"><input checked="checked" /></div><a href="#root">link</a>`;
    const map = {
      classes: [["wrapper", "a"]] as [string, string][],
      ids: [["root", "b"]] as [string, string][],
      booleanAttrs: ["checked"],
    };

    expect(applyShorteningMap(html, map)).toMatchInlineSnapshot(
      `"<style>.a{margin:0}</style><div class="a" id="b"><input checked="" /></div><a href="#b">link</a>"`,
    );
  });
});
