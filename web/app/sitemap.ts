import type { MetadataRoute } from "next";

/** Only the approved public homepage is indexed; protected and preview routes stay excluded. */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: "https://www.campuspassage.com/",
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
