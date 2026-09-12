// Branding. The tenant's name and marks come from ezacto's GET /api/v1/brand;
// BRAND_* vars override per field for a deployment that wants something else;
// ezacto's own look is the fallback when neither says anything.

import { getBrand } from "./ezacto";
import type { ApiBrand, EzactoConfig } from "./ezacto";

export interface Palette {
  ground: string;
  surface: string;
  surface2: string;
  line: string;
  ink: string;
  muted: string;
}

export interface Theme {
  scheme: "light" | "dark";
  light: Palette;
  dark: Palette;
  // Links and the chart line; buttons use the accent.
  data: string;
  fontBody: string;
  fontMono: string;
  fontStylesheet: string | null;
  radius: number;
}

export interface Brand {
  name: string;
  logoUrl: string | null;
  logoDarkUrl: string | null;
  accent: string;
  accentDark: string;
  accentLight: string;
  theme: Theme;
}

export interface BrandEnv {
  BRAND_NAME?: string;
  BRAND_LOGO_URL?: string;
  BRAND_LOGO_DARK_URL?: string;
  BRAND_ACCENT?: string;
  BRAND_DATA?: string;
  BRAND_SCHEME?: string;
  // Override the default scheme's palette; the other scheme keeps the defaults.
  BRAND_GROUND?: string;
  BRAND_SURFACE?: string;
  BRAND_LINE?: string;
  BRAND_INK?: string;
  BRAND_MUTED?: string;
  BRAND_FONT_BODY?: string;
  // Empty string disables the default Plex stylesheet.
  BRAND_FONT_STYLESHEET?: string;
}

const DEFAULT_NAME = "ezacto";

// ezacto's default app theme, "Precision", so the portal reads as the same
// product as the instance it fronts.
const DEFAULT_ACCENT = "#16794A";
const DEFAULT_DATA = "#2F5AE0";
const PRECISION_LIGHT: Palette = {
  ground: "#FFFFFF",
  surface: "#F5F6F7",
  surface2: "#EBEDEF",
  line: "#E3E5E8",
  ink: "#14161A",
  muted: "#676C74",
};
const PRECISION_DARK: Palette = {
  ground: "#14161A",
  surface: "#1C1F24",
  surface2: "#24282E",
  line: "#2A2E35",
  ink: "#F5F6F7",
  muted: "#A0A6AF",
};
const DEFAULT_FONT_BODY = '"IBM Plex Sans", ui-sans-serif, system-ui, sans-serif';
const DEFAULT_FONT_MONO = '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
const DEFAULT_FONT_STYLESHEET =
  "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600;700&display=swap";

const HEX = /^#[0-9a-f]{6}$/i;
const hex = (value: string | undefined, fallback: string): string =>
  value && HEX.test(value) ? value : fallback;

// Shift a hex colour toward black (negative) or white (positive) by a fraction.
function shade(hex: string, amount: number): string {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const target = amount < 0 ? 0 : 255;
  const t = Math.abs(amount);
  return (
    "#" +
    channels
      .map((c) => Math.round(c + (target - c) * t).toString(16).padStart(2, "0"))
      .join("")
  );
}

function themeFromEnv(env: BrandEnv): Theme {
  const scheme = env.BRAND_SCHEME === "dark" ? "dark" : "light";
  const base = scheme === "dark" ? PRECISION_DARK : PRECISION_LIGHT;
  const surface = hex(env.BRAND_SURFACE, base.surface);
  const overridden: Palette = {
    ground: hex(env.BRAND_GROUND, base.ground),
    surface,
    surface2: env.BRAND_SURFACE ? shade(surface, scheme === "dark" ? 0.06 : -0.04) : base.surface2,
    line: hex(env.BRAND_LINE, base.line),
    ink: hex(env.BRAND_INK, base.ink),
    muted: hex(env.BRAND_MUTED, base.muted),
  };
  return {
    scheme,
    light: scheme === "light" ? overridden : PRECISION_LIGHT,
    dark: scheme === "dark" ? overridden : PRECISION_DARK,
    data: hex(env.BRAND_DATA, DEFAULT_DATA),
    fontBody: env.BRAND_FONT_BODY || DEFAULT_FONT_BODY,
    fontMono: DEFAULT_FONT_MONO,
    fontStylesheet:
      env.BRAND_FONT_STYLESHEET === undefined
        ? DEFAULT_FONT_STYLESHEET
        : env.BRAND_FONT_STYLESHEET || null,
    radius: 6,
  };
}

export function brandFromSources(env: BrandEnv, api: ApiBrand | null = null): Brand {
  const accent = hex(env.BRAND_ACCENT, DEFAULT_ACCENT);
  const mark = (slot: "wordmark_light" | "wordmark_dark") =>
    api?.assets.find((asset) => asset.slot === slot)?.url ?? null;
  const logoUrl = env.BRAND_LOGO_URL || mark("wordmark_light");
  return {
    name: env.BRAND_NAME || api?.organization_name || DEFAULT_NAME,
    logoUrl,
    logoDarkUrl: env.BRAND_LOGO_DARK_URL || mark("wordmark_dark") || logoUrl,
    accent,
    accentDark: shade(accent, -0.3),
    accentLight: shade(accent, 0.3),
    theme: themeFromEnv(env),
  };
}

// Origins the CSP must allow for the font stylesheet and the font files.
export function brandFontOrigins(brand: Brand): { style: string[]; font: string[] } {
  const sheet = brand.theme.fontStylesheet;
  if (!sheet) return { style: [], font: [] };
  const origin = new URL(sheet).origin;
  return {
    style: [origin],
    font: origin === "https://fonts.googleapis.com" ? ["https://fonts.gstatic.com"] : [origin],
  };
}

const BRAND_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; brand: ApiBrand | null }>();

// A brand lookup must never be why a page fails: a failed fetch resolves to
// the env/default brand and is retried after the TTL like a hit would be.
export async function resolveBrand(env: BrandEnv, config: EzactoConfig): Promise<Brand> {
  const key = `${config.baseUrl}|${config.token}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < BRAND_TTL_MS) return brandFromSources(env, hit.brand);
  let brand: ApiBrand | null = null;
  try {
    brand = await getBrand(config);
  } catch (err) {
    console.error("[brand] lookup failed:", err);
  }
  cache.set(key, { at: Date.now(), brand });
  return brandFromSources(env, brand);
}

export function resetBrandCache(): void {
  cache.clear();
}

// Origins the CSP must allow for the logo images. data: URIs need nothing.
export function brandImageOrigins(brand: Brand): string[] {
  const origins = new Set<string>();
  for (const url of [brand.logoUrl, brand.logoDarkUrl]) {
    if (url && /^https?:\/\//.test(url)) {
      origins.add(new URL(url).origin);
    }
  }
  return Array.from(origins);
}
