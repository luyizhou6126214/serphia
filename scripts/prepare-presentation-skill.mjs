import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { x } from "tar";

// git archive --format=tar.gz 7e0df6705de0cd24345210d31f07fcb5a32b6900:skills/ppt-master
export function preparePresentationSkill(root) {
  const archive = path.join(root, "build/presentation-skills/ppt-master-6.9.0.tar.gz");
  const hash = "b63641a0d5a69ac601fb6657d087a68f898b6f3673d5ce6816f4430f280b0fbb";
  const target = path.join(root, "build/ppt-master");
  const marker = path.join(target, ".distribution");
  const surface = fs.readFileSync(path.join(root, "scripts/presentation-skill/serphia_surface.py"));
  const revision = hash + ":studio-ui-v1:" + createHash("sha256").update(surface).digest("hex");
  const installed = fs.existsSync(marker) ? fs.readFileSync(marker, "utf8") : "";
  if (installed === revision) return;
  if (createHash("sha256").update(fs.readFileSync(archive)).digest("hex") !== hash)
    throw new Error("PPT Master distribution checksum mismatch");
  fs.mkdirSync(target, { recursive: true });
  const services = ["confirm_ui", "spec_review", "svg_editor"];
  const launchers = new Set(services.map((service) => `scripts/${service}/server.py`));
  // When upgrading this adapter, restore just the three pristine upstream entry points.
  const filter = installed.split(":")[0] === hash ? (file) => launchers.has(file) : undefined;
  x({ file: archive, cwd: target, sync: true, strict: true, filter });
  fs.writeFileSync(path.join(target, "scripts/serphia_surface.py"), surface);
  for (const service of services) {
    const file = path.join(target, "scripts", service, "server.py");
    const source = fs.readFileSync(file, "utf8");
    const newline = source.includes("\r\n") ? "\r\n" : "\n";
    const parseArgs = service === "spec_review" ? "build_parser().parse_args(argv)" : "parser.parse_args(argv)";
    const anchor = `    args = ${parseArgs}${newline}`;
    if (!source.includes(anchor)) throw new Error(`PPT Master CLI entry point changed: ${service}`);
    const project = service === "spec_review" ? "args.project_path" : "args.project_dir";
    const guard = [
      "    from serphia_surface import studio_ui_handoff",
      `    handoff = studio_ui_handoff(${project}, "${service}", args)`,
      "    if handoff:",
      "        print(handoff, file=sys.stderr)",
      "        return 1",
    ].join(newline);
    fs.writeFileSync(file, source.replace(anchor, anchor + guard + newline));
  }
  fs.writeFileSync(marker, revision);
}
