/** Result image with a dashed "missing" placeholder, as in material-fidelity's MaterialCell. */
export function ResultImage({ src, alt, className = '' }: { src?: string; alt: string; className?: string }) {
  return src ? (
    <img
      alt={alt}
      className={`w-full border border-border object-contain ${className}`}
      decoding="async"
      fetchPriority="low"
      loading="lazy"
      src={src}
    />
  ) : (
    <div
      className={`flex aspect-square w-full items-center justify-center border border-dashed border-border text-xs font-semibold uppercase tracking-wide text-muted-foreground ${className}`}
    >
      missing
    </div>
  );
}
