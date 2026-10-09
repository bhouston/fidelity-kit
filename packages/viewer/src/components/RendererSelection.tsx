import { useEffect, useRef, useState } from 'react';
import { categoryGroups, selectionState, toggleGroup } from '#/lib/selection';

type Renderer = { id: string; label?: string; category?: string };
type Preset = { id: string; name: string; renderers: string[]; ref?: string };
export function RendererSelection({
  renderers,
  selected,
  onChange,
  presets = [],
  onPreset,
}: {
  renderers: Renderer[];
  selected: Set<string>;
  onChange: (ids: Set<string>) => void;
  presets?: Preset[];
  onPreset?: (preset: Preset) => void;
}) {
  const [query, setQuery] = useState('');
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node) && menu.current) menu.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && menu.current?.open) {
        menu.current.open = false;
        menu.current.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('keydown', escape);
    document.addEventListener('pointerdown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', escape);
    };
  }, []);
  const match = query.trim().toLowerCase();
  const shown = renderers.filter((r) =>
    [r.id, r.label, r.category].some((value) => value?.toLowerCase().includes(match)),
  );
  return (
    <details ref={menu} className="relative shrink-0 text-sm">
      <summary className="cursor-pointer rounded-md border border-input px-3 py-2">
        Renderers ({selected.size}/{renderers.length})
      </summary>
      <div className="absolute right-0 z-50 mt-1 w-80 max-w-[calc(100vw-2rem)] max-h-[min(32rem,65dvh)] overflow-y-auto overscroll-contain rounded-md border border-border bg-card p-2 shadow-lg">
        <input
          aria-label="Search renderers"
          placeholder="Search renderers"
          className="w-full rounded border border-input px-2 py-1"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="flex gap-3 py-2">
          <button type="button" onClick={() => onChange(new Set(renderers.map((r) => r.id)))}>
            All
          </button>
          <button type="button" onClick={() => onChange(new Set())}>
            None
          </button>
        </div>
        {presets.length > 0 && (
          <div className="flex flex-wrap gap-2 border-b border-border pb-2">
            {presets.map((preset) => (
              <button
                className="rounded border border-input px-2 py-1"
                key={preset.id}
                type="button"
                onClick={() => onPreset?.(preset)}
              >
                {preset.name}
              </button>
            ))}
          </div>
        )}
        {categoryGroups(shown).map(([category, group]) => {
          // Search narrows displayed rows; category actions always operate on the entire category.
          const ids = renderers.filter((r) => (r.category ?? 'Other') === category).map((r) => r.id);
          const state = selectionState(ids, selected);
          return (
            <details key={category} open className="border-b border-border py-1">
              <summary className="cursor-pointer font-medium">
                {category} ({ids.filter((id) => selected.has(id)).length}/{ids.length})
              </summary>
              <label className="flex cursor-pointer items-center gap-2 px-2 py-1">
                <input
                  type="checkbox"
                  aria-label={`Toggle ${category}`}
                  checked={state === 'all'}
                  ref={(input) => {
                    if (input) input.indeterminate = state === 'some';
                  }}
                  onChange={() => onChange(toggleGroup(ids, selected))}
                />{' '}
                All in {category}
              </label>
              {group.map((r) => (
                <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-muted" key={r.id}>
                  <input
                    type="checkbox"
                    checked={selected.has(r.id)}
                    onChange={() => onChange(toggleGroup([r.id], selected))}
                  />
                  {r.label ?? r.id}
                </label>
              ))}
            </details>
          );
        })}
        {!shown.length && <p className="py-2">No matching renderers.</p>}
      </div>
    </details>
  );
}
