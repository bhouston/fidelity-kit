import { RendererSelection } from './RendererSelection';
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
    onChange({
      renderer: undefined,
      renderers: chosen.join(',') === defaults.join(',') ? undefined : chosen.join(',') || '-',
    });
  };
  return (
    <>
      {selectable.length > 0 ? (
        <RendererSelection
          renderers={selectable}
          selected={selected}
          onChange={setRenderers}
          presets={index.config.comparisonPresets}
          onPreset={(preset) => {
            const ref = preset.ref ?? view.ref;
            const ids = index.config.renderers
              .filter((r) => r.id !== ref && preset.renderers.includes(r.id))
              .map((r) => r.id);
            onChange({ ref, renderer: undefined, renderers: ids.join(',') || '-' });
          }}
        />
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
