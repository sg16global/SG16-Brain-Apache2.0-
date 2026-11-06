"use client";

import type { ImgHTMLAttributes } from "react";

// The home sections are server components, which cannot pass an onError
// handler to a DOM element (it fails the production build). This tiny client
// wrapper owns the handler: if the image is missing it is hidden, so the
// section's gradient fallback shows instead of a broken-image icon.
export function FallbackImg({
  onMissing = "fade",
  alt,
  ...rest
}: ImgHTMLAttributes<HTMLImageElement> & { onMissing?: "fade" | "hide"; alt: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      alt={alt}
      {...rest}
      onError={(e) => {
        const img = e.currentTarget;
        if (onMissing === "hide") img.style.display = "none";
        else img.style.opacity = "0";
      }}
    />
  );
}
