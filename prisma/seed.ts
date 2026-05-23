import { PrismaClient, EventStatus, VendorType, VendorStatus } from '@prisma/client'

// CLI scripts use DIRECT_URL (session pooler / port 5432).
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
})

// ─── Helper: upsert vendor + menu items ──────────────────────────────────────

async function upsertVendor(
  eventId: string,
  vendor: {
    name: string
    description: string
    cuisineType: string
    boothNumber?: string
  },
  items: {
    name: string
    description: string
    price: number
    category: string
    imageUrl?: string
    prepTime?: number
  }[]
) {
  // findFirst + create pattern (no unique name constraint in schema)
  let v = await prisma.vendor.findFirst({ where: { eventId, name: vendor.name } })
  if (!v) {
    v = await prisma.vendor.create({
      data: {
        eventId,
        name: vendor.name,
        slug: vendor.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '-' + Date.now(),
        description: vendor.description,
        cuisineType: vendor.cuisineType,
        boothNumber: vendor.boothNumber ?? null,
        vendorType: VendorType.OPTION_A,
        status: VendorStatus.ACTIVE,
        commissionRate: 0.07,
      },
    })
  }

  for (const item of items) {
    const exists = await prisma.menuItem.findFirst({ where: { vendorId: v.id, name: item.name } })
    if (!exists) {
      await prisma.menuItem.create({
        data: {
          vendorId: v.id,
          name: item.name,
          description: item.description,
          price: item.price,
          category: item.category,
          imageUrl: item.imageUrl ?? null,
          prepTime: item.prepTime ?? 10,
          isAvailable: true,
        },
      })
    }
  }

  console.log(`  ✅ ${vendor.name}  (${items.length} items)`)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🌱 Seeding database...\n')

  // ── Event ──────────────────────────────────────────────────────────────────
  const event = await prisma.event.upsert({
    where: { urlSlug: 'springfield-fair-2026' },
    update: { status: EventStatus.ACTIVE },
    create: {
      name: 'Italian Fest 2026',
      urlSlug: 'springfield-fair-2026',
      status: EventStatus.ACTIVE,
      startDate: new Date('2026-06-01T10:00:00Z'),
      endDate: new Date('2026-06-07T22:00:00Z'),
      primaryColor: '#FF0077',
      eventLat: 38.6702,
      eventLng: -89.9847,
      stagingZoneLat: 38.6702,
      stagingZoneLng: -89.9847,
    },
  })
  console.log(`✅ Event: ${event.name}  (${event.urlSlug})\n`)

  // ── Vendors + Menu Items ────────────────────────────────────────────────────

  await upsertVendor(event.id,
    { name: 'ALL PRO TEES', description: 'Official Italian Fest merchandise and custom apparel.', cuisineType: 'Merchandise' },
    [
      { name: 'T-Shirts', description: 'Price is per shirt. Multiple designs available.', price: 20.00, category: 'Apparel', prepTime: 3 },
    ]
  )

  await upsertVendor(event.id,
    { name: "RANDY'S HOUSE OF BBQ", description: 'Authentic smoked BBQ and bold flavors from the pit.', cuisineType: 'BBQ & Grilled' },
    [
      { name: 'Nachos', description: 'Loaded BBQ nachos piled high.', price: 14.00, category: 'BBQ', prepTime: 10 },
      { name: 'Jerk Chicken Tacos', description: 'Tacos with bold jerk-seasoned chicken.', price: 15.00, category: 'BBQ', imageUrl: '/images/Jerk-Chicken-Tacos.jpg', prepTime: 12 },
      { name: 'Fries', description: 'Classic golden fries.', price: 8.00, category: 'Sides', imageUrl: '/images/French fries.jpg', prepTime: 7 },
      { name: 'Bloomin Onions', description: 'Served with dip.', price: 12.00, category: 'BBQ', imageUrl: '/images/fried-blooming-onion.webp', prepTime: 10 },
    ]
  )

  await upsertVendor(event.id,
    { name: 'SS. PETER & PAUL', description: 'Traditional Italian recipes from the Hill. Bagna Cauda, sausage, spiedini, and more.', cuisineType: 'Italian' },
    [
      { name: 'Bagna Cauda (Small)', description: 'Served with Cabbage and Fresh Bread from the Hill.', price: 10.00, category: 'Italian', imageUrl: '/images/bagna-cauda.jpeg', prepTime: 8 },
      { name: 'Bagna Cauda (Medium)', description: 'Served with Cabbage and Fresh Bread from the Hill.', price: 25.00, category: 'Italian', imageUrl: '/images/bagna-cauda.jpeg', prepTime: 8 },
      { name: 'Bagna Cauda (Large)', description: 'Served with Cabbage and Fresh Bread from the Hill.', price: 50.00, category: 'Italian', imageUrl: '/images/bagna-cauda.jpeg', prepTime: 8 },
      { name: 'Original Recipe Bagna Cauda', description: 'The original family recipe.', price: 6.00, category: 'Italian', prepTime: 8 },
      { name: 'Spaghetti', description: 'Classic Italian spaghetti with red sauce.', price: 10.00, category: 'Italian', imageUrl: '/images/Spaghetti-And-Meatballs.jpg', prepTime: 12 },
      { name: 'Italian Beef Sandwich', description: 'Slow-roasted Italian beef on a fresh roll.', price: 10.00, category: 'Italian', imageUrl: '/images/beef.jpeg', prepTime: 10 },
      { name: 'Mini Meatball Sub', description: 'Mini sub loaded with meatballs and sauce.', price: 8.00, category: 'Italian', imageUrl: '/images/italian-sausage-meatball-subs.jpg', prepTime: 10 },
      { name: 'Authentic Italian Sausage', description: 'Sausage on an Italian roll with peppers, onions and house made giardiniera (fully optional).', price: 8.00, category: 'Italian', imageUrl: '/images/authentic-italian-sausage.jpeg', prepTime: 8 },
      { name: 'Chicken Spiedini', description: 'Served with an Italian crested white bread. Bread comes from the bakeries on the Hill.', price: 10.00, category: 'Italian', imageUrl: '/images/Chicken-Spiedini-.jpg', prepTime: 12 },
      { name: 'Italian Beef Sub', description: 'Hearty Italian beef sub on fresh bread.', price: 10.00, category: 'Italian', imageUrl: '/images/l-intro-1611429687.jpg', prepTime: 10 },
      { name: 'Garlic Bread', description: 'Buttery garlic bread, toasted to perfection.', price: 2.00, category: 'Sides', imageUrl: '/images/IMG_9409.jpg', prepTime: 5 },
    ]
  )

  await upsertVendor(event.id,
    { name: 'GELU', description: 'Refreshing Italian ice in a rainbow of flavors.', cuisineType: 'Drinks & Ice' },
    [
      { name: 'Italian Ice (Small)', description: 'Refreshing Italian ice in assorted flavors.', price: 4.00, category: 'Italian Ice', prepTime: 3 },
      { name: 'Italian Ice (Large)', description: 'Refreshing Italian ice in assorted flavors.', price: 8.00, category: 'Italian Ice', prepTime: 3 },
    ]
  )

  await upsertVendor(event.id,
    { name: "MOMMA'S HOUSE", description: "Home-style Italian cooking — sandwiches, pasta, and Momma's specials.", cuisineType: 'Italian' },
    [
      { name: 'Caprese Chicken Sandwich (Regular)', description: 'Marinated Grilled Chicken breast on Ciabatta Roll, Fresh Mozzarella, Tomato, and more.', price: 9.00, category: 'Sandwiches', prepTime: 12 },
      { name: 'Caprese Chicken Sandwich (Large)', description: 'Marinated Grilled Chicken breast on Ciabatta Roll, Fresh Mozzarella, Tomato, and more.', price: 13.00, category: 'Sandwiches', prepTime: 12 },
      { name: 'Bowl Of Pesto Pasta Salad', description: 'Rotini pasta tossed in basil pesto with cherry tomatoes and fresh Mozzarella.', price: 5.00, category: 'Pasta', prepTime: 5 },
      { name: 'Vegan Spaghetti', description: 'Plant-based spaghetti with marinara sauce.', price: 10.00, category: 'Pasta', prepTime: 10 },
    ]
  )

  await upsertVendor(event.id,
    { name: 'HERITAGE SPORTS BAR & GRILL', description: 'Loaded quesadillas, lobster mac, and grill favorites.', cuisineType: 'BBQ & Grilled' },
    [
      { name: 'Lobster Mac & Cheese', description: 'Creamy mac and cheese loaded with lobster.', price: 12.00, category: 'Mains', imageUrl: '/images/504938790_1142349184601081_8111003270971009958_n.jpg', prepTime: 10 },
      { name: 'Italian Sausage Quesadilla', description: 'Crispy quesadilla stuffed with Italian sausage and cheese.', price: 16.00, category: 'Quesadillas', prepTime: 10 },
      { name: 'Grilled Eggplant Quesadilla', description: 'Grilled eggplant and melted cheese in a crispy tortilla.', price: 16.00, category: 'Quesadillas', prepTime: 10 },
      { name: 'BBQ Chicken Quesadilla', description: 'BBQ chicken with cheese in a grilled tortilla.', price: 16.00, category: 'Quesadillas', prepTime: 10 },
      { name: 'Cheeseburger Quesadilla', description: 'All the flavors of a cheeseburger in a crispy quesadilla.', price: 16.00, category: 'Quesadillas', prepTime: 10 },
    ]
  )

  await upsertVendor(event.id,
    { name: 'COLLINSVILLE WRESTLING CLUB', description: 'Deep-fried fair food classics — funnel cakes, fried pickles, and more.', cuisineType: 'Fair Food' },
    [
      { name: 'Funnel Cake', description: 'With Powdered Sugar.', price: 6.00, category: 'Fair Food', imageUrl: '/images/IMG_3271.jpg', prepTime: 8 },
      { name: 'Fried Pickles', description: 'Served with a cup of Ranch.', price: 6.00, category: 'Fair Food', prepTime: 7 },
      { name: 'Fried Jalapeño Slices', description: 'Served with a Cup of Ranch.', price: 6.00, category: 'Fair Food', prepTime: 7 },
      { name: 'Deep Fried PB&J', description: 'The classic sandwich, battered and deep fried.', price: 6.00, category: 'Fair Food', prepTime: 8 },
    ]
  )

  await upsertVendor(event.id,
    { name: 'CMC ROTARY', description: 'Community booth supporting local Rotary initiatives.', cuisineType: 'Community' },
    [
      { name: 'Bottled Water', description: 'Ice cold bottled water.', price: 2.00, category: 'Drinks', prepTime: 1 },
    ]
  )

  await upsertVendor(event.id,
    { name: 'LOMONACO ITALIAN FOOD', description: 'Classic Italian desserts and comfort food from the Lomonaco family.', cuisineType: 'Desserts' },
    [
      { name: 'Gooey Butter Cakes', description: 'A St. Louis classic — rich, buttery, and gooey.', price: 6.00, category: 'Desserts', prepTime: 5 },
      { name: 'Cannoli', description: 'Cannoli with Mini Chocolate Chips.', price: 5.00, category: 'Desserts', prepTime: 5 },
      { name: 'Cheese Cake', description: 'Per Slice.', price: 7.00, category: 'Desserts', prepTime: 3 },
    ]
  )

  await upsertVendor(event.id,
    { name: 'COLLINSVILLE JUNIOR SERVICE CLUB', description: 'Supporting youth programs in the Collinsville community.', cuisineType: 'Community' },
    [
      { name: 'Raffle Tickets', description: 'Support the Collinsville Junior Service Club. Per ticket.', price: 2.00, category: 'Community', prepTime: 2 },
    ]
  )

  await upsertVendor(event.id,
    { name: "OLIVIA'S OLIVE OIL", description: 'Premium extra virgin olive oil — take a bottle home from the fest.', cuisineType: 'Specialty' },
    [
      { name: 'Extra Virgin Olive Oil', description: 'Sold per Bottle. Premium quality.', price: 25.00, category: 'Specialty', prepTime: 2 },
    ]
  )

  await upsertVendor(event.id,
    { name: "RENA'S DANCE UNLIMITED", description: 'Dance studio booth supporting performing arts in the community.', cuisineType: 'Community' },
    [
      { name: 'Dance Show Tickets', description: 'Support live performances at the fest.', price: 5.00, category: 'Community', prepTime: 2 },
    ]
  )

  await upsertVendor(event.id,
    { name: 'KNIGHTS OF COLUMBUS LADIES AUX', description: 'Home-baked Italian treats from the Knights of Columbus Ladies Auxiliary.', cuisineType: 'Italian' },
    [
      { name: 'Italian Baked Goods', description: 'Assorted home-baked Italian treats.', price: 4.00, category: 'Desserts', prepTime: 3 },
    ]
  )

  await upsertVendor(event.id,
    { name: 'COLLINSVILLE SHRINE CLUB', description: 'Shrine Club booth supporting charitable causes.', cuisineType: 'Community' },
    [
      { name: 'Soft Drinks', description: 'Assorted canned soft drinks, ice cold.', price: 2.00, category: 'Drinks', prepTime: 1 },
    ]
  )

  await upsertVendor(event.id,
    { name: 'COLLINSVILLE CHARITIES FOR CHILDREN', description: "Raising funds for children's programs in the Collinsville area.", cuisineType: 'Community' },
    [
      { name: 'Donation / Raffle', description: 'Support children\'s programs in the Collinsville area.', price: 5.00, category: 'Community', prepTime: 2 },
    ]
  )

  await upsertVendor(event.id,
    { name: 'NOTHING BUNDT CAKES', description: 'Individually sized Bundtlet cakes — moist, delicious, and beautifully decorated.', cuisineType: 'Desserts' },
    [
      { name: 'Bundtlet Cakes', description: 'Individual Bundtlet — moist and beautifully decorated. Assorted flavors.', price: 6.00, category: 'Desserts', prepTime: 3 },
    ]
  )

  await upsertVendor(event.id,
    { name: 'TIVANOV CATERING CO', description: 'Catered Italian dishes with a modern twist.', cuisineType: 'Italian' },
    [
      { name: 'Pasta of the Day', description: 'Chef\'s daily pasta selection with house-made sauce.', price: 12.00, category: 'Italian', prepTime: 12 },
      { name: 'Italian Antipasto', description: 'Cured meats, olives, marinated vegetables, and fresh cheese.', price: 10.00, category: 'Italian', prepTime: 5 },
    ]
  )

  console.log('\n✨ Seed complete.')
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
