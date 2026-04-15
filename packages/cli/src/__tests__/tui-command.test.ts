import { afterEach, describe, expect, it, vi } from "vitest";
import { createProgram } from "../program.js";

describe("tui command", () => {
  const originalArgv = process.argv;

  afterEach(() => {
    process.argv = originalArgv;
    vi.restoreAllMocks();
  });

  it("launches Studio when no subcommand is provided", async () => {
    const launchStudio = vi.fn(async () => {});
    const program = createProgram({ launchStudio });

    await program.parseAsync([], { from: "user" });

    expect(launchStudio).toHaveBeenCalledTimes(1);
    expect(launchStudio).toHaveBeenCalledWith(process.cwd(), "4567");
  });

  it("launches the TUI when the explicit tui command is used", async () => {
    const launchTui = vi.fn(async () => {});
    const launchStudio = vi.fn(async () => {});
    const program = createProgram({ launchTui, launchStudio });

    await program.parseAsync(["tui"], { from: "user" });

    expect(launchTui).toHaveBeenCalledTimes(1);
    expect(launchStudio).not.toHaveBeenCalled();
  });
});
