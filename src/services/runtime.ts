import path from "node:path";
import type { EngineStatus } from "./ai/config";
import type { CouncilDeps } from "./ai/council-config";
import type { EngineHealthResult } from "@/models/engine-health";
import { createEngineConnectionCheck } from "./ai/health";
import { createPrisonOperationState, PrisonService, type PrisonOperationState } from "./prison-service";
import { FilePrisonRepository } from "./storage/file-repository";
import { FileOperationRepository } from "./storage/operation-repository";
import { FileCouncilCheckpointRepository } from "./storage/council-checkpoint-repository";
import { OperationManager, createOperationManagerState, type OperationManagerState } from "./operation-manager";
import { configuredProviders, providerTopologyKey } from "./ai/provider-settings";
import { FileProviderSettingsRepository } from "./storage/provider-settings-repository";

interface Runtime {
  service: PrisonService;
  engine: EngineStatus;
  council: CouncilDeps | null;
  checkEngine: () => Promise<EngineHealthResult>;
  operations: OperationManager;
}

/**
 * Providers and service code refresh with their module. In-flight operations retain only
 * their lock and progress across route bundles and dev hot reloads in this process.
 */
let runtime: Runtime | null = null;
let runtimeSettingsKey: string | null = null;

const OPERATION_STATES = Symbol.for("prison.runtime.operation-states.v1");
type OperationStateRegistry = Map<string, PrisonOperationState>;
const processGlobal = globalThis as typeof globalThis & { [OPERATION_STATES]?: OperationStateRegistry };
const JOB_STATES = Symbol.for("prison.runtime.jobs.v1");
const jobGlobal = globalThis as typeof globalThis & { [JOB_STATES]?: Map<string, OperationManagerState> };

export function getRuntimeJobState(dataDir: string): OperationManagerState {
  const resolved = path.resolve(dataDir);
  const key = process.platform === "win32" ? resolved.toLowerCase() : resolved;
  const registry = jobGlobal[JOB_STATES] ??= new Map();
  let state = registry.get(key);
  if (!state) { state = createOperationManagerState(); registry.set(key, state); }
  return state;
}

export function getRuntimeOperationState(dataDir: string): PrisonOperationState {
  const resolved = path.resolve(dataDir);
  const key = process.platform === "win32" ? resolved.toLowerCase() : resolved;
  const registry = processGlobal[OPERATION_STATES] ??= new Map();
  let state = registry.get(key);
  if (!state) {
    state = createPrisonOperationState();
    registry.set(key, state);
  }
  return state;
}

export function getRuntimeDataDir(): string {
  return path.resolve(/* turbopackIgnore: true */ process.env.PRISON_DATA_DIR?.trim() || path.join(process.cwd(), "data", "prisons"));
}

export function getRuntime(): Runtime {
  const dir = getRuntimeDataDir();
  const saved = new FileProviderSettingsRepository(dir).loadSync();
  const settingsKey = `${dir}:${saved?.revision ?? "environment"}`;
  if (!runtime || settingsKey !== runtimeSettingsKey) {
    // Existing jobs have already closed over the old service and credentialed clients.
    const { engine, provider, council } = configuredProviders(saved);
    const checkpointDir = saved ? path.join(dir, ".council-checkpoints", providerTopologyKey(saved)) : path.join(dir, ".council-checkpoints");
    const service = new PrisonService(new FilePrisonRepository(dir), provider, undefined, council, getRuntimeOperationState(dir), new FileCouncilCheckpointRepository(checkpointDir));
    runtime = {
      engine,
      council,
      service,
      operations: new OperationManager(new FileOperationRepository(path.join(dir, ".operations")), service, getRuntimeJobState(dir)),
      checkEngine: createEngineConnectionCheck(engine, provider),
    };
    runtimeSettingsKey = settingsKey;
  }
  return runtime;
}
