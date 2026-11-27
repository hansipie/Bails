// Runs a system command without a shell. A non-zero exit is a result, not an error;
// a missing executable or a timeout rejects.
import { execFile } from "node:child_process";

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export class CommandNotFoundError extends Error {
  constructor(public readonly command: string) {
    super(`${command} not found.`);
  }
}

export function runCommand(cmd: string, args: string[], timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (!err) return resolve({ code: 0, stdout, stderr });
      const e = err as NodeJS.ErrnoException & { killed?: boolean };
      if (e.code === "ENOENT") return reject(new CommandNotFoundError(cmd));
      if (e.killed) return reject(new Error(`${cmd} timed out after ${Math.round(timeoutMs / 1000)}s.`));
      if (typeof e.code === "number") return resolve({ code: e.code, stdout, stderr });
      reject(err);
    });
  });
}
