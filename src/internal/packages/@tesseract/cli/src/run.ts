import { asTaskId } from "@tesseract/core";
import { Command } from "commander";
import { FileInbox } from "@tesseract/inbox";
import {
  FsInterventionStore,
  InterventionManager,
  type CheckpointId,
} from "@tesseract/intervention";

export interface CliRunOptions {
  repoRoot?: string;
  writeOut?: (chunk: string) => void;
  writeErr?: (chunk: string) => void;
}

function emit(
  writeOut: (chunk: string) => void,
  payload: Record<string, unknown>,
): void {
  writeOut(`${JSON.stringify(payload)}\n`);
}

function stub(
  writeOut: (chunk: string) => void,
  command: string,
  summary: string,
): () => void {
  return () => {
    emit(writeOut, { command, status: "stub", summary });
  };
}

/**
 * Parses CLI arguments and runs the matching handler. The argv parameter MUST omit
 * the `node` binary and the script path (for example `["pause", "task-1"]`).
 */
export async function parseAndRun(
  argv: string[],
  options?: CliRunOptions,
): Promise<number> {
  const repoRoot = options?.repoRoot ?? process.cwd();
  const writeOut = options?.writeOut ?? ((c: string) => process.stdout.write(c));
  const writeErr = options?.writeErr ?? ((c: string) => process.stderr.write(c));

  const program = new Command();
  program.name("tess");
  program.description("Tesseract workspace CLI (bootstrap Phase 3).");
  program.configureOutput({
    writeOut: (s) => writeOut(s),
    writeErr: (s) => writeErr(s),
  });
  program.exitOverride((err) => {
    throw err;
  });

  program
    .command("init")
    .description("Initialize a Tesseract workspace in the current repository")
    .action(stub(writeOut, "init", "Greenfield and adopt flows land in Phase 4+."));

  program
    .command("run")
    .description("Run a pipeline by name")
    .action(stub(writeOut, "run", "Pipeline execution wires through Phase 4+."));

  program
    .command("inbox")
    .description("List pending human directives under src/inbox/in/")
    .action(async () => {
      const inbox = new FileInbox(repoRoot);
      const entries = await inbox.listIn();
      emit(writeOut, { command: "inbox", status: "ok", entries });
    });

  program
    .command("feature")
    .description("Manage feature-delivery artifacts")
    .action(
      stub(writeOut, "feature", "Feature workspace commands land with the delivery pipeline."),
    );

  program
    .command("status")
    .description("Show pipeline and workspace status")
    .action(stub(writeOut, "status", "Status aggregation lands with the scheduler."));

  program
    .command("approve")
    .description("Approve a gated action")
    .action(stub(writeOut, "approve", "Authorizer integration lands in M3+."));

  program
    .command("memory")
    .description("Inspect Memory tier indexes")
    .action(stub(writeOut, "memory", "MemoryRouter CLI lands with FileMemoryStore hardening."));

  program
    .command("contracts")
    .description("List or evaluate Spec Contracts")
    .action(stub(writeOut, "contracts", "Contract runner CLI surfaces land in Phase 4+."));

  program
    .command("lint")
    .description("Run repository lint and policy gates")
    .action(stub(writeOut, "lint", "ESLint and policy bundles invoke from CI today; CLI wiring expands later."));

  program
    .command("pause")
    .description("Append a pause intervention for a task")
    .argument("<taskId>", "Task id under src/work/")
    .action(async (taskId: string) => {
      const mgr = new InterventionManager(new FsInterventionStore(repoRoot));
      await mgr.pause(asTaskId(taskId));
      emit(writeOut, { command: "pause", status: "ok", taskId });
    });

  program
    .command("resume")
    .description("Append a resume intervention for a task")
    .argument("<taskId>", "Task id under src/work/")
    .option(
      "--checkpoint <checkpointId>",
      "Optional checkpoint id for time-travel resume",
    )
    .action(async (taskId: string, opts: { checkpoint?: string }) => {
      const mgr = new InterventionManager(new FsInterventionStore(repoRoot));
      const cp = opts.checkpoint as CheckpointId | undefined;
      await mgr.resume(asTaskId(taskId), cp);
      emit(writeOut, {
        command: "resume",
        status: "ok",
        taskId,
        checkpointId: opts.checkpoint ?? null,
      });
    });

  program
    .command("abort")
    .description("Append an abort intervention for a task")
    .argument("<taskId>", "Task id under src/work/")
    .option("--reason <text>", "Optional abort reason")
    .action(async (taskId: string, opts: { reason?: string }) => {
      const mgr = new InterventionManager(new FsInterventionStore(repoRoot));
      await mgr.abort(asTaskId(taskId), opts.reason);
      emit(writeOut, {
        command: "abort",
        status: "ok",
        taskId,
        reason: opts.reason ?? null,
      });
    });

  try {
    await program.parseAsync(argv, { from: "user" });
    return 0;
  } catch {
    return 1;
  }
}
