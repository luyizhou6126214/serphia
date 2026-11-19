import { importTestBundle } from "#test-bundle";
import assert from "node:assert/strict";
import path from "node:path";
import test, { after } from "node:test";
import { createElement, createRef, useState } from "react";
import { act, create } from "react-test-renderer";

const originals = {
  cancelAnimationFrame: globalThis.cancelAnimationFrame,
  document: globalThis.document,
  fetch: globalThis.fetch,
  localStorage: globalThis.localStorage,
  navigator: globalThis.navigator,
  requestAnimationFrame: globalThis.requestAnimationFrame,
  window: globalThis.window,
};

const storedValues = new Map();
const localStorageMock = {
  getItem(key) {
    return storedValues.get(key) ?? null;
  },
  setItem(key, value) {
    storedValues.set(key, String(value));
  },
  removeItem(key) {
    storedValues.delete(key);
  },
};

const documentMock = {
  addEventListener() {},
  removeEventListener() {},
  body: {},
  documentElement: { lang: "" },
};
const windowMock = {
  addEventListener() {},
  removeEventListener() {},
  innerHeight: 900,
  localStorage: localStorageMock,
  matchMedia() {
    return {
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    };
  },
  navigator: { language: "en-US" },
  piBridge: {
    getPathForFile(file) {
      return file.testPath ?? null;
    },
    async inspectLocalFiles({ paths }) {
      return paths.map((filePath) => ({ path: filePath, exists: true, isFile: true, insideCwd: false }));
    },
  },
  visualViewport: null,
};

Object.defineProperties(globalThis, {
  cancelAnimationFrame: { configurable: true, value() {} },
  document: { configurable: true, value: documentMock },
  localStorage: { configurable: true, value: localStorageMock },
  navigator: { configurable: true, value: windowMock.navigator },
  requestAnimationFrame: {
    configurable: true,
    value(callback) {
      callback(0);
      return 1;
    },
  },
  window: { configurable: true, value: windowMock },
});
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

globalThis.fetch = () => {
  throw new Error("File suggestions must use typed RPC");
};

const { ChatInput, api } = await importTestBundle("src/renderer/components/chat-input-file-reference", {
  mainFields: ["module", "main"],
  stdin: {
    contents: 'export { ChatInput } from "./ChatInput.tsx"; export * as api from "@/lib/api-client";',
    resolveDir: import.meta.dirname,
    sourcefile: "chat-input-file-reference-test-entry.tsx",
    loader: "tsx",
  },
  tsconfig: path.join(import.meta.dirname, "../../../tsconfig.renderer.json"),
  external: ["react", "react-dom", "react-dom/*"],
  plugins: [
    {
      name: "file-index-api",
      setup(build) {
        build.onResolve({ filter: /^@\/lib\/api-client$/ }, () => ({ path: "api", namespace: "index-test" }));
        build.onLoad({ filter: /.*/, namespace: "index-test" }, () => ({
          contents: `
      export const requests = [];
      export const defaultImplementation = async () => ({files: ["src/main.ts", "src/renderer/App.tsx", "README.md"], truncated: false});
      let implementation = defaultImplementation;
      export function use(next) {implementation = next;}
      export async function fileIndex(root, query) {requests.push({root, query}); return implementation(root, query);}
      export async function call(method) {
        if (method !== "mcp.config.get") throw new Error("Unexpected composer RPC: " + method);
        return { entries: [{ name: "docs", scope: "global", config: { enabled: false } }] };
      }
      export async function subscribe() { throw new Error("The welcome composer has no MCP session"); }
    `,
        }));
      },
    },
  ],
});

after(() => {
  for (const [key, value] of Object.entries(originals)) {
    if (value === undefined) delete globalThis[key];
    else Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
});

function keyboardEvent(key) {
  return {
    key,
    shiftKey: false,
    nativeEvent: { isComposing: false, keyCode: key === "Enter" ? 13 : 0 },
    preventDefault() {},
  };
}

function renderedText(node) {
  return node.children.map((child) => (typeof child === "string" ? child : renderedText(child))).join("");
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

test("@ project file autocomplete survives component state and sends the completed reference", async () => {
  const sent = [];
  const textareaNode = {
    focus() {},
    scrollHeight: 24,
    selectionEnd: 0,
    selectionStart: 0,
    setSelectionRange(start, end) {
      this.selectionStart = start;
      this.selectionEnd = end;
    },
    style: {},
    value: "",
  };

  let renderer;
  await act(async () => {
    renderer = create(
      createElement(ChatInput, {
        cwd: "/workspace/project",
        isStreaming: false,
        onAbort() {},
        onSend(message) {
          sent.push(message);
        },
      }),
      {
        createNodeMock(element) {
          return element.type === "textarea" ? textareaNode : null;
        },
      },
    );
  });

  const inputText = "@src/";
  textareaNode.value = inputText;
  textareaNode.selectionStart = inputText.length;
  textareaNode.selectionEnd = inputText.length;
  await act(async () => {
    renderer.root.findByType("textarea").props.onChange({ target: textareaNode });
  });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));

  assert.equal(api.requests.length, 1);
  assert.deepEqual(api.requests[0], { root: "/workspace/project", query: "src/" });
  assert.ok(
    renderer.root
      .findAllByType("button")
      .some((button) => button.findAll((node) => node.type === "span" && node.children.includes("main.ts")).length > 0),
  );

  await act(async () => {
    renderer.root.findByType("textarea").props.onKeyDown(keyboardEvent("ArrowDown"));
  });
  await act(async () => {
    renderer.root.findByType("textarea").props.onKeyDown(keyboardEvent("Enter"));
  });
  assert.equal(renderer.root.findByType("textarea").props.value, "@src/main.ts ");
  assert.deepEqual(sent, [], "completion Enter must not submit the prompt");

  await act(async () => {
    renderer.root.findByType("textarea").props.onKeyDown(keyboardEvent("Enter"));
    await Promise.resolve();
  });
  assert.deepEqual(sent, ["@src/main.ts"]);

  await act(async () => renderer.unmount());
});

test("@ autocomplete ignores old results, errors and settlement without retiring the current request", async () => {
  const pending = [];
  api.use(() => {
    const request = deferred();
    pending.push(request);
    return request.promise;
  });
  const textareaNode = {
    focus() {},
    scrollHeight: 24,
    selectionEnd: 0,
    selectionStart: 0,
    setSelectionRange(start, end) {
      this.selectionStart = start;
      this.selectionEnd = end;
    },
    style: {},
    value: "",
  };
  let renderer;
  try {
    await act(async () => {
      renderer = create(
        createElement(ChatInput, { cwd: "/workspace/project", isStreaming: false, onAbort() {}, onSend() {} }),
        { createNodeMock: (element) => (element.type === "textarea" ? textareaNode : null) },
      );
    });
    const requestStart = api.requests.length;

    textareaNode.value = "@mai";
    textareaNode.selectionStart = textareaNode.value.length;
    textareaNode.selectionEnd = textareaNode.value.length;
    await act(async () => renderer.root.findByType("textarea").props.onChange({ target: textareaNode }));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 175)));
    assert.equal(api.requests[requestStart].query, "mai");

    textareaNode.value = "@read";
    textareaNode.selectionStart = textareaNode.value.length;
    textareaNode.selectionEnd = textareaNode.value.length;
    await act(async () => renderer.root.findByType("textarea").props.onChange({ target: textareaNode }));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 175)));
    assert.equal(api.requests[requestStart + 1].query, "read");

    await act(async () => {
      pending[1].resolve({ matches: [{ path: "README.md", isDir: false }], truncated: false });
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    assert.match(renderedText(renderer.root), /README\.md/);

    await act(async () => {
      pending[0].resolve({ matches: [{ path: "src/main.ts", isDir: false }], truncated: false });
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    assert.doesNotMatch(renderedText(renderer.root), /main\.ts/);

    for (const query of ["old-error", "current"]) {
      textareaNode.value = `@${query}`;
      textareaNode.selectionStart = textareaNode.selectionEnd = textareaNode.value.length;
      await act(async () => renderer.root.findByType("textarea").props.onChange({ target: textareaNode }));
      await act(async () => new Promise((resolve) => setTimeout(resolve, 175)));
    }
    await act(async () => pending[2].reject(new Error("Old query failed")));
    await act(async () => pending[3].resolve({ matches: [{ path: "current.txt" }], truncated: false }));
    assert.match(renderedText(renderer.root), /current\.txt/);
    assert.doesNotMatch(renderedText(renderer.root), /Old query failed|Unable to load/);
    assert.equal(renderer.root.findByType("textarea").props.value, "@current");

    textareaNode.value = "@failed";
    textareaNode.selectionStart = textareaNode.selectionEnd = textareaNode.value.length;
    await act(async () => renderer.root.findByType("textarea").props.onChange({ target: textareaNode }));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 175)));
    await act(async () => pending[4].reject(new Error("Current query failed")));
    assert.match(renderedText(renderer.root), /File suggestions are temporarily unavailable/);
    assert.equal(renderer.root.findByType("textarea").props.value, "@failed");

    textareaNode.value = "@recovered";
    textareaNode.selectionStart = textareaNode.selectionEnd = textareaNode.value.length;
    await act(async () => renderer.root.findByType("textarea").props.onChange({ target: textareaNode }));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 175)));
    await act(async () => pending[5].resolve({ matches: [{ path: "recovered.txt" }], truncated: false }));
    assert.match(renderedText(renderer.root), /recovered\.txt/);
    assert.doesNotMatch(renderedText(renderer.root), /temporarily unavailable/);
  } finally {
    api.use(api.defaultImplementation);
    if (renderer) await act(async () => renderer.unmount());
  }
});

test("@ autocomplete shows degraded scope and reuses a recent query from the bounded cache", async () => {
  api.use(async () => ({
    matches: [{ path: "Desktop/nested.txt", isDir: false }],
    truncated: false,
    degradedReason: "search-unavailable",
  }));
  const textareaNode = {
    focus() {},
    scrollHeight: 24,
    selectionEnd: 0,
    selectionStart: 0,
    setSelectionRange(start, end) {
      this.selectionStart = start;
      this.selectionEnd = end;
    },
    style: {},
    value: "",
  };
  let renderer;
  try {
    await act(async () => {
      renderer = create(
        createElement(ChatInput, { cwd: "/workspace/project", isStreaming: false, onAbort() {}, onSend() {} }),
        { createNodeMock: (element) => (element.type === "textarea" ? textareaNode : null) },
      );
    });
    const requestStart = api.requests.length;
    textareaNode.value = "@nest";
    textareaNode.selectionStart = textareaNode.value.length;
    textareaNode.selectionEnd = textareaNode.value.length;
    await act(async () => renderer.root.findByType("textarea").props.onChange({ target: textareaNode }));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 175)));
    assert.match(renderedText(renderer.root), /limited to this folder/);
    assert.equal(api.requests.length, requestStart + 1);

    textareaNode.value = "";
    textareaNode.selectionStart = 0;
    textareaNode.selectionEnd = 0;
    await act(async () => renderer.root.findByType("textarea").props.onChange({ target: textareaNode }));
    textareaNode.value = "@nest";
    textareaNode.selectionStart = textareaNode.value.length;
    textareaNode.selectionEnd = textareaNode.value.length;
    await act(async () => {
      renderer.root.findByType("textarea").props.onChange({ target: textareaNode });
      await Promise.resolve();
    });
    assert.equal(api.requests.length, requestStart + 1);
    assert.match(renderedText(renderer.root), /Desktop\/nested\.txt/);
  } finally {
    api.use(api.defaultImplementation);
    if (renderer) await act(async () => renderer.unmount());
  }
});

test("@ project references and absolute local file references keep their distinct wire formats", async () => {
  const sent = [];
  const handle = createRef();
  const textareaNode = {
    focus() {},
    scrollHeight: 24,
    selectionEnd: 0,
    selectionStart: 0,
    setSelectionRange(start, end) {
      this.selectionStart = start;
      this.selectionEnd = end;
    },
    style: {},
    value: "",
  };
  let renderer;
  await act(async () => {
    renderer = create(
      createElement(ChatInput, {
        cwd: "/workspace/project",
        isStreaming: false,
        onAbort() {},
        onSend(message) {
          sent.push(message);
        },
        ref: handle,
      }),
      { createNodeMock: (element) => (element.type === "textarea" ? textareaNode : null) },
    );
  });

  await act(async () => {
    handle.current.addFiles([{ name: "notes local.txt", testPath: "/tmp/notes local.txt", type: "text/plain" }]);
    await Promise.resolve();
  });
  const inputText = "@src/main.ts ";
  textareaNode.value = inputText;
  textareaNode.selectionStart = inputText.length;
  textareaNode.selectionEnd = inputText.length;
  await act(async () => {
    renderer.root.findByType("textarea").props.onChange({ target: textareaNode });
  });
  await act(async () => {
    renderer.root.findByType("textarea").props.onKeyDown(keyboardEvent("Enter"));
    await Promise.resolve();
  });

  assert.deepEqual(sent, ["@src/main.ts [notes local.txt](file:///tmp/notes%20local.txt)"]);
  await act(async () => renderer.unmount());
});

test("streaming image queue attempts keep the complete draft in the composer", async () => {
  const draftKey = `image-queue-${Date.now()}`;
  storedValues.set(
    `pi-desktop-draft:${draftKey}`,
    JSON.stringify({
      schemaVersion: 2,
      value: "send after the current response",
      images: [{ data: "YQ==", mimeType: "image/png" }],
      files: [],
      updatedAt: Date.now(),
    }),
  );
  const queued = [];
  const textareaNode = {
    focus() {},
    scrollHeight: 24,
    selectionEnd: 0,
    selectionStart: 0,
    setSelectionRange() {},
    style: {},
    value: "send after the current response",
  };
  let renderer;
  await act(async () => {
    renderer = create(
      createElement(ChatInput, {
        draftKey,
        isStreaming: true,
        onAbort() {},
        onFollowUp(message) {
          queued.push(message);
        },
        onSend() {},
      }),
      { createNodeMock: (element) => (element.type === "textarea" ? textareaNode : null) },
    );
  });

  assert.equal(
    renderer.root.findAllByType("button").some((button) => button.children.includes("Follow-up")),
    false,
  );
  await act(async () =>
    renderer.root.findByType("textarea").props.onKeyDown({
      ...keyboardEvent("Enter"),
      currentTarget: textareaNode,
    }),
  );

  assert.deepEqual(queued, []);
  assert.equal(renderer.root.findByType("textarea").props.value, "send after the current response");
  assert.equal(renderer.root.findAllByType("img").length, 1);
  assert.ok(
    renderer.root
      .findAll((node) => node.props?.role === "alert")
      .some((node) => renderedText(node).includes("Image messages can be sent after")),
  );
  await act(async () => renderer.unmount());
});

test("a fifth image is rejected with the image limit message instead of a storage failure", async () => {
  const draftKey = `image-limit-${Date.now()}`;
  storedValues.set(
    `pi-desktop-draft:${draftKey}`,
    JSON.stringify({
      schemaVersion: 2,
      value: "",
      images: Array.from({ length: 4 }, () => ({ data: "YQ==", mimeType: "image/png" })),
      files: [],
      updatedAt: Date.now(),
    }),
  );
  const fileReaderDescriptor = Object.getOwnPropertyDescriptor(globalThis, "FileReader");
  const createObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  const revokeObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
  const revoked = [];
  Object.defineProperty(globalThis, "FileReader", {
    configurable: true,
    value: class FileReaderMock {
      readAsDataURL(file) {
        this.result = `data:${file.type};base64,YQ==`;
        globalThis.queueMicrotask(() => this.onload?.());
      }
    },
  });
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: (file) => `blob:${file.name}`,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: (url) => revoked.push(url),
  });

  const handle = createRef();
  let renderer;
  try {
    await act(async () => {
      renderer = create(
        createElement(ChatInput, {
          draftKey,
          isStreaming: false,
          onAbort() {},
          onSend() {},
          ref: handle,
        }),
      );
    });
    await act(async () => {
      handle.current.addFiles([{ name: "fifth.png", type: "image/png" }]);
      await Promise.resolve();
      await Promise.resolve();
    });

    assert.equal(renderer.root.findAllByType("img").length, 4);
    const alerts = renderer.root.findAll((node) => node.props?.role === "alert").map(renderedText);
    assert.ok(alerts.some((text) => text.includes("A draft can save up to 4 images")));
    assert.equal(
      alerts.some((text) => text.includes("could not be saved on this device")),
      false,
    );
    assert.deepEqual(revoked, ["blob:fifth.png"]);
    await act(async () => renderer.unmount());
  } finally {
    if (fileReaderDescriptor) Object.defineProperty(globalThis, "FileReader", fileReaderDescriptor);
    else delete globalThis.FileReader;
    if (createObjectUrlDescriptor) Object.defineProperty(URL, "createObjectURL", createObjectUrlDescriptor);
    else delete URL.createObjectURL;
    if (revokeObjectUrlDescriptor) Object.defineProperty(URL, "revokeObjectURL", revokeObjectUrlDescriptor);
    else delete URL.revokeObjectURL;
  }
});

test("a second slash skill completes at the caret without replacing existing references", async () => {
  const textareaNode = {
    focus() {},
    scrollHeight: 24,
    selectionEnd: 0,
    selectionStart: 0,
    setSelectionRange(start, end) {
      this.selectionStart = start;
      this.selectionEnd = end;
    },
    style: {},
    value: "",
  };
  let renderer;
  await act(async () => {
    renderer = create(
      createElement(ChatInput, {
        cwd: "/workspace/project",
        isStreaming: false,
        onAbort() {},
        onSend() {},
        slashCommands: [{ name: "skill:second", description: "Second skill", source: "skill" }],
      }),
      { createNodeMock: (element) => (element.type === "textarea" ? textareaNode : null) },
    );
  });
  textareaNode.value = "/skill:first @file.ts /ski existing text";
  textareaNode.selectionStart = textareaNode.selectionEnd = textareaNode.value.indexOf(" existing");
  await act(async () => renderer.root.findByType("textarea").props.onChange({ target: textareaNode }));
  assert.ok(renderer.root.findAllByType("button").some((button) => renderedText(button).includes("second")));
  await act(async () => renderer.root.findByType("textarea").props.onKeyDown(keyboardEvent("Enter")));
  assert.equal(renderer.root.findByType("textarea").props.value, "/skill:first @file.ts /skill:second  existing text");
  await act(async () => renderer.unmount());
});

test("the slash menu supports browsing, keyboard selection, and search for plugin commands and templates", async (t) => {
  const textareaNode = {
    focus() {},
    setSelectionRange() {},
    scrollHeight: 24,
    selectionStart: 0,
    selectionEnd: 0,
    style: {},
    value: "",
  };
  const packageSource = { path: "/plugins/package", source: "npm:fixture", scope: "user", origin: "package" };
  let renderer;
  await act(async () => {
    renderer = create(
      createElement(ChatInput, {
        welcome: true,
        isStreaming: false,
        onSend() {},
        slashCommands: [
          {
            name: "subagents-doctor",
            description: "Plugin diagnostics",
            source: "extension",
            sourceInfo: packageSource,
          },
          {
            name: "parallel-review",
            description: "Plugin review workflow",
            source: "prompt",
            sourceInfo: packageSource,
          },
          { name: "my-review", description: "Personal review template", source: "prompt" },
          { name: "skill:review", description: "Review skill", source: "skill", sourceInfo: packageSource },
        ],
      }),
      { createNodeMock: (element) => (element.type === "textarea" ? textareaNode : null) },
    );
  });
  t.after(() => act(async () => renderer.unmount()));

  const textarea = () => renderer.root.findByType("textarea");
  const options = () => renderer.root.findAllByType("button").map((button) => button.props.title);
  const toggle = () =>
    renderer.root.findAllByType("button").find((button) => renderedText(button) === "Plugin commands and templates");
  async function type(value) {
    textareaNode.value = value;
    textareaNode.selectionStart = textareaNode.selectionEnd = value.length;
    await act(async () => textarea().props.onChange({ target: textareaNode }));
  }

  await type("/");
  assert.ok(options().includes("Copy the last assistant message"));
  assert.ok(options().includes("Personal review template"));
  assert.ok(options().includes("Review skill"));
  assert.ok(!options().includes("Plugin diagnostics"));
  assert.ok(!options().includes("Plugin review workflow"));
  assert.equal(toggle()?.props["aria-expanded"], false);
  await act(async () => toggle().props.onClick());
  assert.equal(toggle()?.props["aria-expanded"], true);
  assert.ok(options().includes("Plugin diagnostics"));
  assert.ok(options().includes("Plugin review workflow"));
  await act(async () => toggle().props.onClick());
  assert.equal(toggle()?.props["aria-expanded"], false);
  assert.ok(!options().includes("Plugin diagnostics"));
  // The last row stays selected when it collapses, so Enter reopens it from the text field.
  await act(async () => textarea().props.onKeyDown(keyboardEvent("Enter")));
  assert.equal(toggle()?.props["aria-expanded"], true);
  await act(async () => textarea().props.onKeyDown(keyboardEvent("Enter")));
  assert.equal(textarea().props.value, "/subagents-doctor ");
  await type("/");
  assert.equal(toggle()?.props["aria-expanded"], false);
  await type("/parallel");
  assert.equal(toggle(), undefined);
  assert.ok(options().includes("Plugin review workflow"));
  await type("/subagents-doc");
  assert.ok(options().includes("Plugin diagnostics"));
  await act(async () => textarea().props.onKeyDown(keyboardEvent("Enter")));
  assert.equal(textarea().props.value, "/subagents-doctor ");
});

test("the welcome composer displays MCP status above the editable input", async (t) => {
  const onOpenMcpServers = t.mock.fn();
  const onSend = t.mock.fn();
  const textareaNode = { focus() {}, scrollHeight: 24, selectionEnd: 0, selectionStart: 0, style: {}, value: "" };
  function Harness() {
    const [open, setOpen] = useState(false);
    return createElement(ChatInput, {
      welcome: true,
      isStreaming: false,
      onSend,
      onOpenMcpServers() {
        onOpenMcpServers();
        setOpen(true);
      },
      mcpServerList: open ? { sessionId: null, onClose: () => setOpen(false) } : undefined,
    });
  }
  let renderer;
  await act(async () => {
    renderer = create(createElement(Harness), {
      createNodeMock: (element) => (element.type === "textarea" ? textareaNode : null),
    });
  });
  t.after(() => act(async () => renderer.unmount()));

  const textarea = () => renderer.root.findByType("textarea");
  async function type(value) {
    textareaNode.value = value;
    textareaNode.selectionStart = textareaNode.selectionEnd = value.length;
    await act(async () => textarea().props.onChange({ target: textareaNode }));
  }

  await type("/mcp");
  const option = renderer.root
    .findAllByType("button")
    .find((button) => button.props.title === "Show MCP server status");
  assert.ok(option);
  assert.match(renderedText(option), /^MCPShow MCP server status$/);
  await act(async () => textarea().props.onKeyDown(keyboardEvent("Enter")));
  assert.equal(onOpenMcpServers.mock.callCount(), 1);
  const panel = renderer.root.findByProps({ "data-mcp-server-list": true });
  assert.equal(panel.type, "section");
  assert.match(renderedText(panel), /docsDisabled/);
  assert.doesNotMatch(renderedText(panel), /Global|Current project/);
  assert.equal(renderer.root.findAllByType("dialog").length, 0);

  await type("Continue writing");
  assert.equal(textarea().props.value, "Continue writing");
  const panelSlot = panel.parent.parent;
  assert.equal(panelSlot.props.hidden, false);
  const column = renderer.root.findByProps({ className: "chat-content-column" });
  assert.equal(panelSlot.parent, column);
  await act(async () => column.props.onKeyDown(keyboardEvent("Escape")));
  assert.equal(renderer.root.findAllByProps({ "data-mcp-server-list": true }).length, 0);
  assert.equal(textarea().props.value, "Continue writing");

  await type("/mcp ");
  assert.equal(renderer.root.findAllByProps({ "data-reference-kind": "mcp" }).length, 0);
  await act(async () => renderer.root.findByProps({ "aria-label": "Send" }).props.onClick());
  assert.equal(onOpenMcpServers.mock.callCount(), 2);
  assert.equal(onSend.mock.callCount(), 0);
  assert.equal(textarea().props.value, "");
});

test("staged messages remain available to send if the current run finishes", async () => {
  const sent = [];
  const node = {
    value: "",
    selectionStart: 0,
    selectionEnd: 0,
    scrollHeight: 24,
    style: {},
    focus() {},
    setSelectionRange() {},
  };
  const props = {
    draftKey: `pending-idle-${Date.now()}`,
    isStreaming: true,
    onAbort() {},
    onSteer() {},
    onFollowUp() {},
    onSend(message) {
      sent.push(message);
    },
  };
  let renderer;
  await act(async () => {
    renderer = create(createElement(ChatInput, props), {
      createNodeMock: (element) => (element.type === "textarea" ? node : null),
    });
  });
  node.value = "keep this pending";
  node.selectionStart = node.selectionEnd = node.value.length;
  await act(async () => renderer.root.findByType("textarea").props.onChange({ target: node }));
  await act(async () =>
    renderer.root.findByType("textarea").props.onKeyDown({ ...keyboardEvent("Enter"), currentTarget: node }),
  );
  assert.deepEqual(sent, []);
  await act(async () =>
    renderer.update(
      createElement(ChatInput, { ...props, isStreaming: false, onSteer: undefined, onFollowUp: undefined }),
    ),
  );
  assert.ok(renderer.root.findAll((item) => item.props.className === "composer-pending-row").length);
  const panel = renderer.root.find((item) => item.props.className === "composer-pending-actions");
  const sendButton = panel.findAllByType("button").find((button) => renderedText(button) === "Send");
  assert.ok(sendButton);
  await act(async () => {
    await sendButton.props.onClick();
  });
  assert.deepEqual(sent, ["keep this pending"]);
  assert.equal(renderer.root.findAll((item) => item.props.className === "composer-pending-row").length, 0);
  await act(async () => renderer.unmount());
});
