/** Single-quotes a value for POSIX sh; embedded quotes survive as literals. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * The AppleScript that opens Terminal.app on `envName=<folder> <command>`.
 * The folder can be one the person picked, so it is quoted for the shell and
 * then escaped for the AppleScript string, and can never end either early.
 */
export function loginTerminalScript(
  envName: string,
  configRoot: string,
  loginCommand: string,
): string {
  const shell = `${envName}=${shellQuote(configRoot)} ${loginCommand}`;
  const escaped = shell.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `tell application "Terminal" to do script "${escaped}"`;
}
