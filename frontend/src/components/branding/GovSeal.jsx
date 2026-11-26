// frontend/src/components/branding/GovSeal.jsx
import React from "react";
import { LOGO_URL } from "@/lib/brand";

/**
 * Official KALUSAGAP logo.
 *
 * The mark is always drawn at its natural aspect ratio — never cropped,
 * stretched, or skewed. Callers control the rendered height only; the width
 * follows from the artwork.
 *
 * The artwork keeps its transparent background on both light and dark panels.
 * `onDark` remains accepted for existing callers but no longer adds a white
 * plate behind the logo.
 */

/** Intrinsic ratio of src/assets/images/logo.png (500 x 500, square). */
const LOGO_ASPECT = 500 / 500;

// Renders or manages GovSeal logic.
export default function GovSeal({
  height = 40,
  className = "",
  eager = false,
}) {
  const image = (
    <img
      src={LOGO_URL}
      alt="KALUSAGAP"
      width={Math.round(height * LOGO_ASPECT)}
      height={height}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      className={`block w-auto shrink-0 object-contain ${className}`}
      style={{ height }}
    />
  );

  return image;
}
