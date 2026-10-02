import type { ReactNode } from 'react';

/** Heading with a `#` permalink (pass a router `<Link hash={id}>`) that appears on hover or focus. */
export function BookmarkHeading({
  as: Tag,
  id,
  anchor,
  className = '',
  children,
}: {
  as: 'h1' | 'h2' | 'h3';
  id: string;
  anchor: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tag className={`group flex scroll-mt-20 items-baseline gap-2 ${className}`} id={id}>
      {children}
      <span className="text-muted-foreground opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        {anchor}
      </span>
    </Tag>
  );
}
