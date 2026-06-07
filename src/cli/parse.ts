import { ok, type Result } from "../domain/result.js";
import { cliErr } from "./errors.js";
import {
  cliApprovalModes,
  cliCommandFamilies,
  cliDisplayModes,
  cliRequestedModes,
  type CLIApprovalMode,
  type CLICommandFamily,
  type CLICommandIntent,
  type CLIDisplayMode,
  type CLIRequestedMode
} from "./types.js";

interface ParsedArgs {
  readonly positionals: readonly string[];
  readonly flags: Readonly<Record<string, string>>;
}

const displayShortcuts: Readonly<Record<string, CLIDisplayMode>> = {
  json: "json",
  quiet: "quiet",
  verbose: "verbose",
  "source-refs": "source_refs"
};

const modeShortcuts: Readonly<Record<string, CLIRequestedMode>> = {
  "dry-run": "dry_run",
  debug: "debug",
  replay: "replay",
  explain: "explain_only"
};

function splitFlag(token: string): readonly [string, string | undefined] {
  const body = token.slice(2);
  const eq = body.indexOf("=");
  return eq === -1 ? [body, undefined] : [body.slice(0, eq), body.slice(eq + 1)];
}

function collect(tokens: readonly string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i] as string;
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const [name, inline] = splitFlag(token);
    if (inline !== undefined) {
      flags[name] = inline;
      continue;
    }
    const next = tokens[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags[name] = next;
      i += 1;
    } else {
      flags[name] = "true";
    }
  }
  return { positionals, flags };
}

function resolveDisplay(flags: Readonly<Record<string, string>>): CLIDisplayMode {
  for (const [flag, mode] of Object.entries(displayShortcuts)) {
    if (flags[flag] === "true") return mode;
  }
  const explicit = flags["display"];
  return cliDisplayModes.includes(explicit as CLIDisplayMode) ? (explicit as CLIDisplayMode) : "human_summary";
}

function resolveMode(flags: Readonly<Record<string, string>>): CLIRequestedMode {
  if (flags["display"] === "json" || flags["json"] === "true") return "machine_readable";
  for (const [flag, mode] of Object.entries(modeShortcuts)) {
    if (flags[flag] === "true") return mode;
  }
  const explicit = flags["mode"];
  return cliRequestedModes.includes(explicit as CLIRequestedMode) ? (explicit as CLIRequestedMode) : "normal";
}

function resolveApproval(flags: Readonly<Record<string, string>>): CLIApprovalMode {
  const explicit = flags["approval"];
  return cliApprovalModes.includes(explicit as CLIApprovalMode) ? (explicit as CLIApprovalMode) : "ask";
}

export function parseArgv(argv: readonly string[], defaultRoot: string): Result<CLICommandIntent> {
  if (argv.length === 0) {
    return cliErr({ code: "invalid_input", message: "no command family provided", severity: "warning" });
  }
  const family = argv[0] as string;
  if (!cliCommandFamilies.includes(family as CLICommandFamily)) {
    return cliErr({ code: "invalid_input", message: `unknown command family: ${family}`, severity: "warning" });
  }
  const rest = argv.slice(1);
  const action = rest[0] !== undefined && !rest[0].startsWith("--") ? rest[0] : "default";
  const tokens = rest[0] !== undefined && !rest[0].startsWith("--") ? rest.slice(1) : rest;
  const { positionals, flags } = collect(tokens);
  return ok({
    raw: argv,
    family: family as CLICommandFamily,
    action,
    positionals,
    flags,
    requestedMode: resolveMode(flags),
    approvalMode: resolveApproval(flags),
    displayMode: resolveDisplay(flags),
    workspaceRoot: flags["workspace"] ?? flags["root"] ?? defaultRoot
  });
}
