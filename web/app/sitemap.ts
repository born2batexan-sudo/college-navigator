import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date("2026-09-21T00:00:00.000Z");
  return [
    {
      url: "https://www.campuspassage.com/",
      lastModified,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: "https://www.campuspassage.com/request-access",
      lastModified,
      changeFrequency: "monthly",
      priority: 0.6,
    },
  ];
}
