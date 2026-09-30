/**
 * The values `main` derives from the process before it dispatches a command.
 * Each command handler under `src/cli/` receives them.
 */
export interface CliContext {
  /** The project root the CLI resolved from the working directory. */
  root: string
  /** The help text, headed by the harness version. */
  help: string
  /** The shell command that invokes this CLI, for printed next commands. */
  pan: string
  /** The arguments after the node executable and the script path. */
  rawArgs: string[]
  /** The command name, `help` when none was given. */
  command: string
  /** The arguments after the command name. */
  args: string[]
  /** Whether `--json` appears among the arguments. */
  json: boolean
}
