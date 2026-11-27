// Read-only access to generic passwords in the OS keyring, through the system CLI tools
// (no native module). Entries written by zalando/go-keyring use exactly these attributes.
import { execFile } from "node:child_process";

const TIMEOUT_MS = 10_000;

function run(cmd: string, args: string[]): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: TIMEOUT_MS, windowsHide: true }, (err, stdout) => {
      if (!err) return resolve({ code: 0, stdout });
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return reject(new Error(`${cmd} not found; it is needed to read the system keyring.`));
      if (typeof code === "number") return resolve({ code, stdout });
      reject(err);
    });
  });
}

/** Returns the secret, or null when there is no such entry. */
export async function readKeyring(service: string, account: string): Promise<string | null> {
  if (process.platform === "linux") {
    // Secret Service (GNOME Keyring, KWallet…). Exit 1 with empty output means "not found".
    const { code, stdout } = await run("secret-tool", ["lookup", "service", service, "username", account]);
    return code === 0 && stdout.length > 0 ? stdout : null;
  }
  if (process.platform === "darwin") {
    // Exit 44 is errSecItemNotFound.
    const { code, stdout } = await run("security", ["find-generic-password", "-s", service, "-a", account, "-w"]);
    if (code === 44) return null;
    if (code !== 0) throw new Error(`security exited with code ${code}.`);
    return stdout.replace(/\n$/, "");
  }
  throw new Error(`Reading the system keyring is not supported on ${process.platform} yet.`);
}
