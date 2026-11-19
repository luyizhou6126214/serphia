# Deep Agent 对话输入框

本目录提供 LeiBox Deep Agent Composer 的完整源码、独立推理强度滑块和六种框架入口。输入框、附件、候选菜单、权限菜单、模型菜单和滑块共用 `DeepAgentComposerEngine.js` 中的原版 React UI 与 GSAP 动画。原始实现来自 [LeiBox Agent 对话输入框](https://leibox.pantoria.cn/docs/animations/deep-agent-composer)。分发时请保留源码署名和随附的 [Lucide 与 Feather 许可](./LUCIDE-LICENSE.txt)。

## React 快速开始

在 React 项目中使用下面列出的四个核心文件。需要独立滑块时，一并复制其 React 入口。在项目目录安装组件依赖。

```sh
npm install react react-dom gsap@3.12.7 deep-agent-base-ui@npm:@base-ui/react@1.8.0 deep-agent-lucide@npm:lucide-react@1.43.0 @fortawesome/fontawesome-svg-core@6.7.2 @fortawesome/free-solid-svg-icons@6.7.2 @fortawesome/react-fontawesome@0.2.6 @radix-ui/react-slider@1.4.7 react-circular-progressbar@2.2.0 clsx tailwind-merge
```

如果从空目录开始，可以用 Vite 的 React TypeScript 模板，复制文件后运行 `npm run dev`。

```sh
npm create vite@latest agent-composer-demo -- --template react-ts
cd agent-composer-demo
npm install
```

把以下组件放到 `src/App.tsx`，并将四个核心文件与 `LUCIDE-LICENSE.txt` 复制到 `src/`。

```tsx
import { DeepAgentComposer } from "./DeepAgentComposer";

export default function App() {
  return <DeepAgentComposer />;
}
```

四个核心文件分别为 [DeepAgentComposer.tsx](./DeepAgentComposer.tsx)、[DeepAgentComposerEngine.js](./DeepAgentComposerEngine.js)、[motion-runtime.ts](./motion-runtime.ts) 和 [DeepAgentComposerEngine.d.ts](./DeepAgentComposerEngine.d.ts)。独立滑块入口为 [ReasoningEffortSlider.tsx](./ReasoningEffortSlider.tsx)。

```tsx
import { useState } from "react";
import { ReasoningEffortSlider } from "./ReasoningEffortSlider";
import type { Effort } from "./DeepAgentComposerEngine.js";

export default function App() {
  const [value, setValue] = useState<Effort>("medium");
  return <ReasoningEffortSlider options={{ value, onValueChange: setValue, height: 120 }} />;
}
```

滑块选项包括 `value`、`onValueChange`、`disabled`、`height` 和 `reducedMotion`。手势提交新档位时，组件发送 `thinking-change`，值可从 `event.detail.value` 读取。档位为 `simple`、`medium`、`deep`，默认 `medium`。由接入方把界面档位映射到模型参数。

输入框另有 `models`、`selectedModel`、`onModelChange`、`busy`、`stopping`、`onStop`、`onPermissionChange` 和 `onSubmit`。提交回调收到 `text/model/thinking/attachments/skills/mentions/permission`，支持返回 Promise，失败时恢复提交按钮并保留草稿。示例模型、文件读取和界面交互均在本地运行。提交到真实 Agent 的逻辑由接入方提供。

## 框架入口

所有入口均使用上述依赖，需要真实的 React 与 React DOM。使用当前框架的正常构建工具，并安装该框架；Preact 项目需保留原版引擎中 React 导入的解析，避免将其全局重写为 `preact/compat`。

| 框架    | 入口                           | 用法                                                      |
| ------- | ------------------------------ | --------------------------------------------------------- |
| React   | `DeepAgentComposer.tsx`        | `<DeepAgentComposer options={options} />`                 |
| Vue     | `DeepAgentComposer.vue`        | 导入组件后使用 `<DeepAgentComposer :options="options" />` |
| Svelte  | `DeepAgentComposer.svelte`     | 导入组件后使用 `<DeepAgentComposer {options} />`          |
| Solid   | `DeepAgentComposer.solid.tsx`  | `<DeepAgentComposer options={options()} />`               |
| Preact  | `DeepAgentComposer.preact.tsx` | `<DeepAgentComposer options={options} />`                 |
| Vanilla | `DeepAgentComposer.vanilla.ts` | `mount(target, options)`                                  |

Vanilla 使用 TypeScript 感知的构建工具，例如 Vite。把以下代码放到页面加载的模块中，并提供 `<div id="composer"></div>`。

```ts
import { mount } from "./DeepAgentComposer.vanilla";

const target = document.getElementById("composer");
if (!(target instanceof HTMLElement)) throw new Error("缺少输入框容器");

const instance = mount(target, { height: 260 });
instance.update({ height: 260, reducedMotion: true });
// 页面或路由卸载时调用 instance.destroy()。
```

`update` 接收新的选项对象，组件草稿与当前交互状态会保持。非 React 项目也可以直接调用引擎的 `mountReasoningEffortSlider`，它同样返回 `update` 和 `destroy`。
