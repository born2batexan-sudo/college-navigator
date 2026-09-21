import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/request-access"],
      disallow: [
        "/account",
        "/action/",
        "/admin/",
        "/api/",
        "/dashboard",
        "/demo/",
        "/login",
        "/onboarding",
        "/request",
        "/welcome",
      ],
    },
    sitemap: "https://www.campuspassage.com/sitemap.xml",
    host: "https://www.campuspassage.com",
  };
}
