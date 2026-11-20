import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

// The Pi package publishes its factory as a manifest resource, outside npm's exports.
// Adapt only its composition root. Keep its tools and subagent lifecycle upstream.
export function piSubagentsBuild() {
  const publicEntry = createRequire(import.meta.url).resolve("@gotgenes/pi-subagents");
  const packageDir = path.resolve(path.dirname(publicEntry), "../..");
  return {
    name: "pi-subagents-desktop",
    setup(build) {
      build.onResolve({ filter: /^\.\/upstream-subagents$/ }, async () => {
        const manifest = JSON.parse(await readFile(path.join(packageDir, "package.json"), "utf8"));
        if (manifest.pi?.extensions?.[0] !== "./src/index.ts") {
          throw new Error("Review the Pi Subagents desktop adapter for the new extension entry");
        }
        return { path: path.join(packageDir, "src/index.ts"), pluginData: { desktopSubagents: true } };
      });
      build.onResolve({ filter: /^#src\// }, (args) => {
        if (!args.importer.startsWith(packageDir + path.sep)) return;
        return { path: path.join(packageDir, "src", args.path.slice("#src/".length) + ".ts") };
      });
      build.onLoad({ filter: /[/\\]pi-subagents[/\\]src[/\\]index\.ts$/ }, async (args) => {
        if (!args.pluginData?.desktopSubagents) return;
        let source = await readFile(args.path, "utf8");
        const replace = (before, after) => {
          if (source.split(before).length !== 2) {
            throw new Error(`Review the Pi Subagents desktop adapter: ${before}`);
          }
          source = source.replace(before, after);
        };
        replace("export default function (pi: ExtensionAPI)", "export default function (pi: ExtensionAPI, desktop)");
        replace("loadCustomAgents(process.cwd())", "loadCustomAgents(desktop.projectCwd())");
        replace("cwd: process.cwd(),", "cwd: desktop.projectCwd(),");
        replace("baseCwd: process.cwd(),", "baseCwd: desktop.cwd,");
        replace(
          "createResourceLoader: (opts) => new DefaultResourceLoader(opts),",
          `createResourceLoader: (opts) => new DefaultResourceLoader({
            ...opts, noExtensions: true, noSkills: true, extensionFactories: [],
            settingsManager: SdkSettingsManager.inMemory({}, { projectTrusted: false }),
          }),`,
        );
        replace(
          "SdkSettingsManager.create(cwd, dir)",
          "SdkSettingsManager.create(cwd, dir, { projectTrusted: desktop.isProjectTrusted() })",
        );
        replace(
          /createSession: async \(\{ sessionManager, resourceLoader, modelRegistry, \.\.\.rest \}\) => \{[\s\S]*?return createAgentSession\(\{/,
          `createSession: async ({ sessionManager, resourceLoader, tools, customTools, ...rest }) => {
            const delegated = [...(customTools ?? []), ...desktop.childTools(tools)];
            return createAgentSession({
              tools: delegated.map((tool) => tool.name),
              customTools: delegated,`,
        );
        // Reuse the parent's configured providers and virtual models. Children register no providers.
        replace("modelRuntime: childRuntime,", "modelRuntime: desktop.modelRuntime,");
        replace(/const service = new SubagentsServiceAdapter\([^\n]+\);\s+publishSubagentsService\(service\);/, "");
        replace("    unpublishSubagentsService,", "    () => {},");
        return { contents: source, loader: "ts", resolveDir: path.dirname(args.path), watchFiles: [args.path] };
      });
    },
  };
}
