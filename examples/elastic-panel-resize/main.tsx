import { createRoot } from "react-dom/client";
import { ElasticPanelResize } from "../../src/renderer/components/elastic-panel-resize/ElasticPanelResize";

export default function App() {
  return <ElasticPanelResize />;
}

const host = document.querySelector("#demo");
if (host) createRoot(host).render(<App />);
