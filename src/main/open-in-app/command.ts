/**
 * Command-line composition for one open-in-app launch: the workspace directory
 * replaces every `{path}` token the catalog declared, and is appended when the
 * launcher takes the directory as a bare argument.
 */

import { PATH_TOKEN } from "./catalog.ts";

/**
 * Build the argv for one launch.
 * @param args - catalog argv templates.
 * @param directory - absolute workspace directory.
 * @returns the concrete argv to spawn.
 */
export function launchArguments(args: readonly string[], directory: string): string[] {
  return args.some((argument) => argument.includes(PATH_TOKEN))
    ? args.map((argument) => argument.replaceAll(PATH_TOKEN, directory))
    : [...args, directory];
}
