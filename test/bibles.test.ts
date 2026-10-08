import assert from "node:assert/strict";
import { test } from "node:test";
import { codeFromName, codeFromUsx, groupBibles } from "../src/core/bibles.ts";

const codes = new Set(["JHN", "1CO", "PSA"]);

test("book files are found by name, as publishers name them", () => {
  assert.equal(codeFromName("JHN", codes), "JHN");
  assert.equal(codeFromName("jhn", codes), "JHN");
  // Paratext: book number, code, project
  assert.equal(codeFromName("44JHNBSB", codes), "JHN");
  assert.equal(codeFromName("47-1CO", codes), "1CO");
  assert.equal(codeFromName("B04___01_John", codes), null);
  assert.equal(codeFromUsx('<?xml version="1.0"?>\n<usx version="3.0">\n  <book code="JHN" style="id">x</book>'), "JHN");
  assert.equal(codeFromUsx("<usx></usx>"), null);
});

test("each folder of USX files is a Bible", () => {
  const ids = new Map([["JHN", 43], ["PSA", 19]]);
  const file = (path: string) => ({ path, basename: path.split("/").pop()!.replace(/\.usx$/, ""), folder: path.split("/").slice(0, -1).join("/") });
  const bibles = groupBibles(["Bibles/WEB/JHN.usx", "Bibles/BSB/jhn.usx", "Bibles/BSB/PSA.usx", "Bibles/BSB/intro.usx"].map(file), ids);
  assert.deepEqual(
    bibles.map((b) => [b.name, [...b.books], b.unknown]),
    [
      ["BSB", [[43, "Bibles/BSB/jhn.usx"], [19, "Bibles/BSB/PSA.usx"]], ["Bibles/BSB/intro.usx"]],
      ["WEB", [[43, "Bibles/WEB/JHN.usx"]], []],
    ],
  );
});
