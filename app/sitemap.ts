import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: 'https://yogolf.net/', lastModified: now, changeFrequency: 'daily', priority: 1 },
    { url: 'https://yogolf.net/about', lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: 'https://yogolf.net/privacy', lastModified: now, changeFrequency: 'yearly', priority: 0.2 },
    { url: 'https://yogolf.net/terms', lastModified: now, changeFrequency: 'yearly', priority: 0.2 },
    { url: 'https://yogolf.net/contact', lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
  ];
}
