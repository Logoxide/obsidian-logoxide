/**
 * Errors in words, for notices. Logoxide's bindings throw a `LogoxideErrorException` whose own
 * message is only "LogoxideError": what happened is in its `value` (a kind, `tag`, and a
 * `message`). Two kinds say what to do next: `Busy` (another program holds the library or the
 * project: try again) and `Conflict` (`logoxide.toml` changed while the change was being made).
 */

/** What a logoxide error's value looks like */
interface ErrorValue {
  tag?: unknown;
  message?: unknown;
}

/** The error's kind and message, when it is a logoxide error */
export function logoxideError(error: unknown): { tag: string; message: string } | null {
  const value = (error as { value?: ErrorValue } | null)?.value;
  if (!value || typeof value !== "object" || typeof value.message !== "string") return null;
  return { tag: typeof value.tag === "string" ? value.tag : "", message: value.message };
}

/** An error in words: a logoxide error's message with what to do about it, else the error's own */
export function describeError(error: unknown): string {
  const known = logoxideError(error);
  if (!known) return error instanceof Error ? error.message : String(error);
  const message = known.message.replace(/\.\s*$/, "");
  switch (known.tag) {
    case "Busy":
      return `${message} (another program, such as lx or another Obsidian, is using the library: try again in a moment)`;
    case "Conflict":
      // Logoxide's own advice is for someone editing the file; here the plugin reads it again
      return `${message.replace(/\s*\(open it again and redo the change\)$/, "")} (it changed while this ran, by lx or another device's sync: try again)`;
    default:
      return message;
  }
}
