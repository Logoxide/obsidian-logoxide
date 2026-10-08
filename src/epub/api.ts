// The parts of EPUB++'s plugin API that topos uses beyond file-plus-plus's `FileApi` (which every
// file-plus-plus plugin has): its `extractText` with CFIs. EPUB++ opens EPUBs in Obsidian; topos
// searches their text and hands the references back as annotations.
import type { Annotation, ExtractedText, FileApi } from "file-plus-plus/obsidian";
import type { TFile } from "obsidian";

export type { AnnotationContext, AnnotationProvider } from "file-plus-plus/obsidian";

export const EPUB_PLUGIN_ID = "epub-plus-plus";
export const API_READY_EVENT = "epub-plus-plus:api-ready";
export const API_UNLOAD_EVENT = "epub-plus-plus:api-unload";

export interface EpubPlusPlusApi extends FileApi {
  extractText(file: TFile, opts?: { blockSeparator?: string }): Promise<ExtractedBook>;
}

export interface ExtractedBook extends ExtractedText {
  sections: { index: number; spineIndex: number; href: string; text: string; title: string | null }[];
  cfi(spineIndex: number, start: number, end: number): string | null;
}

export type EpubAnnotation<T = unknown> = Annotation<T>;
