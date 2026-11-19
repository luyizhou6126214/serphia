# 弹性面板缩放

从 Serphia 仓库根目录运行：

```sh
npm ci
npm exec vite -- examples/elastic-panel-resize --port 5174
```

打开 [React 示例](http://localhost:5174/)。运行 `npm run dev` 可在 Serphia 的会话首页体验左右两条分隔线。

React 版本的完整源码包括以下四个文件。

- [ElasticPanelResize.tsx](../../src/renderer/components/elastic-panel-resize/ElasticPanelResize.tsx) 提供 React 入口。
- [ElasticPanelResizeEngine.js](../../src/renderer/components/elastic-panel-resize/ElasticPanelResizeEngine.js) 提供 DOM、SVG、隔离样式、指针状态及动画计算。
- [motion-runtime.ts](../../src/renderer/components/elastic-panel-resize/motion-runtime.ts) 管理实例的挂载、更新和销毁。
- [ElasticPanelResizeEngine.d.ts](../../src/renderer/components/elastic-panel-resize/ElasticPanelResizeEngine.d.ts) 定义选项和接口。

```tsx
import { ElasticPanelResize } from "./ElasticPanelResize";

export default function App() {
  return <ElasticPanelResize />;
}
```

把共享组件目录中的四个公开文件放在同一个目录即可在已有 React 项目使用。运行依赖为 `npm install react react-dom`。`height` 可传像素数值或 CSS 长度字符串，省略时随容器宽度保持 1:1。`reducedMotion` 默认跟随系统设置，可传布尔值覆盖。

## 其他入口

| 框架     | 入口                                                             | 运行依赖               |
| -------- | ---------------------------------------------------------------- | ---------------------- |
| Vue 3    | [ElasticPanelResize.vue](./ElasticPanelResize.vue)               | `npm install vue`      |
| Svelte 5 | [ElasticPanelResize.svelte](./ElasticPanelResize.svelte)         | `npm install svelte`   |
| Solid    | [ElasticPanelResize.solid.tsx](./ElasticPanelResize.solid.tsx)   | `npm install solid-js` |
| Preact   | [ElasticPanelResize.preact.ts](./ElasticPanelResize.preact.ts)   | `npm install preact`   |
| Vanilla  | [ElasticPanelResize.vanilla.js](./ElasticPanelResize.vanilla.js) | 无                     |

在各框架项目中导入对应入口并渲染 `<ElasticPanelResize />`。Vue、Svelte、Solid 使用对应框架的编译配置。复制到其他项目时，将入口的相对导入改为共享文件所在目录。Vanilla 通过本地 HTTP 服务加载 ES 模块，挂载示例：

```js
import { mount } from "./ElasticPanelResize.vanilla.js";

const host = document.querySelector("#demo");
const panel = mount(host, { height: 480 });
panel.update({ height: 600, reducedMotion: true });
// 在页面或路由卸载时调用。
panel.destroy();
```

Serphia 中，两条分隔线使用相同的 DOM/SVG 交互。左侧保留 248px 初始宽度，右侧保留现有的工具类型宽度记忆。窄屏继续使用覆盖式侧栏。方向键移动分隔线，Shift 放大步长，Home / End 将对应面板设为最大 / 最小，双击或在非拖动状态按 Escape 重置。拖动中按 Escape 取消本次修改。

交互参考 [LeiBox 弹性面板缩放](https://leibox.pantoria.cn/docs/animations/elastic-panel-resize)，设计参考来自 Alvish。
