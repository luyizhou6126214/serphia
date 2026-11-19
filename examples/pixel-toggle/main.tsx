import { useState } from "react";
import { createRoot } from "react-dom/client";
import { PixelToggle } from "../../src/renderer/components/pixel-toggle/PixelToggle";

const sample = `import { PixelToggle } from "./PixelToggle";

export default function App() {
  return <PixelToggle />;
}`;

function Demo() {
  const [day, setDay] = useState(false);
  const [renderer, setRenderer] = useState<"webgl2" | "canvas2d" | "css">("webgl2");
  const [copyStatus, setCopyStatus] = useState("");
  const [copying, setCopying] = useState(false);

  async function copyExample() {
    setCopying(true);
    setCopyStatus("");
    try {
      await navigator.clipboard.writeText(sample);
      setCopyStatus("已复制 React 示例");
    } catch {
      setCopyStatus("复制失败，请检查浏览器的剪贴板权限");
    } finally {
      setCopying(false);
    }
  }

  return (
    <main>
      <h1>像素日夜开关</h1>
      <div className="preview">
        <PixelToggle checked={day} onCheckedChange={setDay} onRendererChange={setRenderer} label="日间模式" />
      </div>
      <div className="demo-actions">
        <button className="copy-example" onClick={() => void copyExample()} disabled={copying}>
          {copying ? "正在复制" : "复制 React 示例"}
        </button>
        <output>{`${day ? "日间模式" : "夜间模式"}${renderer === "webgl2" ? "" : renderer === "canvas2d" ? " · WebGL2 不可用，已切换到 Canvas 2D" : " · Canvas 不可用，已切换到 CSS"}`}</output>
        <output>{copyStatus}</output>
      </div>
    </main>
  );
}

const host = document.getElementById("demo");
if (host) createRoot(host).render(<Demo />);
