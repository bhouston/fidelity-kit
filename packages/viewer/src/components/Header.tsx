import { Link } from '@tanstack/react-router';
import { Github } from 'lucide-react';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '#/components/ui/breadcrumb';
import type { ViewSearch } from '#/lib/view';

/** Top nav: suite title › scene path, carrying the current view search; page controls go in `children`. */
export default function Header({
  title,
  scenePath,
  search,
  children,
}: {
  title: string;
  scenePath?: string;
  search?: ViewSearch;
  children?: React.ReactNode;
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-card/95 py-3 shadow-sm backdrop-blur">
      <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-2 px-4 sm:px-6 md:flex-row md:items-center">
        <Breadcrumb>
          <BreadcrumbList className="text-base sm:text-lg">
            <BreadcrumbItem>
              {scenePath ? (
                <BreadcrumbLink asChild>
                  <Link search={search} to="/">
                    {title}
                  </Link>
                </BreadcrumbLink>
              ) : (
                <BreadcrumbPage className="font-semibold">{title}</BreadcrumbPage>
              )}
            </BreadcrumbItem>
            {scenePath ? (
              <>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage>{scenePath.split('/').join(' / ')}</BreadcrumbPage>
                </BreadcrumbItem>
              </>
            ) : null}
          </BreadcrumbList>
        </Breadcrumb>
        <div className="flex flex-wrap items-center gap-2 md:ml-auto">
          {children}
          <a
            aria-label="fidelity-kit repository"
            className="ml-1 inline-flex items-center text-muted-foreground transition-colors hover:text-foreground"
            href="https://github.com/bhouston/fidelity-kit"
            rel="noopener noreferrer"
            target="_blank"
          >
            <Github className="size-4" />
          </a>
        </div>
      </div>
    </header>
  );
}
