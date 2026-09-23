import type { MetadataRoute } from "next";

/** The shareable sandbox is intentionally excluded from search indexing. */
export default function sitemap(): MetadataRoute.Sitemap {
  return [];
}
