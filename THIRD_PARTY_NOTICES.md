# Third-Party Notices

This notice was reviewed against the current Pi Agent Desktop runtime dependency graph with Pi 1.6.0. The license links below
identify the upstream terms that apply to each component; Pi Agent Desktop does not modify or replace those terms.
A reference-only entry records project lineage and does not mean that the referenced project is bundled with the
application.

## Application and runtime components

| Component                              | Version          | Use in Pi Agent Desktop                              | License                                                                                                                          | Attribution / source                                                                                                      |
| -------------------------------------- | ---------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `@agegr/pi-web`                        | Reference        | Early UI reference; not bundled                      | [MIT](https://github.com/agegr/pi-web/blob/main/LICENSE)                                                                         | [agegr/pi-web](https://github.com/agegr/pi-web); Copyright © 2026 agegr                                                   |
| `@earendil-works/pi-ai`                | 1.6.0            | Unified model-provider API                           | [MIT](https://github.com/earendil-works/pi/blob/v1.6.0/LICENSE)                                                                  | [earendil-works/pi](https://github.com/earendil-works/pi/tree/v1.6.0); Copyright © 2025 Mario Zechner                     |
| `@earendil-works/pi-agent-core`        | 1.6.0            | Agent runtime                                        | [MIT](https://github.com/earendil-works/pi/blob/v1.6.0/LICENSE)                                                                  | [earendil-works/pi](https://github.com/earendil-works/pi/tree/v1.6.0); Copyright © 2025 Mario Zechner                     |
| `@earendil-works/pi-coding-agent`      | 1.6.0            | Coding Agent and extension runtime                   | [MIT](https://github.com/earendil-works/pi/blob/v1.6.0/LICENSE)                                                                  | [earendil-works/pi](https://github.com/earendil-works/pi/tree/v1.6.0); Copyright © 2025 Mario Zechner                     |
| `@earendil-works/pi-tui`               | 1.6.0            | Pi runtime dependency                                | [MIT](https://github.com/earendil-works/pi/blob/v1.6.0/LICENSE)                                                                  | [earendil-works/pi](https://github.com/earendil-works/pi/tree/v1.6.0); Copyright © 2025 Mario Zechner                     |
| `@earendil-works/pi-telemetry`         | 1.6.0            | Pi runtime telemetry API                             | [MIT](https://github.com/earendil-works/pi/blob/v1.6.0/LICENSE)                                                                  | [earendil-works/pi](https://github.com/earendil-works/pi/tree/v1.6.0); Copyright © 2025 Mario Zechner                     |
| `@earendil-works/pi-codemode`          | 1.6.0            | Sandboxed tool orchestration                         | [MIT](https://github.com/earendil-works/pi/blob/v1.6.0/LICENSE)                                                                  | [earendil-works/pi](https://github.com/earendil-works/pi/tree/v1.6.0)                                                     |
| `@earendil-works/pi-mcp`               | 1.6.0            | MCP client, transports and OAuth                     | [MIT](https://github.com/earendil-works/pi/blob/v1.6.0/LICENSE)                                                                  | [earendil-works/pi](https://github.com/earendil-works/pi/tree/v1.6.0)                                                     |
| `@earendil-works/pi-schema`            | 1.6.0            | JSON Schema validation for tool parameters           | [MIT](https://github.com/earendil-works/pi/blob/v1.6.0/LICENSE)                                                                  | [earendil-works/pi](https://github.com/earendil-works/pi/tree/v1.6.0)                                                     |
| Tencent `openclaw-weixin` adapted code | 2.4.6            | Weixin channel transport                             | [MIT](https://github.com/Tencent/openclaw-weixin/blob/v2.4.6/LICENSE)                                                            | [Tencent/openclaw-weixin](https://github.com/Tencent/openclaw-weixin/tree/v2.4.6); Copyright © 2026 Tencent               |
| `@rc-component/qrcode`                 | 2.0.0            | QR-code settings UI                                  | [MIT](https://github.com/react-component/qrcode/blob/master/LICENSE)                                                             | [react-component/qrcode](https://github.com/react-component/qrcode); Copyright © 2015-present Alipay.com                  |
| `@larksuiteoapi/node-sdk`              | 1.71.1           | Feishu/Lark channel transport                        | [MIT](https://github.com/larksuite/node-sdk/blob/main/LICENSE)                                                                   | [larksuite/node-sdk](https://github.com/larksuite/node-sdk); Copyright © 2022 Lark Technologies Pte. Ltd.                 |
| `@xterm/xterm`                         | 6.0.0            | ANSI terminal rendering for the right-panel terminal | [MIT](https://github.com/xtermjs/xterm.js/blob/6.0.0/LICENSE)                                                                    | [xtermjs/xterm.js](https://github.com/xtermjs/xterm.js/tree/6.0.0); Copyright © 2012-2026 Xterm.js contributors           |
| `@xterm/addon-fit`                     | 0.11.0           | Terminal viewport sizing                             | [MIT](https://github.com/xtermjs/xterm.js/blob/6.0.0/LICENSE)                                                                    | [xtermjs/xterm.js](https://github.com/xtermjs/xterm.js/tree/6.0.0/addons/addon-fit)                                       |
| `node-pty`                             | 1.2.0-beta.18    | Interactive terminal pseudo-terminal                 | [MIT](https://github.com/microsoft/node-pty/blob/main/LICENSE)                                                                   | [microsoft/node-pty](https://github.com/microsoft/node-pty); Copyright © 2018-2026 Microsoft Corporation and contributors |
| `silk-wasm`                            | 3.7.1            | Weixin SILK voice decoding                           | [MIT](https://github.com/idranme/silk-wasm/blob/v3.7.1/LICENSE)                                                                  | [idranme/silk-wasm](https://github.com/idranme/silk-wasm/tree/v3.7.1); Copyright © 2024 idranme                           |
| Electron                               | 43.1.1           | Desktop application runtime                          | [MIT](https://github.com/electron/electron/blob/v43.1.1/LICENSE)                                                                 | [electron/electron](https://github.com/electron/electron/tree/v43.1.1); bundled Chromium notices ship with the runtime    |
| Chromium                               | 150.0.7871.114   | Embedded browser runtime                             | [BSD-3-Clause and bundled component licenses](https://chromium.googlesource.com/chromium/src/+/refs/tags/150.0.7871.114/LICENSE) | Embedded by Electron; `LICENSES.chromium.html` is shipped with the runtime                                                |
| Node.js                                | 24.18.0          | Electron-embedded Main runtime                       | [Node.js license and bundled notices](https://github.com/nodejs/node/blob/v24.18.0/LICENSE)                                      | Embedded by Electron 43.1.1                                                                                               |
| Rust standard library                  | 1.96.1           | Windows managed-process helper                       | [Apache-2.0 OR MIT](https://github.com/rust-lang/rust/tree/1.96.1/LICENSES)                                                      | [rust-lang/rust](https://github.com/rust-lang/rust/tree/1.96.1)                                                           |
| `windows-sys`                          | 0.61.2           | Windows API bindings                                 | [Apache-2.0 OR MIT](https://github.com/microsoft/windows-rs/tree/0.61.2/license-apache-2.0)                                      | [microsoft/windows-rs](https://github.com/microsoft/windows-rs/tree/0.61.2)                                               |
| `windows-link`                         | 0.2.1            | Windows import-link support                          | [Apache-2.0 OR MIT](https://github.com/microsoft/windows-rs/tree/0.61.2/license-mit)                                             | [microsoft/windows-rs](https://github.com/microsoft/windows-rs/tree/0.61.2)                                               |
| Microsoft Visual C++ runtime           | Per release SBOM | Statically linked into the Windows helper            | [Microsoft software license terms](https://go.microsoft.com/fwlink/?LinkId=2086102)                                              | The authoritative native toolset version is recorded in the Windows CycloneDX SBOM                                        |

Serphia bundles [`@gotgenes/pi-subagents`](https://github.com/gotgenes/pi-packages/tree/main/packages/pi-subagents)
25.0.5 under the MIT License (Copyright © 2026 tintinweb). The license text ships at
`resources/licenses/pi-subagents.txt`.

The Markdown renderer bundles `remark-cjk-friendly` and `remark-cjk-friendly-gfm-strikethrough` 2.3.1 and their
Micromark extensions from [markdown-cjk-friendly](https://github.com/tats-u/markdown-cjk-friendly) under the
[MIT License](https://spdx.org/licenses/MIT.html). Copyright © 2025 Tatsunori Uchino and Titus Wormer.

The `plan-mode` extension adapts [pi-plan-mode-tidy](https://github.com/cavaldos/pi-plan-mode-tidy).

```text
MIT License

Copyright (c) 2026 pi-plan-mode-tidy contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Pi 1.6.0 runtime dependencies

The 1.6.0 SDK does not depend on `@earendil-works/chord`. The experimental
pi-server, pi-client and pi-protocol packages are not production dependencies of the published SDK.
The Desktop build tool remains separately pinned to esbuild 0.27.7.

| Component             | Version | License                                                                                  | Attribution / source                                                                                                                                                  |
| --------------------- | ------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lovely-mermaid`      | 0.3.3   | [Apache-2.0](https://github.com/xl0/lovely-mermaid/blob/v0.3.3/LICENSE)                  | [xl0/lovely-mermaid](https://github.com/xl0/lovely-mermaid/tree/v0.3.3); Copyright © 2023-2026 SpaceXAI and © 2026 Alexey Zaytsev                                     |
| `proper-lockfile`     | 4.1.2   | [MIT](https://github.com/moxystudio/node-proper-lockfile/blob/v4.1.2/LICENSE)            | [moxystudio/node-proper-lockfile](https://github.com/moxystudio/node-proper-lockfile); Copyright © 2018 Made With MOXY Lda                                            |
| `quickjs-wasi`        | 3.6.2   | [MIT](https://github.com/vercel-labs/quickjs-wasi/blob/main/LICENSE)                     | [vercel-labs/quickjs-wasi](https://github.com/vercel-labs/quickjs-wasi); Copyright © 2026 Vercel, Inc.; includes QuickJS-NG WASM and extensions                       |
| `openai`              | 7.59.0  | [Apache-2.0](https://github.com/openai/openai-node/blob/v7.59.0/LICENSE)                 | [openai/openai-node](https://github.com/openai/openai-node/tree/v7.59.0)                                                                                              |
| `typebox`             | 1.3.27  | [MIT](https://github.com/sinclairzx81/typebox/blob/main/license)                         | [sinclairzx81/typebox](https://github.com/sinclairzx81/typebox)                                                                                                       |
| `undici`              | 8.12.4  | [MIT](https://github.com/nodejs/undici/blob/v8.12.4/LICENSE)                             | [nodejs/undici](https://github.com/nodejs/undici/tree/v8.12.4)                                                                                                        |
| `protobufjs`          | 7.6.5   | [BSD-3-Clause](https://github.com/protobufjs/protobuf.js/blob/protobufjs-v7.6.5/LICENSE) | [protobufjs/protobuf.js](https://github.com/protobufjs/protobuf.js/tree/protobufjs-v7.6.5)                                                                            |
| `brace-expansion`     | 5.0.12  | [MIT](https://github.com/juliangruber/brace-expansion/blob/v5.0.12/LICENSE)              | [juliangruber/brace-expansion](https://github.com/juliangruber/brace-expansion/tree/v5.0.12)                                                                          |
| `marked-cjk-friendly` | 0.1.2   | [MIT](https://spdx.org/licenses/MIT.html)                                                | [tats-u/markdown-cjk-friendly](https://github.com/tats-u/markdown-cjk-friendly); Copyright © 2024 Tatsunori Uchino, and authors and contributors of original packages |

## Herdr interface

The Herdr launcher uses [Aora Bot](https://github.com/sam70361/aora-bot) through
`@aora-bot/react` and `@aora-bot/engine` 0.2.0 under the
[Aora Bot License](https://github.com/sam70361/aora-bot/blob/main/LICENSE).

The Agent icons include the [Pi badge](https://pi.dev/press-kit), the
[Oh My Pi favicon](https://github.com/can1357/oh-my-pi/blob/main/packages/collab-web/public/favicon.svg),
the [Droid icon from Factory's Zed extension](https://github.com/Factory-AI/factory-zed-extension/blob/main/droid-zed.svg),
and the [Maki favicon](https://github.com/tontinton/maki/blob/main/site/favicon-32x32.png).
The assets identify their respective agents and retain their original branding.

## Provider brand assets

The TypeSafe provider icon is the unmodified favicon linked by [TypeSafe AI](https://typesafe.ai/),
retrieved on 2026-10-08 from
[its official website asset](https://framerusercontent.com/images/aNFzSFxM4fjICmnibw7npfZjcQ.png).
It is bundled locally as `src/renderer/assets/providers/typesafe.png` for provider identification.
The TypeSafe name and logo belong to TypeSafe AI; this notice does not relicense the brand asset.

## Developer toolchains

The Windows x64 desktop app bundles [Vercel agent-desktop 1.3.1](https://github.com/vercel-labs/agent-desktop/releases/tag/v1.3.1)
for native window control under the [Apache License 2.0](https://github.com/vercel-labs/agent-desktop/blob/v1.3.1/LICENSE).
The license text is included at `resources/desktop-window/LICENSE`.

Pi Agent Desktop redistributes the target-specific ripgrep, fd, and supported macOS/Linux Herdr executables in its
default installer. Remaining tools are fixed official releases downloaded to private application storage only after
user confirmation.

| Component                         | Version         | Distribution                  | License                                                                                                                                                                  | Upstream source                                                                              |
| --------------------------------- | --------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| ripgrep                           | 15.2.0          | Bundled per target            | [MIT OR Unlicense](https://github.com/BurntSushi/ripgrep/blob/15.2.0/COPYING)                                                                                            | [BurntSushi/ripgrep](https://github.com/BurntSushi/ripgrep/tree/15.2.0)                      |
| fd                                | 10.3.0          | Bundled per target            | [Apache-2.0](https://github.com/sharkdp/fd/blob/v10.3.0/LICENSE-APACHE) OR [MIT](https://github.com/sharkdp/fd/blob/v10.3.0/LICENSE-MIT)                                 | [sharkdp/fd](https://github.com/sharkdp/fd/tree/v10.3.0)                                     |
| Node.js                           | 24.18.0         | Downloaded after confirmation | [Node.js license and bundled notices](https://github.com/nodejs/node/blob/v24.18.0/LICENSE)                                                                              | [nodejs/node](https://github.com/nodejs/node/tree/v24.18.0)                                  |
| npm                               | Node.js-bundled | Downloaded with Node.js       | [Artistic-2.0](https://github.com/npm/cli/blob/v11.16.0/LICENSE)                                                                                                         | [npm/cli](https://github.com/npm/cli)                                                        |
| uv                                | 0.11.29         | Downloaded after confirmation | [Apache-2.0](https://github.com/astral-sh/uv/blob/0.11.29/LICENSE-APACHE) OR [MIT](https://github.com/astral-sh/uv/blob/0.11.29/LICENSE-MIT)                             | [astral-sh/uv](https://github.com/astral-sh/uv/tree/0.11.29)                                 |
| python-build-standalone / CPython | 3.14.6+20260623 | Downloaded after confirmation | [Upstream bundled licenses](https://gregoryszorc.com/docs/python-build-standalone/main/running.html#licensing) and [PSF License](https://docs.python.org/3/license.html) | [astral-sh/python-build-standalone](https://github.com/astral-sh/python-build-standalone)    |
| PortableGit                       | 2.55.0.3        | Downloaded on Windows x64     | [GPL-2.0-only and bundled notices](https://github.com/git-for-windows/git/blob/v2.55.0.windows.3/COPYING)                                                                | [git-for-windows/git](https://github.com/git-for-windows/git/releases/tag/v2.55.0.windows.3) |
| jq                                | 1.8.2           | Downloaded after confirmation | [MIT](https://github.com/jqlang/jq/blob/jq-1.8.2/COPYING)                                                                                                                | [jqlang/jq](https://github.com/jqlang/jq/tree/jq-1.8.2)                                      |
| Bun                               | 1.3.14          | Downloaded after confirmation | [MIT with separately licensed bundled components](https://github.com/oven-sh/bun/blob/bun-v1.3.14/LICENSE.md)                                                            | [oven-sh/bun](https://github.com/oven-sh/bun/releases/tag/bun-v1.3.14)                       |
| Herdr                             | 0.8.2           | Bundled on macOS/Linux        | [Apache-2.0](https://github.com/herdrdev/herdr/blob/v0.8.2/LICENSE)                                                                                                      | [herdrdev/herdr](https://github.com/herdrdev/herdr/tree/v0.8.2)                              |

Windows helper cross-build dependencies are not bundled in the application: `cargo-xwin` 0.23.1 is used under the
[MIT license](https://github.com/rust-cross/cargo-xwin/blob/v0.23.1/LICENSE), LLVM 18 is used under
[Apache-2.0 WITH LLVM-exception](https://github.com/llvm/llvm-project/blob/llvmorg-18.1.8/LICENSE.TXT), and the
downloaded Windows SDK 10.0.26100 / MSVC CRT manifest package 14.44.17.14 (CRT headers build 14.44.35220) remain
governed by the
[Microsoft software license terms](https://go.microsoft.com/fwlink/?LinkId=2086102).

Each Windows release publishes a CycloneDX SBOM generated from the locked production dependency graph. It records
the authoritative Windows-native rustc, Cargo, rustc LLVM backend, Windows SDK and MSVC toolset versions separately
from the fixed cargo-xwin/LLVM/SDK/CRT cross-build gate, together with the exact helper, installer and bundled-tool
hashes.

The bundled ripgrep, fd, and Herdr executables are distributed with their upstream license files. The managed Herdr
activation is copied from the bundled verified runtime together with its Apache-2.0 license text. Downloaded archives may
contain additional components and notices; those upstream files remain authoritative.

## License reference index

| Identifier      | Canonical license text                                   |
| --------------- | -------------------------------------------------------- |
| MIT             | <https://spdx.org/licenses/MIT.html>                     |
| Apache-2.0      | <https://www.apache.org/licenses/LICENSE-2.0>            |
| BSD-3-Clause    | <https://spdx.org/licenses/BSD-3-Clause.html>            |
| Artistic-2.0    | <https://spdx.org/licenses/Artistic-2.0.html>            |
| GPL-2.0-only    | <https://www.gnu.org/licenses/old-licenses/gpl-2.0.html> |
| Unlicense       | <https://unlicense.org/>                                 |
| Python / PSF    | <https://docs.python.org/3/license.html>                 |
| Node.js bundled | <https://github.com/nodejs/node/blob/v24.18.0/LICENSE>   |

Where an upstream version-specific license link and a canonical reference differ, the upstream component's bundled
license and notices are authoritative.

## Deep Agent composer menus

The renderer uses the original model and approval controls distributed by [LeiBox](https://leibox.pantoria.cn/docs/animations/deep-agent-composer). The source retains its attribution. The controls use [Lucide](https://lucide.dev/) icons under the following license.

```text
ISC License

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

---

The following Lucide icons are derived from the Feather project:

airplay, alert-circle, alert-octagon, alert-triangle, aperture, arrow-down-circle, arrow-down-left, arrow-down-right, arrow-down, arrow-left-circle, arrow-left, arrow-right-circle, arrow-right, arrow-up-circle, arrow-up-left, arrow-up-right, arrow-up, at-sign, calendar, cast, check, chevron-down, chevron-left, chevron-right, chevron-up, chevrons-down, chevrons-left, chevrons-right, chevrons-up, circle, clipboard, clock, code, columns, command, compass, corner-down-left, corner-down-right, corner-left-down, corner-left-up, corner-right-down, corner-right-up, corner-up-left, corner-up-right, crosshair, database, divide-circle, divide-square, dollar-sign, download, external-link, feather, frown, hash, headphones, help-circle, info, italic, key, layout, life-buoy, link-2, link, loader, lock, log-in, log-out, maximize, meh, minimize, minimize-2, minus-circle, minus-square, minus, monitor, moon, more-horizontal, more-vertical, move, music, navigation-2, navigation, octagon, pause-circle, percent, plus-circle, plus-square, plus, power, radio, rss, search, server, share, shopping-bag, sidebar, smartphone, smile, square, table-2, tablet, target, terminal, trash-2, trash, triangle, tv, type, upload, x-circle, x-octagon, x-square, x, zoom-in, zoom-out

The MIT License (MIT) (for the icons listed above)

Copyright (c) 2013-present Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
