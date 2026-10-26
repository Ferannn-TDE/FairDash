import type { MetadataRoute } from 'next'
import { robotsFile } from '@/lib/seo'

// Production: everything but the portals and the API. Anywhere else (Preview, local, staging):
// Disallow everything. The rule lives in lib/seo.ts.
export default function robots(): MetadataRoute.Robots {
  return robotsFile()
}
