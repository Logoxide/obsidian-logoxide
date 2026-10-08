// Where the topos checkout is, for the shared test cases and the CLI: $TOPOS_DIR, else
// ~/Development/rust/topos (../../rust/topos from this repository, next to it in ~/Development)
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const toposDir = process.env.TOPOS_DIR ?? fileURLToPath(new URL("../../../rust/topos/", import.meta.url));

/** The topos CLI the tests compare with: $TOPOS_CLI, else the checkout's debug build */
export const toposCli = process.env.TOPOS_CLI ?? join(toposDir, "target/debug/topos");
