import { Type, type Static, type TSchema } from '@sinclair/typebox';
import { Ajv, type ValidateFunction } from 'ajv';
const object = <T extends Record<string, TSchema>>(properties: T) =>
  Type.Object(properties, { additionalProperties: false });
const time = Type.Number({ minimum: 0 });
const ns = Type.String({ pattern: '^[0-9]+$' });
const positive = Type.Number({ exclusiveMinimum: 0 });
const pathSafeId = Type.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$' });
/** Stable filesystem-safe identifier and a separate human-readable display name. */
export const NamedEntitySchema = object({ id: pathSafeId, name: Type.String({ minLength: 1 }) });
export type NamedEntity = Static<typeof NamedEntitySchema>;
export type NamedEntityType = NamedEntity;
export const StampSchema = object({
  clock: Type.Union([Type.Literal('harness'), Type.Literal('reporter')]),
  t: time,
});
export type Stamp = Static<typeof StampSchema>;
export type SecondsOffset = number;
export type ClockSource = 'harness' | 'reporter' | 'gpu';
export const GpuStampSchema = object({ clock: Type.Literal('gpu'), ns });
export type GpuStamp = Static<typeof GpuStampSchema>;
export const PhaseMarkSchema = object({
  id: Type.Integer({ minimum: 0 }),
  phase: Type.String({ minLength: 1 }),
  start: object({ clock: Type.Literal('reporter'), t: time }),
  end: Type.Optional(object({ clock: Type.Literal('reporter'), t: time })),
});
export type PhaseMark = Static<typeof PhaseMarkSchema>;
export type PhaseName = PhaseMark['phase'];
export const FrameRecordSchema = object({
  cpuStart: time,
  cpuEnd: time,
  presented: Type.Optional(time),
  gpuStart: Type.Optional(ns),
  gpuEnd: Type.Optional(ns),
  animationTime: Type.Optional(Type.Number()),
});
export type FrameRecord = Static<typeof FrameRecordSchema>;
export const BlockRecordSchema = object({
  start: time,
  end: time,
  scripts: Type.Optional(
    Type.Array(
      object({
        start: time,
        end: time,
        sourceURL: Type.Optional(Type.String()),
        invoker: Type.Optional(Type.String()),
        invokerType: Type.Optional(Type.String()),
        sourceFunctionName: Type.Optional(Type.String()),
        sourceCharPosition: Type.Optional(Type.Number()),
      }),
    ),
  ),
  source: Type.Union((['longtask', 'loaf', 'watchdog'] as const).map((v) => Type.Literal(v))),
});
export type BlockRecord = Static<typeof BlockRecordSchema>;
export const MessageLogItemSchema = object({
  type: Type.String(),
  direction: Type.Union([Type.Literal('toReporter'), Type.Literal('toHarness')]),
  sentAt: StampSchema,
  receivedAt: StampSchema,
});
export type MessageLogItem = Static<typeof MessageLogItemSchema>;
export const resourceCategories = ['script', 'wasm', 'model', 'texture', 'document', 'other'] as const;
export const ResourceRecordSchema = object({
  url: Type.String(),
  category: Type.Union(resourceCategories.map((v) => Type.Literal(v))),
  initiatorType: Type.String(),
  startTime: time,
  responseStart: time,
  responseEnd: time,
  transferSize: time,
  encodedBodySize: time,
  decodedBodySize: time,
  sizeKnown: Type.Boolean(),
});
export type ResourceRecord = Static<typeof ResourceRecordSchema>;
export type ResourceCategory = ResourceRecord['category'];
export const DownloadReportSchema = object({
  phase: Type.Union([Type.Literal('load'), Type.Literal('post-load')]),
  totalTransferBytes: time,
  totalDecodedBytes: time,
  byCategory: object(
    Object.fromEntries(resourceCategories.map((v) => [v, time])) as Record<ResourceCategory, typeof time>,
  ),
  unknownSizeCount: Type.Integer({ minimum: 0 }),
  resources: Type.Array(ResourceRecordSchema),
});
export type DownloadReport = Static<typeof DownloadReportSchema>;
export const NetworkProfileSchema = object({
  name: Type.String({ minLength: 1 }),
  latencyMs: time,
  downloadBytesPerSec: Type.Union([Type.Literal(-1), positive]),
  uploadBytesPerSec: Type.Union([Type.Literal(-1), positive]),
});
export type NetworkProfile = Static<typeof NetworkProfileSchema>;
const vsync = Type.Union([Type.Literal('on'), Type.Literal('off')]);
/** PSNR compares matching encoded RGB8 pixels; null PSNR means an exact match (infinity). */
export const ReferenceSchema = object({
  image: Type.String({ minLength: 1 }),
  intervalMs: Type.Optional(Type.Number({ minimum: 16 })),
  targetPsnr: Type.Optional(time),
});
export type ReferenceConfig = Static<typeof ReferenceSchema>;
export const ConvergenceSampleSchema = object({
  at: time,
  frame: Type.Integer({ minimum: 0 }),
  mse: time,
  psnr: Type.Union([time, Type.Null()]),
});
export type ConvergenceSample = Static<typeof ConvergenceSampleSchema>;
export const ConvergenceSchema = object({
  width: Type.Integer({ minimum: 1 }),
  height: Type.Integer({ minimum: 1 }),
  interval: positive,
  targetPsnr: time,
  samples: Type.Array(ConvergenceSampleSchema),
  reference: Type.Optional(Type.String({ minLength: 1 })),
  diff: Type.Optional(Type.String({ minLength: 1 })),
  timeToTarget: Type.Optional(time),
  framesToTarget: Type.Optional(Type.Integer({ minimum: 0 })),
});
export type Convergence = Static<typeof ConvergenceSchema>;
export const EntrySchema = object({
  id: pathSafeId,
  name: Type.String(),
  renderer: NamedEntitySchema,
  scene: NamedEntitySchema,
  url: Type.String({ minLength: 1 }),
  durationMs: positive,
  params: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  reference: Type.Optional(ReferenceSchema),
});
export type Entry = Static<typeof EntrySchema>;
export type SuiteEntry = Entry;
export const PhaseColorsSchema = Type.Record(Type.String(), Type.String({ minLength: 1 }));
export type PhaseColorConfig = Static<typeof PhaseColorsSchema>;
export const SuiteSchema = Type.Object(
  {
    $schema: Type.Optional(Type.String()),
    schemaVersion: Type.Literal(1),
    name: Type.String(),
    phaseColors: Type.Optional(PhaseColorsSchema),
    defaults: Type.Optional(
      object({
        order: Type.Optional(Type.Union([Type.Literal('interleaved'), Type.Literal('sequential')])),
        initTimeoutMs: Type.Optional(positive),
        capture: Type.Optional(Type.Boolean()),
        vsync: Type.Optional(vsync),
        networkProfile: Type.Optional(Type.String({ minLength: 1 })),
      }),
    ),
    networkProfiles: Type.Optional(Type.Array(NetworkProfileSchema, { minItems: 1 })),
    entries: Type.Array(EntrySchema, { minItems: 1 }),
  },
  {
    additionalProperties: false,
    $id: 'https://unpkg.com/fidelity-kit/schemas/performance/suite.schema.json',
  },
);
export type Suite = Static<typeof SuiteSchema>;
export const EnvironmentSchema = object({
  userAgent: Type.String(),
  gpuAdapter: Type.Optional(
    object({
      vendor: Type.Optional(Type.String()),
      architecture: Type.Optional(Type.String()),
      description: Type.Optional(Type.String()),
    }),
  ),
  api: Type.Optional(Type.Union((['webgpu', 'webgl2', 'other'] as const).map((v) => Type.Literal(v)))),
  gpuTimestampsAvailable: Type.Boolean(),
  crossOriginIsolated: Type.Boolean(),
  devicePixelRatio: positive,
  canvasSize: Type.Optional(object({ width: positive, height: positive })),
  chromeFlags: Type.Array(Type.String()),
  host: object({ os: Type.String(), cpu: Type.String(), machineId: Type.Optional(Type.String()) }),
  gitCommit: Type.Optional(Type.String()),
});
export type Environment = Static<typeof EnvironmentSchema>;
export const RunResultSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    runId: Type.String({ minLength: 1 }),
    suiteName: Type.Optional(Type.String()),
    entry: object({
      id: Type.String(),
      name: Type.String(),
      renderer: NamedEntitySchema,
      scene: NamedEntitySchema,
      url: Type.String(),
    }),
    networkProfile: NetworkProfileSchema,
    config: object({
      durationMs: positive,
      vsync,
      phaseColors: Type.Optional(PhaseColorsSchema),
    }),
    environment: Type.Optional(EnvironmentSchema),
    harness: object({
      iframeCreated: Type.Optional(time),
      runEndObserved: Type.Optional(time),
      captureSent: Type.Optional(time),
      teardown: time,
    }),
    messages: Type.Optional(Type.Array(MessageLogItemSchema)),
    reporter: object({
      downloads: Type.Optional(Type.Array(DownloadReportSchema)),
      navigationStart: Type.Optional(time),
      phases: Type.Optional(Type.Array(PhaseMarkSchema)),
      ready: Type.Optional(time),
      renderStart: Type.Optional(time),
      runStart: Type.Optional(time),
      runEnd: Type.Optional(time),
      throughput: Type.Optional(object({ completedFrames: Type.Integer({ minimum: 0 }), elapsed: positive })),
      frames: Type.Array(FrameRecordSchema),
      blocks: Type.Optional(Type.Array(BlockRecordSchema)),
      watchdogTicks: Type.Optional(Type.Array(time)),
      convergence: Type.Optional(ConvergenceSchema),
    }),
    capture: Type.Optional(object({ file: Type.String(), at: time })),
    status: Type.Union((['ok', 'timeout', 'error'] as const).map((v) => Type.Literal(v))),
    error: Type.Optional(object({ message: Type.String(), phase: Type.Optional(Type.String()) })),
  },
  {
    additionalProperties: false,
    $id: 'https://unpkg.com/fidelity-kit/schemas/performance/run-result.schema.json',
  },
);
export type RunResult = Static<typeof RunResultSchema>;
const displayNumber = Type.Number();
const optionalNumber = Type.Optional(displayNumber);
/** Persisted metrics: seconds for all times, bytes for sizes, and bytes/second for network rates.
 * Reporter times are seconds from reporter creation; harness times use its own local origin.
 * GPU hardware timestamps remain nanoseconds and are never clock synchronized.
 */
export const ProcessedResultSchema = Type.Object(
  {
    schemaVersion: Type.Literal(3),
    runId: Type.String({ minLength: 1 }),
    suiteName: Type.Optional(Type.String()),
    screenshot: Type.Boolean(),
    throughput: Type.Optional(object({ completedFrames: Type.Integer({ minimum: 0 }), elapsed: positive })),
    convergence: Type.Optional(ConvergenceSchema),
    networkProfile: object({
      name: NetworkProfileSchema.properties.name,
      latency: time,
      downloadBytesPerSec: NetworkProfileSchema.properties.downloadBytesPerSec,
      uploadBytesPerSec: NetworkProfileSchema.properties.uploadBytesPerSec,
    }),
    downloads: Type.Optional(Type.Array(DownloadReportSchema)),
    entry: RunResultSchema.properties.entry,
    config: object({ duration: positive, vsync, phaseColors: Type.Optional(PhaseColorsSchema) }),
    environment: Type.Optional(EnvironmentSchema),
    status: RunResultSchema.properties.status,
    error: RunResultSchema.properties.error,
    statistics: object({
      frameCount: Type.Integer({ minimum: 0 }),
      intervalCount: Type.Integer({ minimum: 0 }),
      cpuSampleCount: Type.Integer({ minimum: 0 }),
      gpuSampleCount: Type.Integer({ minimum: 0 }),
      median: optionalNumber,
      p95: optionalNumber,
      p99: optionalNumber,
      iqr: optionalNumber,
      mad: optionalNumber,
      typicalFps: optionalNumber,
      tailFps: optionalNumber,
      initDuration: optionalNumber,
      unaccountedDuration: optionalNumber,
      initMaxBlockDuration: displayNumber,
      initBlockedDuration: displayNumber,
      cpuMedian: optionalNumber,
      cpuP95: optionalNumber,
      gpuMedian: optionalNumber,
      gpuP95: optionalNumber,
      averageFrameDuration: optionalNumber,
      averageFps: optionalNumber,
      maxJitter: optionalNumber,
      worstResponsiveness: optionalNumber,
      phaseDurations: Type.Record(Type.String(), displayNumber),
    }),
    timeline: object({
      maxTime: Type.Number({ minimum: 0 }),
      ready: optionalNumber,
      renderStart: optionalNumber,
      runStart: optionalNumber,
      runEnd: optionalNumber,
      frameTimes: Type.Array(displayNumber),
      cpuDurations: Type.Array(Type.Union([displayNumber, Type.Null()])),
      gpuDurations: Type.Array(Type.Union([displayNumber, Type.Null()])),
      frameIndices: Type.Array(Type.Integer({ minimum: 0 }), { maxItems: 1536, uniqueItems: true }),
      watchdogTimes: Type.Array(displayNumber),
      watchdogIndices: Type.Array(Type.Integer({ minimum: 1 }), { maxItems: 512, uniqueItems: true }),
      watchdogPeriod: Type.Literal(0.016),
      phases: Type.Array(
        object({
          phase: PhaseMarkSchema.properties.phase,
          start: displayNumber,
          duration: optionalNumber,
        }),
      ),
      blocks: Type.Array(
        object({
          start: displayNumber,
          duration: displayNumber,
          sources: Type.Array(Type.String(), { maxItems: 3 }),
        }),
        { maxItems: 256 },
      ),
    }),
    // Exact measured observations support comparison and client-side histograms.
    measuredIntervals: Type.Array(positive),
    timing: object({
      harness: object({
        iframeCreated: optionalNumber,
        runEndObserved: optionalNumber,
        captureSent: optionalNumber,
        teardown: displayNumber,
      }),
      reporter: object({
        navigationStart: optionalNumber,
        ready: optionalNumber,
        renderStart: optionalNumber,
        runStart: optionalNumber,
        runEnd: optionalNumber,
      }),
    }),
  },
  {
    additionalProperties: false,
    $id: 'https://unpkg.com/fidelity-kit/schemas/performance/processed-result.schema.json',
  },
);
export type ProcessedResult = Static<typeof ProcessedResultSchema>;
export type Envelope<TType extends string, TPayload> = {
  protocol: 'performance-kit';
  protocolVersion: 1;
  runId: string;
  seq: number;
  type: TType;
  sentAt: number;
  payload: TPayload;
};
const envelope = <T extends string, P extends TSchema>(type: T, payload: P) =>
  object({
    protocol: Type.Literal('performance-kit'),
    protocolVersion: Type.Literal(1),
    runId: Type.String({ minLength: 1 }),
    seq: Type.Integer({ minimum: 0 }),
    type: Type.Literal(type),
    sentAt: time,
    payload,
  });
export const protocolSchemas = {
  captureRequest: envelope('capture', object({ mimeType: Type.Literal('image/png') })),
  abort: envelope('abort', object({ reason: Type.String() })),
  failure: envelope('error', object({ message: Type.String() })),
  captureResponse: envelope('capture', object({ at: time, bytes: Type.Unsafe<ArrayBuffer>({}) })),
  runEnd: envelope(
    'runEnd',
    object({
      navigationStart: Type.Optional(time),
      runStart: Type.Optional(time),
      renderStart: Type.Optional(time),
      runEnd: time,
      throughput: Type.Optional(object({ completedFrames: Type.Integer({ minimum: 0 }), elapsed: positive })),
      frames: Type.Array(FrameRecordSchema),
      blocks: Type.Array(BlockRecordSchema),
      watchdogTicks: Type.Array(time),
      phases: Type.Array(PhaseMarkSchema),
      ready: time,
      downloads: Type.Array(DownloadReportSchema),
      environment: Type.Partial(EnvironmentSchema),
      convergence: Type.Optional(ConvergenceSchema),
    }),
  ),
};
export const MessageToReporterSchema = Type.Union([protocolSchemas.captureRequest, protocolSchemas.abort]);
export const MessageToHarnessSchema = Type.Union([
  protocolSchemas.captureResponse,
  protocolSchemas.runEnd,
  protocolSchemas.failure,
]);
export type MessageToReporter = Static<typeof MessageToReporterSchema>;
export type MessageToHarness = Static<typeof MessageToHarnessSchema>;
const ajv = new Ajv({ allErrors: true, strict: false });
export const validateNamedEntity = ajv.compile<NamedEntity>(NamedEntitySchema);
export const validateSuite = ajv.compile<Suite>(SuiteSchema);
export const validateRunResult = ajv.compile<RunResult>(RunResultSchema);
const validateProcessedSchema = ajv.compile<ProcessedResult>(ProcessedResultSchema);
export const validateProcessedResult: ValidateFunction<ProcessedResult> = Object.assign(
  (value: unknown) => {
    const valid = validateProcessedSchema(value);
    validateProcessedResult.errors = validateProcessedSchema.errors;
    if (!valid) return false;
    const metrics = value as ProcessedResult;
    const timeline = metrics.timeline;
    if (metrics.measuredIntervals.length !== metrics.statistics.intervalCount) {
      validateProcessedResult.errors = [
        {
          keyword: 'alignment',
          instancePath: '/measuredIntervals',
          schemaPath: '',
          params: {},
          message: 'must match intervalCount',
        },
      ];
      return false;
    }
    const error = (instancePath: string, message: string) => {
      validateProcessedResult.errors = [{ keyword: 'alignment', instancePath, schemaPath: '', params: {}, message }];
      return false;
    };
    if (
      timeline.cpuDurations.length !== timeline.frameTimes.length ||
      timeline.gpuDurations.length !== timeline.frameTimes.length
    )
      return error('/timeline', 'CPU and GPU arrays must align with frameTimes');
    for (const [name, indices, length] of [
      ['frameIndices', timeline.frameIndices, timeline.frameTimes.length],
      ['watchdogIndices', timeline.watchdogIndices, timeline.watchdogTimes.length],
    ] as const) {
      if (indices.some((index, position) => index >= length || (position > 0 && index <= indices[position - 1]!)))
        return error(`/timeline/${name}`, 'indices must be ordered and refer to existing samples');
    }
    return true;
  },
  { errors: null },
) as ValidateFunction<ProcessedResult>;
export const validateMessageToReporter = ajv.compile<MessageToReporter>(MessageToReporterSchema);
const validateHarnessSchema = ajv.compile<MessageToHarness>(MessageToHarnessSchema);
export const validateMessageToHarness: ValidateFunction<MessageToHarness> = Object.assign(
  (value: unknown) => {
    const valid = validateHarnessSchema(value);
    validateMessageToHarness.errors = validateHarnessSchema.errors;
    if (
      valid &&
      (value as MessageToHarness).type === 'capture' &&
      !((value as Extract<MessageToHarness, { type: 'capture' }>).payload.bytes instanceof ArrayBuffer)
    ) {
      validateMessageToHarness.errors = [
        {
          keyword: 'instanceof',
          instancePath: '/payload/bytes',
          schemaPath: '',
          params: {},
          message: 'must be an ArrayBuffer',
        },
      ];
      return false;
    }
    return valid;
  },
  { errors: null },
) as ValidateFunction<MessageToHarness>;
function assert<T>(validator: ValidateFunction<T>, value: unknown, label: string): asserts value is T {
  if (!validator(value)) throw new Error(`${label}: ${ajv.errorsText(validator.errors, { separator: '; ' })}`);
}
export function assertNamedEntity(value: unknown): asserts value is NamedEntity {
  assert(validateNamedEntity, value, 'Invalid named entity');
}
export function assertSuite(value: unknown): asserts value is Suite {
  assert(validateSuite, value, 'Invalid suite');
  const ids = new Set<string>();
  for (const entry of value.entries) {
    if (ids.has(entry.id)) throw new Error(`Invalid suite: duplicate entry id ${entry.id}`);
    ids.add(entry.id);
  }
}
export function assertRunResult(value: unknown): asserts value is RunResult {
  assert(validateRunResult, value, 'Invalid result');
}
export function assertProcessedResult(value: unknown): asserts value is ProcessedResult {
  assert(validateProcessedResult, value, 'Invalid processed result');
}
export function assertMessageToReporter(value: unknown): asserts value is MessageToReporter {
  assert(validateMessageToReporter, value, 'Invalid protocol message');
}
export function assertMessageToHarness(value: unknown): asserts value is MessageToHarness {
  assert(validateMessageToHarness, value, 'Invalid protocol message');
}
export const schemas = {
  'named-entity': NamedEntitySchema,
  suite: SuiteSchema,
  'run-result': RunResultSchema,
  'processed-result': ProcessedResultSchema,
  'message-to-reporter': MessageToReporterSchema,
  'message-to-harness': MessageToHarnessSchema,
  ...protocolSchemas,
};

export * from './derive.js';
export * from './colorScales.js';

export * from './process.js';

export * from './bandwidth.js';

export { uncoveredInitialization } from './initialization.js';
