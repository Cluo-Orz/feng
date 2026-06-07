import { describe, expect, it } from "vitest";
import { parseArgv } from "../../src/cli/index.js";

const root = "/tmp/ws";

function intent(argv: readonly string[]) {
  const result = parseArgv(argv, root);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

describe("cli parse", () => {
  it("rejects empty argv", () => {
    const result = parseArgv([], root);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_input");
  });

  it("rejects unknown family", () => {
    const result = parseArgv(["frobnicate"], root);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("unknown command family");
  });

  it("parses family, action, positionals and flags", () => {
    const parsed = intent(["grow", "create", "pos1", "--title", "Boss", "--goal=tough"]);
    expect(parsed.family).toBe("grow");
    expect(parsed.action).toBe("create");
    expect(parsed.positionals).toEqual(["pos1"]);
    expect(parsed.flags["title"]).toBe("Boss");
    expect(parsed.flags["goal"]).toBe("tough");
  });

  it("treats a leading flag as default action", () => {
    const parsed = intent(["status", "--grow", "g1"]);
    expect(parsed.action).toBe("default");
    expect(parsed.flags["grow"]).toBe("g1");
  });

  it("treats trailing boolean flag as true", () => {
    const parsed = intent(["grow", "list", "--all"]);
    expect(parsed.flags["all"]).toBe("true");
  });

  it("maps --json to machine_readable mode and json display", () => {
    const parsed = intent(["grow", "list", "--json"]);
    expect(parsed.requestedMode).toBe("machine_readable");
    expect(parsed.displayMode).toBe("json");
  });

  it("honors explicit display mode", () => {
    expect(intent(["grow", "list", "--display", "verbose"]).displayMode).toBe("verbose");
    expect(intent(["grow", "list", "--verbose"]).displayMode).toBe("verbose");
    expect(intent(["grow", "list", "--quiet"]).displayMode).toBe("quiet");
    expect(intent(["grow", "list", "--source-refs"]).displayMode).toBe("source_refs");
  });

  it("honors requested mode shortcuts and explicit mode", () => {
    expect(intent(["grow", "list", "--dry-run"]).requestedMode).toBe("dry_run");
    expect(intent(["grow", "list", "--debug"]).requestedMode).toBe("debug");
    expect(intent(["grow", "list", "--mode", "replay"]).requestedMode).toBe("replay");
    expect(intent(["grow", "list", "--mode", "bogus"]).requestedMode).toBe("normal");
  });

  it("resolves approval mode with a sane default", () => {
    expect(intent(["policy", "describe", "cap"]).approvalMode).toBe("ask");
    expect(intent(["policy", "describe", "cap", "--approval", "never"]).approvalMode).toBe("never");
    expect(intent(["policy", "describe", "cap", "--approval", "bogus"]).approvalMode).toBe("ask");
  });

  it("resolves workspace root from flags and falls back to default", () => {
    expect(intent(["grow", "list"]).workspaceRoot).toBe(root);
    expect(intent(["grow", "list", "--workspace", "/a"]).workspaceRoot).toBe("/a");
    expect(intent(["grow", "list", "--root", "/b"]).workspaceRoot).toBe("/b");
  });
});
