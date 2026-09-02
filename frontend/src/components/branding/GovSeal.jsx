import React from "react";
import { LOGO_URL } from "@/lib/brand";

/**
 * Official KALUSAGAP logo.
 *
 * The mark is always drawn at its natural aspect ratio — never cropped,
 * stretched, or skewed. Callers control the rendered height only; the width
 * follows from the artwork.
 *
 * On navy panels, `onDark` sets the mark on a plain white plate so the navy
 * lettering stays legible. The plate is rectangular at every size.
 */

/** Intrinsic ratio of src/assets/images/logo.png (500 x 500, square). */
const LOGO_ASPECT = 500 / 500;

export default function GovSeal({
  height = 40,
  className = "",
  eager = false,
  onDark = false,
}) {
  const image = (
    <img
      src={LOGO_URL}
      alt="KALUSAGAP"
      width={Math.round(height * LOGO_ASPECT)}
      height={height}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      className={`block w-auto object-contain ${onDark ? "" : `shrink-0 ${className}`}`}
      style={{ height }}
    />
  );

  if (!onDark) return image;

  return (
    <span className={`inline-flex shrink-0 items-center bg-white px-2.5 py-1.5 ${className}`}>
      {image}
    </span>
  );
}
