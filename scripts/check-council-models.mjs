// Uses the production NVIDIA adapter and structured validation; credentials stay in this Node process.
// Usage:
//   npm run council:check               -> configured council IDs or production defaults
//   npm run council:check -- a/b c/d    -> only those model IDs
//   npm run council:check -- --catalog  -> short availability scan of the account's catalog
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log("Kullanım: npm run council:check -- [publisher/model ... | --catalog]");
  process.exit(0);
}
const catalog = args.includes("--catalog");
if (args.some((arg) => arg.startsWith("--") && arg !== "--catalog") || (catalog && args.length !== 1)) {
  console.error("Model kimliklerini veya yalnızca --catalog seçeneğini kullan.");
  process.exit(1);
}
createRequire(path.join(root, "package.json"))("@next/env").loadEnvConfig(root, true, { info() {}, error() {} });
if (!process.env.NVIDIA_API_KEY?.trim()) {
  console.error("NVIDIA_API_KEY .env.local içinde yok.");
  process.exit(1);
}

let server;
try {
  // Transform TypeScript server modules with the existing Vite dependency; no browser or listener is opened.
  server = await createServer({
    root, configFile: false, logLevel: "silent", resolve: { alias: { "@": path.join(root, "src") } },
    server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] },
  });
  const { DEFAULT_COUNCIL_MODELS, listCouncilCatalog, probeCouncilModel, probeFailureLabel, modelDiagnosticStatus } =
    await server.ssrLoadModule("/scripts/council-model-probe.ts");
  let models;
  try {
    const configured = process.env.PRISON_COUNCIL_MODELS?.trim();
    models = catalog ? await listCouncilCatalog(process.env)
      : args.length ? args
        : configured ? configured.split(",").map((model) => model.trim()) : [...DEFAULT_COUNCIL_MODELS];
  } catch (error) {
    console.error(`Model listesi alınamadı: ${probeFailureLabel(error)}.`);
    process.exitCode = 1;
  }
  if (models) {
    const modelId = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/i;
    if (!models.length || models.some((model) => model.length > 160 || !modelId.test(model))) {
      console.error("Model listesi geçersiz; publisher/model biçiminde kimlikler kullan.");
      process.exitCode = 1;
    } else {
      models = [...new Set(models)];
      const timeoutMs = catalog ? 20000 : 90000;
      console.log(`${catalog ? "Katalog erişilebilirlik taraması" : "Üretim JSON doğrulaması"}: ${models.length} model (tam yanıt sınırı ${timeoutMs / 1000} sn).`);
      const results = [];
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(3, models.length) }, async () => {
        while (next < models.length) results.push(await probeCouncilModel(models[next++], process.env, timeoutMs));
      }));
      results.sort((left, right) => Number(right.ok) - Number(left.ok) || left.seconds - right.seconds);
      console.table(results.map(({ model, result, seconds }) => ({ model, result, seconds })));
      const { ok, quorumFailed, exitCode } = modelDiagnosticStatus(results, catalog ? "catalog" : args.length ? "explicit" : "council");
      console.log(`${ok}/${results.length} model tam ve geçerli bağlantı JSON'u üretti.${quorumFailed ? " Masa için en az 3 çalışan model gerekir." : ""}`);
      process.exitCode = exitCode;
    }
  }
} catch {
  console.error("Üretim model denetimi başlatılamadı; yerel bağımlılıkları ve yapılandırmayı kontrol et.");
  process.exitCode = 1;
} finally {
  await server?.close();
}
