import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRegistrySearchUrl,
  clearPluginSearchCache,
  normalizePluginSearchEntry,
  resolvePluginTypes,
  searchPluginRegistry,
} from "./plugin-registry.ts";

const REGISTRY = "https://registry.test";

function searchHit(name, overrides = {}) {
  return {
    package: {
      name,
      version: overrides.version ?? "1.2.3",
      description: overrides.description ?? "Fixture Pi package",
      publisher: { username: overrides.publisher ?? "fixture-publisher" },
      license: "MIT",
      keywords: overrides.keywords ?? ["pi-package"],
      links: {
        npm: `https://www.npmjs.com/package/${name}`,
        repository: overrides.repository ?? "git+https://github.com/fixture/repo.git",
      },
    },
    downloads: { monthly: overrides.monthly ?? 1234 },
    updated: overrides.updated ?? "2026-11-01T00:00:00.000Z",
  };
}

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  };
}

function withoutEnv(name, run) {
  const previous = process.env[name];
  delete process.env[name];
  try {
    return run();
  } finally {
    if (previous !== undefined) process.env[name] = previous;
  }
}

function registryFetch(calls, { failManifest = false } = {}) {
  return async (url) => {
    const target = String(url);
    calls.push(target);
    if (target.includes("/-/v1/search")) {
      return jsonResponse({
        objects: [
          searchHit("pi-ext"),
          searchHit("pi-skill", { keywords: ["pi-package", "pi-skill"] }),
          searchHit("unrelated", { keywords: ["ai"] }),
        ],
        total: 3,
      });
    }
    if (failManifest) throw new Error("manifest unavailable");
    if (target.includes("/pi-ext/latest")) return jsonResponse({ name: "pi-ext", pi: { extensions: ["./dist"] } });
    if (target.includes("/pi-skill/latest"))
      return jsonResponse({ name: "pi-skill", keywords: ["pi-package", "pi-skill"] });
    return jsonResponse({ error: "not found" }, 404);
  };
}

test("builds a keyword-scoped npm search URL with offset paging", () => {
  const url = buildRegistrySearchUrl(REGISTRY, "web access", 50, 50);
  assert.equal(url.origin, "https://registry.test");
  assert.equal(url.pathname, "/-/v1/search");
  assert.equal(url.searchParams.get("text"), "keywords:pi-package web access");
  assert.equal(url.searchParams.get("size"), "50");
  assert.equal(url.searchParams.get("from"), "50");

  const browse = buildRegistrySearchUrl(REGISTRY, "", 50, 0);
  assert.equal(browse.searchParams.get("text"), "keywords:pi-package");
  assert.equal(browse.searchParams.get("from"), null);
});

test("normalizes registry hits and drops packages without the pi-package keyword", () => {
  const result = normalizePluginSearchEntry(searchHit("pi-fixture-tool"));
  assert.deepEqual(result, {
    name: "pi-fixture-tool",
    version: "1.2.3",
    description: "Fixture Pi package",
    publisher: "fixture-publisher",
    license: "MIT",
    types: [],
    keywords: ["pi-package"],
    monthlyDownloads: 1234,
    updatedAt: "2026-11-01T00:00:00.000Z",
    repository: "git+https://github.com/fixture/repo.git",
    npmUrl: "https://www.npmjs.com/package/pi-fixture-tool",
  });

  assert.equal(normalizePluginSearchEntry(searchHit("x", { keywords: ["ai"] })), null);
  assert.equal(normalizePluginSearchEntry({ package: {} }), null);
  assert.equal(normalizePluginSearchEntry(null), null);
});

test("pages the registry and returns keyword-derived types immediately", async () => {
  clearPluginSearchCache();
  const calls = [];
  const result = await withoutEnv("PI_OFFLINE", () =>
    searchPluginRegistry({ query: "fixture", page: 1 }, { fetch: registryFetch(calls), registryBase: REGISTRY }),
  );

  const searchCall = new URL(calls[0]);
  assert.equal(searchCall.searchParams.get("from"), null);
  assert.equal(result.source, "npm");
  assert.equal(result.registry, REGISTRY);
  assert.equal(result.page, 1);
  assert.equal(result.hasMore, false);
  assert.equal(result.results.length, 2);
  assert.deepEqual(result.results[0].types, []);
  assert.deepEqual(result.results[1].types, ["skill"]);
  assert.equal(calls.filter((call) => call.endsWith("/latest")).length, 0, "search must not block on manifests");

  const second = await withoutEnv("PI_OFFLINE", () =>
    searchPluginRegistry({ query: "fixture", page: 1 }, { fetch: registryFetch(calls), registryBase: REGISTRY }),
  );
  assert.equal(second.cached, true);
  assert.equal(calls.filter((call) => call.includes("/-/v1/search")).length, 1);
});

test("resolves manifest types on demand, filters invalid names, and caches them", async () => {
  clearPluginSearchCache();
  const calls = [];
  const first = await resolvePluginTypes(["pi-ext", "pi-skill", "../evil", "pi-ext"], {
    fetch: registryFetch(calls),
    registryBase: REGISTRY,
  });
  assert.deepEqual(first["pi-ext"], ["extension"]);
  assert.deepEqual(first["pi-skill"], ["skill"]);
  assert.equal("../evil" in first, false);
  assert.equal(calls.filter((call) => call.endsWith("/latest")).length, 2);

  await resolvePluginTypes(["pi-ext"], { fetch: registryFetch(calls), registryBase: REGISTRY });
  assert.equal(calls.filter((call) => call.endsWith("/latest")).length, 2, "manifest types are cached");

  await assert.rejects(
    () => resolvePluginTypes("pi-ext"),
    (error) => error.code === "BAD_REQUEST",
  );
});

test("requests later pages by offset", async () => {
  clearPluginSearchCache();
  const calls = [];
  await withoutEnv("PI_OFFLINE", () =>
    searchPluginRegistry({ query: "", page: 3 }, { fetch: registryFetch(calls), registryBase: REGISTRY }),
  );
  const url = new URL(calls[0]);
  assert.equal(url.searchParams.get("from"), "100");
});

test("keeps search working when a manifest lookup fails", async () => {
  clearPluginSearchCache();
  const result = await withoutEnv("PI_OFFLINE", () =>
    searchPluginRegistry({ query: "" }, { fetch: registryFetch([], { failManifest: true }), registryBase: REGISTRY }),
  );
  assert.equal(result.results.length, 2);
  assert.deepEqual(result.results[0].types, []);
});

test("rejects bad input, offline mode, and registry failures", async () => {
  clearPluginSearchCache();
  await assert.rejects(
    () => searchPluginRegistry({ query: "x".repeat(200) }, { fetch: async () => jsonResponse({ objects: [] }) }),
    (error) => error.code === "BAD_REQUEST",
  );

  const previous = process.env.PI_OFFLINE;
  process.env.PI_OFFLINE = "1";
  try {
    await assert.rejects(
      () => searchPluginRegistry({ query: "anything" }, { fetch: async () => jsonResponse({ objects: [] }) }),
      (error) => error.code === "BAD_REQUEST" && /offline/i.test(error.message),
    );
  } finally {
    if (previous === undefined) delete process.env.PI_OFFLINE;
    else process.env.PI_OFFLINE = previous;
  }

  await assert.rejects(
    () =>
      searchPluginRegistry(
        { query: "" },
        { fetch: async () => jsonResponse({ error: "boom" }, 503), registryBase: REGISTRY },
      ),
    (error) => error.code === "INTERNAL" && /HTTP 503/.test(error.message),
  );
});
