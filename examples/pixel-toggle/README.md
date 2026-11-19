# 像素日夜开关

从 Serphia 仓库根目录运行以下命令，然后打开 [React 示例](http://127.0.0.1:5187/)。

```sh
npm ci
npm exec vite -- examples/pixel-toggle --host 127.0.0.1 --port 5187 --strictPort
```

运行 `npm run dev` 可在 Serphia 的会话工具栏体验紧凑版。日间对应应用的浅色模式，开关会同步应用与系统提供的主题设置，并保存交互产生的偏好。

## React 接入

在 React 项目中执行 `npm install react react-dom`，将以下四个完整文件放在同一个目录。

- [PixelToggle.tsx](../../src/renderer/components/pixel-toggle/PixelToggle.tsx)
- [PixelToggleEngine.js](../../src/renderer/components/pixel-toggle/PixelToggleEngine.js)
- [motion-runtime.ts](../../src/renderer/components/pixel-toggle/motion-runtime.ts)
- [PixelToggleEngine.d.ts](../../src/renderer/components/pixel-toggle/PixelToggleEngine.d.ts)

```tsx
import { PixelToggle } from "./PixelToggle";

export default function App() {
  return <PixelToggle />;
}
```

| 选项               | 用途                                                       |
| ------------------ | ---------------------------------------------------------- |
| `checked`          | `true` 选中日间。省略时默认为夜间，由组件维护选中状态。    |
| `onCheckedChange`  | 发生用户提交的状态变化时接收布尔值。                       |
| `sound`            | 默认为 `true`，真实点击或键盘激活时响一声。                |
| `height`           | 传像素数值或 CSS 长度。默认最大 720×540，窄屏等比缩放。    |
| `reducedMotion`    | 默认跟随系统偏好，布尔值可显式覆盖。                       |
| `label`            | 为开关提供稳定的无障碍名称，默认 `Day mode`。              |
| `embedded`         | 适配紧凑容器，显示透明背景。                               |
| `onRendererChange` | 初始渲染或渲染器变更时接收 `webgl2`、`canvas2d` 或 `css`。 |

## 其他框架

| 框架     | 完整入口                                           | 安装依赖               |
| -------- | -------------------------------------------------- | ---------------------- |
| Vue 3    | [PixelToggle.vue](./PixelToggle.vue)               | `npm install vue`      |
| Svelte 5 | [PixelToggle.svelte](./PixelToggle.svelte)         | `npm install svelte`   |
| Solid    | [PixelToggle.solid.tsx](./PixelToggle.solid.tsx)   | `npm install solid-js` |
| Preact   | [PixelToggle.preact.ts](./PixelToggle.preact.ts)   | `npm install preact`   |
| Vanilla  | [PixelToggle.vanilla.js](./PixelToggle.vanilla.js) | 无                     |

在已有的对应框架项目中，将选用的入口和共享核心文件放到同一目录，将入口中的仓库相对导入改为本地 `./motion-runtime` 或 `./PixelToggleEngine.js`。Vue 和 Svelte 用默认导入，Solid 和 Preact 用具名导入，然后渲染 `<PixelToggle />`。Vanilla 只需要入口和引擎，可直接通过本地 HTTP 服务加载 ES 模块。

```html
<div id="demo"></div>
<script type="module">
  import { mount } from "./PixelToggle.vanilla.js";

  const instance = mount(document.getElementById("demo"), {
    onCheckedChange: (day) => console.log(day ? "日间" : "夜间"),
  });
  window.addEventListener("pagehide", (event) => {
    if (!event.persisted) instance.destroy();
  });
</script>
```

Vanilla 的 `update(options)` 接收最新的完整选项，省略 `checked` 时保留选中状态。在单页应用卸载宿主前调用 `destroy()`。各框架入口会在组件卸载时自动清理。

交互规格以本次提供的文字为准。[LeiBox 像素日夜开关](https://leibox.pantoria.cn/docs/animations/pixel-toggle)
