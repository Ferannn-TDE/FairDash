import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
}

async function main() {
  const vendors = await prisma.vendor.findMany({ select: { id: true, name: true, slug: true } })
  console.log(`Backfilling slugs for ${vendors.length} vendors…`)

  for (const vendor of vendors) {
    if (vendor.slug) {
      console.log(`  skip  ${vendor.name} (already has slug: ${vendor.slug})`)
      continue
    }

    let slug = toSlug(vendor.name)
    const conflict = await prisma.vendor.findFirst({
      where: { slug, NOT: { id: vendor.id } },
      select: { id: true },
    })
    if (conflict) slug = `${slug}-${vendor.id.slice(-4)}`

    await prisma.vendor.update({ where: { id: vendor.id }, data: { slug } })
    console.log(`  done  ${vendor.name} → ${slug}`)
  }

  console.log('Backfill complete.')
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
