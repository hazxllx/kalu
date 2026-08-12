import React from "react";
import { LOGO_URL } from "@/lib/brand";

/**
 * Official KALUSAGAP logo.
 *
 * The supplied artwork is a horizontal, rectangular logo, so it is always drawn
 * at its natural aspect ratio — never inside a circle, ring, medallion, or any
 * other round badge. Callers control the rendered height only; the width is
 * derived from the artwork so the mark is never cropped, stretched, or skewed.
 *
 * On navy panels, `onDark` sets the mark on a plain rectangular white plate so
 * the navy lettering stays legible. The plate is rectangular at every size.
 */

/** Intrinsic ratio of src/public/logo.png (1098 x 492). */
const LOGO_ASPECT = 1098 / 492;

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
