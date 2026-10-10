import assert from "node:assert/strict";
import { test } from "node:test";
import { retargetLink, retargetLinks } from "../src/core/retarget.ts";
import { folderStubText, parseFolderStub, parseStub, stubText } from "../src/core/stubs.ts";

test("links to a file point at another, keeping their place and text", () => {
  const at = (original: string, link: string) => ({ start: 0, end: original.length, original, link });
  assert.equal(retargetLink(at("[[JHN.usx#v=1:2&color=yellow|John, 1]]", "JHN.usx#v=1:2&color=yellow"), "John.bible"), "[[John.bible#v=1:2&color=yellow|John, 1]]");
  assert.equal(retargetLink(at("![[JHN.usx#v=3:16]]", "JHN.usx#v=3:16"), "USX_1/John.bible"), "![[USX_1/John.bible#v=3:16]]");
  assert.equal(retargetLink(at("[[JHN.usx]]", "JHN.usx"), "1 John.bible"), "[[1 John.bible]]");
  // Markdown links are encoded
  assert.equal(retargetLink(at("[x](1JN.usx#v=1:1)", "1JN.usx#v=1:1"), "1 John.bible"), "[x](1%20John.bible#v=1:1)");
  assert.equal(retargetLink(at("[x](Bibles/My%20Bible/JHN.usx)", "Bibles/My Bible/JHN.usx"), "Bibles/My Bible/John.bible"), "[x](Bibles/My%20Bible/John.bible)");
  // Not where the link says it is: left alone
  assert.equal(retargetLink(at("[[Other.usx]]", "JHN.usx"), "John.bible"), null);
});

test("a note's links and properties are changed, others stay", () => {
  const text = '---\nbible: "[[JHN.usx]]"\n---\n\n> [[JHN.usx#v=1:1|John 1]]\n\n[[MAT.usx#v=1:1]] and [[JHN.usx#v=3:16]]\n';
  const links = [
    { start: null, end: null, original: "[[JHN.usx]]", link: "JHN.usx" },
    { start: text.indexOf("[[JHN.usx#v=1:1"), end: text.indexOf("[[JHN.usx#v=1:1") + "[[JHN.usx#v=1:1|John 1]]".length, original: "[[JHN.usx#v=1:1|John 1]]", link: "JHN.usx#v=1:1" },
    { start: text.indexOf("[[JHN.usx#v=3:16"), end: text.indexOf("[[JHN.usx#v=3:16") + "[[JHN.usx#v=3:16]]".length, original: "[[JHN.usx#v=3:16]]", link: "JHN.usx#v=3:16" },
    // Stale: the text there changed since
    { start: 0, end: 5, original: "[[JHN.usx]]", link: "JHN.usx" },
  ];
  const { text: next, changed } = retargetLinks(text, links, "John.bible");
  assert.equal(changed, 3);
  assert.equal(next, '---\nbible: "[[John.bible]]"\n---\n\n> [[John.bible#v=1:1|John 1]]\n\n[[MAT.usx#v=1:1]] and [[John.bible#v=3:16]]\n');
});

test("a folder Bible's stub names its file beside it, and isn't a package's", () => {
  assert.equal(parseFolderStub(folderStubText("JHN.usx")), "JHN.usx");
  assert.equal(parseFolderStub(stubText({ package: "bsb", path: "usx/JHN.usx" })), null);
  assert.equal(parseStub(folderStubText("JHN.usx")), null);
  assert.equal(parseFolderStub('{"file":"../x.usx"}'), null);
  assert.equal(parseFolderStub("<usx>"), null);
});
