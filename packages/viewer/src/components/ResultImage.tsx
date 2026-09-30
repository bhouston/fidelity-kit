export interface ImageSize {
  width: number;
  height: number;
}

/**
 * Result image with a dashed status placeholder. `size` reserves the aspect ratio before the bytes arrive: without
 * it every image is 0px tall, all count as "in the viewport", and `loading="lazy"` would fetch the whole page at once.
 */
export function ResultImage({
  src,
  alt,
  size,
  notApplicable = false,
  className = '',
}: {
  src?: string;
  alt: string;
  size?: ImageSize;
  notApplicable?: boolean;
  className?: string;
}) {
  const style = { aspectRatio: size ? `${size.width} / ${size.height}` : '1 / 1' };
  return src && !notApplicable ? (
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
      {notApplicable ? (
        <span className="text-center">
          not
          <br />
          applicable
        </span>
      ) : (
        'missing'
      )}
    </div>
  );
}
