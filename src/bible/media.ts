import { Modal, Notice, Setting, type App } from "obsidian";
import { Logoxide, type MediaFile } from "logoxide";
import { formatSize } from "../core/timings.ts";
import type ToposPlugin from "../main.ts";
import { download } from "./manage.ts";
import { buffer, message, mkdirs, type Recording } from "./packages.ts";

/**
 * Package Bibles' recordings (their `[media]`): downloaded the first time one is played (with
 * `requestUrl`, so on mobile too, after saying how big it is), checked against the size and SHA-256
 * the package lists, and kept by that hash in the library's `media/` (`.logoxide/media/bd/bdc6…`,
 * hidden and not synced: each device downloads what it plays), where every version listing the
 * same file finds it again
 */
export class BibleMedia {
  /** Downloads under way, by hash, so one recording is downloaded once */
  private readonly downloading = new Map<string, Promise<void>>();

  constructor(private readonly plugin: ToposPlugin) {}

  /** The folder recordings are kept in */
  dir(): string {
    return `${this.plugin.packages.libraryDir()}/media`;
  }

  /** Where a recording is kept, once downloaded */
  path(file: MediaFile): string {
    return `${this.plugin.packages.libraryDir()}/${Logoxide.new().mediaStorePath(file)}`;
  }

  /** Whether it's been downloaded */
  async has(file: MediaFile): Promise<boolean> {
    return this.plugin.app.vault.adapter.exists(this.path(file));
  }

  /**
   * A recording's URL for a player: the downloaded file's, downloading it first when it isn't here
   * (once asked, when `ask`); null when it isn't downloaded (declined, or failed: said in a notice)
   */
  async source(recording: Recording, what: string, ask = true): Promise<string | null> {
    const { file } = recording;
    const adapter = this.plugin.app.vault.adapter;
    if (!(await this.has(file))) {
      if (!this.downloading.has(file.sha256) && ask && !(await confirmDownload(this.plugin.app, what, recording))) return null;
      try {
        await this.download(file, what);
      } catch (error) {
        new Notice(`Logoxide: couldn't download the recording of ${what}: ${message(error)}`, 10000);
        return null;
      }
    }
    return adapter.getResourcePath(this.path(file));
  }

  /** Downloads a recording, checks it, and keeps it by its hash */
  private download(file: MediaFile, what: string): Promise<void> {
    let running = this.downloading.get(file.sha256);
    if (!running) {
      running = (async () => {
        const notice = new Notice(`Downloading the recording of ${what} (${formatSize(Number(file.size))})…`, 0);
        try {
          const bytes = new Uint8Array(await download(file.url));
          Logoxide.new().verifyMedia(file, bytes);
          const path = this.path(file);
          await mkdirs(this.plugin, path.slice(0, path.lastIndexOf("/")));
          await this.plugin.app.vault.adapter.writeBinary(path, buffer(bytes));
        } finally {
          notice.hide();
        }
      })().finally(() => this.downloading.delete(file.sha256));
      this.downloading.set(file.sha256, running);
    }
    return running;
  }

  /** The recordings downloaded here: how many, and their size */
  async downloaded(): Promise<{ count: number; bytes: number }> {
    const adapter = this.plugin.app.vault.adapter;
    let count = 0;
    let bytes = 0;
    const walk = async (dir: string): Promise<void> => {
      if (!(await adapter.exists(dir))) return;
      const listed = await adapter.list(dir);
      for (const path of listed.files) {
        count++;
        bytes += (await adapter.stat(path))?.size ?? 0;
      }
      for (const folder of listed.folders) await walk(folder);
    };
    await walk(this.dir());
    return { count, bytes };
  }

  /** Removes every downloaded recording (they're downloaded again when played) */
  async clear(): Promise<void> {
    const adapter = this.plugin.app.vault.adapter;
    if (await adapter.exists(this.dir())) await adapter.rmdir(this.dir(), true);
  }
}

/** Asks before downloading a recording, saying how big it is */
function confirmDownload(app: App, what: string, recording: Recording): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = new (class extends Modal {
      private chosen = false;
      override onOpen(): void {
        this.titleEl.setText(`Download the recording of ${what}?`);
        const host = new URL(recording.file.url, "https://localhost/").host;
        this.contentEl.createEl("p", {
          text: `${recording.bible}'s recording (${recording.file.path}) is ${formatSize(Number(recording.file.size))}${host ? `, from ${host}` : ""}. It's downloaded once and kept on this device (not synced).`,
        });
        new Setting(this.contentEl)
          .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
          .addButton((b) =>
            b
              .setButtonText("Download")
              .setCta()
              .onClick(() => {
                this.chosen = true;
                this.close();
              }),
          );
      }
      override onClose(): void {
        this.contentEl.empty();
        resolve(this.chosen);
      }
    })(app);
    modal.open();
  });
}
