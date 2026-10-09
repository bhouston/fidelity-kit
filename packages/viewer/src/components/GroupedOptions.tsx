import { categoryGroups } from '#/lib/selection';
/** Native selects keep browser keyboard navigation and scrolling while sharing registry categories. */
export function GroupedOptions({ items }: { items: { id: string; name: string; category?: string }[] }) {
  return categoryGroups(items).map(([category, group]) => (
    <optgroup key={category} label={category}>
      {group.map((item) => (
        <option key={item.id} value={item.id}>
          {item.name}
        </option>
      ))}
    </optgroup>
  ));
}
