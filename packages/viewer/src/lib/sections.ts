import type { RenderingRegistry } from 'fidelity-kit/registry';

type SectionRegistry = Partial<Pick<RenderingRegistry, 'dynamic' | 'performance'>> & {
  staticFidelity?: boolean;
  temporalFidelity?: false | object;
};

/** Explicit section options take precedence over legacy results and configuration. */
export function resolveSections(registry: SectionRegistry | null, hasTemporal: boolean, hasPerformance = false) {
  return {
    static:
      registry?.staticFidelity !== undefined
        ? registry.staticFidelity !== false
        : registry?.temporalFidelity === undefined,
    temporal:
      registry?.temporalFidelity !== undefined
        ? registry.temporalFidelity !== false
        : Boolean(registry?.dynamic || hasTemporal),
    performance: Boolean(
      Object.values(registry?.performance ?? {}).some((collection) => collection.entries.length) || hasPerformance,
    ),
  };
}

export function resolveSectionView(view: string | undefined, sections: ReturnType<typeof resolveSections>) {
  if (view === 'dynamic') return sections.temporal ? 'temporal' : 'home';
  if (view === 'temporal') return sections.temporal ? 'temporal' : 'home';
  if (view === 'fidelity' && !sections.static) return sections.temporal ? 'temporal' : 'home';
  if (view === 'performance' && !sections.performance) return 'home';
  return view;
}
