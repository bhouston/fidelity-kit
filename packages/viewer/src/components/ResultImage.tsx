export interface ImageSize {
  width: number;
  height: number;
}

/**
 * Result image with a dashed "missing" placeholder. `size` reserves the aspect ratio before the bytes arrive: without
 * it every image is 0px tall, all count as "in the viewport", and `loading="lazy"` would fetch the whole page at once.
 */
export function ResultImage({
  src,
  alt,
  size,
  className = '',
}: {
  src?: string;
  alt: string;
  size?: ImageSize;
  className?: string;
}) {
  const style = { aspectRatio: size ? `${size.width} / ${size.height}` : '1 / 1' };
  return src ? (
    <img
      alt={alt}
      className={`w-full border border-border object-contain ${className}`}
      decoding="async"
      fetchPriority="low"
      height={size?.height}
      loading="lazy"
      src={src}
      style={style}
      width={size?.width}
    />
  ) : (
    <div
      className={`flex w-full items-center justify-center border border-dashed border-border text-xs font-semibold uppercase tracking-wide text-muted-foreground ${className}`}
      style={style}
    >
      missing
    </div>
  );
}
