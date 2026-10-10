import { PackageKind, type CatalogEntry } from "logoxide";

/** What a package kind is called (`book`, `collection`, `commentary`) */
export function kindName(kind: PackageKind): string {
  const name = Object.entries(PackageKind).find(([, value]) => value === kind)?.[0] ?? "";
  return name.replace(/(?<!^)([A-Z])/g, " $1").toLowerCase();
}

/** A license in words: public domain, else the copyright statement or SPDX expression */
export function license(entry: CatalogEntry, max = 60): string {
  if (entry.license === "LicenseRef-PublicDomain") return "public domain";
  // CCEL's list doesn't say: each file's head does, read when it's imported
  if (!entry.license && entry.source.tag === "Ccel") return "rights in its file";
  const copyright = entry.copyright?.trim();
  if (copyright) return copyright.length > max ? `${copyright.slice(0, max - 1)}…` : copyright;
  return entry.license ?? "no license given";
}

/** An entry's language in words; CCEL's list doesn't give languages (`und`): its files do, when imported */
export function language(entry: CatalogEntry): string | null {
  return entry.languageName ?? (entry.language === "und" ? null : entry.language);
}

/** Where an entry comes from, as the browser's source filter names it (`ebible`, `registry:name`) */
export function sourceKey(entry: CatalogEntry): string {
  const source = entry.source;
  return source.tag === "Registry" ? `registry:${source.catalog}` : source.tag.toLowerCase();
}

/** The names of the sources that aren't registries, by `sourceKey` */
export const SOURCE_NAMES: Record<string, string> = {
  ebible: "eBible.org",
  fetchbible: "fetch.bible",
  ccel: "CCEL",
  sword: "SWORD",
  git: "Git",
};

/** Where an entry comes from, in words: `eBible.org`, `SWORD (CrossWire)`, a registry's name and newest release */
export function sourceName(entry: CatalogEntry): string {
  const source = entry.source;
  switch (source.tag) {
    case "Sword":
      return `SWORD (${source.id.split("/")[0]})`;
    case "Registry":
      return `${source.catalog} ${entry.releases.at(-1)?.version ?? ""}`.trim();
    case "Git":
      return source.url.replace(/^https?:\/\//, "");
    default:
      return SOURCE_NAMES[sourceKey(entry)] ?? source.tag;
  }
}
