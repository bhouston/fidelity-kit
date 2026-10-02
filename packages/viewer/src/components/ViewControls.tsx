import { ArrowUpDown } from 'lucide-react';
import type { SuiteIndex } from 'fidelity-kit';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#/components/ui/select';
import { Switch } from '#/components/ui/switch';
import { SORT_OPTIONS, validateViewSearch, type Sort, type View, type ViewSearch } from '#/lib/view';

/** Output / reference / deltas (and optionally sort) controls; each change is a partial search update. */
export function ViewControls({
  index,
  view,
  onChange,
}: {
  index: SuiteIndex;
  view: View;
  onChange: (patch: Partial<ViewSearch>) => void;
}) {
  const { outputs } = index.config;
  const selectable = index.config.renderers.filter((r) => r.id !== view.ref);
  const selected = new Set(view.compared);
  const defaults = selectable.filter((r) => r.enabled !== false).map((r) => r.id);
  // the config's `enabled` flags are the default selection, so only a differing choice goes in the URL
  const setRenderers = (ids: Set<string>) => {
    const chosen = selectable.filter((r) => ids.has(r.id)).map((r) => r.id);
    onChange({ renderers: chosen.join(',') === defaults.join(',') ? undefined : chosen.join(',') || '-' });
  };
  const toggleRenderer = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setRenderers(next);
  };
  return (
    <>
      {selectable.length > 0 ? (
        <details className="relative shrink-0 text-sm">
          <summary className="cursor-pointer rounded-md border border-input px-3 py-2">
            Renderers ({selected.size}/{selectable.length})
          </summary>
          <div className="absolute right-0 z-50 mt-1 min-w-48 space-y-1 rounded-md border border-border bg-card p-2 shadow-lg">
            <button
              className="block w-full px-2 py-1 text-left hover:bg-muted"
              onClick={() => setRenderers(new Set(selectable.map((r) => r.id)))}
              type="button"
            >
              All renderers
            </button>
            {selectable.map((r) => (
              <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-muted" key={r.id}>
                <input checked={selected.has(r.id)} onChange={() => toggleRenderer(r.id)} type="checkbox" />
                {r.label ?? r.id}
              </label>
            ))}
          </div>
        </details>
      ) : null}
      {outputs.length > 1 ? (
        <Pick
          label="Output"
          value={view.output}
          options={outputs.map((o) => ({ value: o.id, label: o.label ?? o.id }))}
          onChange={(output) => onChange({ output })}
        />
      ) : null}
      {view.references.length > 1 ? (
        <Pick
          label="Reference"
          value={view.ref}
          options={view.references.map((r) => ({ value: r, label: view.label(r) }))}
          onChange={(ref) => onChange({ ref })}
        />
      ) : null}
      <label htmlFor="show-deltas" className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
        <Switch
          aria-label="Show delta images"
          checked={view.showDeltas}
          onCheckedChange={(deltas) => onChange({ deltas })}
        />
        Deltas
      </label>
    </>
  );
}

export function SortSelect({ value, onChange }: { value: Sort; onChange: (sort: Sort | undefined) => void }) {
  return (
    <Select onValueChange={(v) => onChange(validateViewSearch({ sort: v }).sort)} value={value}>
      <SelectTrigger aria-label="Sort scenes" className="shrink-0" title="Sort">
        <ArrowUpDown />
        <SelectValue>{SORT_OPTIONS.find((o) => o.value === value)?.label}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {SORT_OPTIONS.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Pick({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <Select onValueChange={onChange} value={value}>
      <SelectTrigger aria-label={label} className="shrink-0" title={label}>
        <SelectValue>{options.find((o) => o.value === value)?.label}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
