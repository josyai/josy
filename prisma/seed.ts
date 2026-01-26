import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface RecipeSeed {
  slug: string;
  name: string;
  cookTimeMinutes: number;
  prepTimeMinutes: number;
  equipmentRequired: string[];
  servings: number;
  instructionsMd: string;
  ingredients: Array<{
    canonicalName: string;
    requiredQuantity: number;
    unit: string;
    optional: boolean;
  }>;
}

const recipes: RecipeSeed[] = [
  {
    slug: 'stir-fry-chicken-frozen-veg',
    name: 'Chicken Stir-Fry with Frozen Vegetables',
    cookTimeMinutes: 15,
    prepTimeMinutes: 10,
    equipmentRequired: ['stovetop'],
    servings: 2,
    instructionsMd: `## Chicken Stir-Fry with Frozen Vegetables

1. Cut chicken breast into bite-sized pieces
2. Heat oil in a wok or large pan over high heat
3. Cook chicken until golden, about 5-6 minutes
4. Add frozen vegetables and soy sauce
5. Stir-fry for 5-6 minutes until vegetables are tender-crisp
6. Season with salt and pepper to taste
7. Serve hot over rice (optional)`,
    ingredients: [
      { canonicalName: 'chicken breast', requiredQuantity: 300, unit: 'g', optional: false },
      { canonicalName: 'frozen mixed vegetables', requiredQuantity: 250, unit: 'g', optional: false },
      { canonicalName: 'soy sauce', requiredQuantity: 30, unit: 'ml', optional: false },
      { canonicalName: 'vegetable oil', requiredQuantity: 15, unit: 'ml', optional: false },
      { canonicalName: 'garlic', requiredQuantity: 2, unit: 'pcs', optional: true },
    ],
  },
  {
    slug: 'pasta-tuna-tomato',
    name: 'Tuna Tomato Pasta',
    cookTimeMinutes: 15,
    prepTimeMinutes: 5,
    equipmentRequired: ['stovetop'],
    servings: 2,
    instructionsMd: `## Tuna Tomato Pasta

1. Cook pasta according to package directions
2. While pasta cooks, heat olive oil in a pan
3. Add canned tomatoes and simmer for 5 minutes
4. Drain and flake the tuna, add to sauce
5. Season with salt, pepper, and dried herbs
6. Drain pasta and toss with sauce
7. Serve with a drizzle of olive oil`,
    ingredients: [
      { canonicalName: 'pasta', requiredQuantity: 200, unit: 'g', optional: false },
      { canonicalName: 'canned tuna', requiredQuantity: 150, unit: 'g', optional: false },
      { canonicalName: 'canned tomatoes', requiredQuantity: 400, unit: 'g', optional: false },
      { canonicalName: 'olive oil', requiredQuantity: 30, unit: 'ml', optional: false },
      { canonicalName: 'dried basil', requiredQuantity: 5, unit: 'g', optional: true },
    ],
  },
  {
    slug: 'egg-fried-rice',
    name: 'Egg Fried Rice',
    cookTimeMinutes: 15,
    prepTimeMinutes: 5,
    equipmentRequired: ['stovetop'],
    servings: 2,
    instructionsMd: `## Egg Fried Rice

1. Beat eggs in a bowl and set aside
2. Heat oil in a wok over high heat
3. Add cold rice and stir-fry to separate grains
4. Push rice to the side, scramble eggs
5. Mix rice and eggs together
6. Add frozen peas and soy sauce
7. Stir-fry for 2-3 minutes until heated through
8. Garnish with green onions if available`,
    ingredients: [
      { canonicalName: 'cooked rice', requiredQuantity: 400, unit: 'g', optional: false },
      { canonicalName: 'eggs', requiredQuantity: 3, unit: 'pcs', optional: false },
      { canonicalName: 'frozen peas', requiredQuantity: 100, unit: 'g', optional: false },
      { canonicalName: 'soy sauce', requiredQuantity: 30, unit: 'ml', optional: false },
      { canonicalName: 'vegetable oil', requiredQuantity: 30, unit: 'ml', optional: false },
      { canonicalName: 'green onions', requiredQuantity: 2, unit: 'pcs', optional: true },
    ],
  },
  {
    slug: 'sheet-pan-salmon-peas',
    name: 'Sheet Pan Salmon with Peas',
    cookTimeMinutes: 20,
    prepTimeMinutes: 10,
    equipmentRequired: ['oven'],
    servings: 2,
    instructionsMd: `## Sheet Pan Salmon with Peas

1. Preheat oven to 200°C (400°F)
2. Place salmon fillets on a lined baking sheet
3. Drizzle with olive oil, season with salt and pepper
4. Arrange frozen peas around the salmon
5. Bake for 15-18 minutes until salmon is cooked through
6. Squeeze lemon juice over fish before serving`,
    ingredients: [
      { canonicalName: 'salmon fillet', requiredQuantity: 2, unit: 'pcs', optional: false },
      { canonicalName: 'frozen peas', requiredQuantity: 200, unit: 'g', optional: false },
      { canonicalName: 'olive oil', requiredQuantity: 30, unit: 'ml', optional: false },
      { canonicalName: 'lemon', requiredQuantity: 1, unit: 'pcs', optional: true },
    ],
  },
  {
    slug: 'chickpea-salad-wraps',
    name: 'Chickpea Salad Wraps',
    cookTimeMinutes: 0,
    prepTimeMinutes: 15,
    equipmentRequired: [],
    servings: 2,
    instructionsMd: `## Chickpea Salad Wraps

1. Drain and rinse chickpeas
2. Mash chickpeas roughly with a fork
3. Mix with mayonnaise, lemon juice, salt, and pepper
4. Add diced cucumber and tomato if available
5. Spoon mixture onto tortilla wraps
6. Add lettuce leaves
7. Roll up and serve`,
    ingredients: [
      { canonicalName: 'canned chickpeas', requiredQuantity: 400, unit: 'g', optional: false },
      { canonicalName: 'tortilla wraps', requiredQuantity: 4, unit: 'pcs', optional: false },
      { canonicalName: 'mayonnaise', requiredQuantity: 60, unit: 'g', optional: false },
      { canonicalName: 'lettuce', requiredQuantity: 100, unit: 'g', optional: false },
      { canonicalName: 'cucumber', requiredQuantity: 1, unit: 'pcs', optional: true },
    ],
  },
  {
    slug: 'tomato-omelet-toast',
    name: 'Tomato Omelet with Toast',
    cookTimeMinutes: 10,
    prepTimeMinutes: 5,
    equipmentRequired: ['stovetop'],
    servings: 2,
    instructionsMd: `## Tomato Omelet with Toast

1. Beat eggs with salt and pepper
2. Heat butter in a non-stick pan
3. Pour in eggs and let set slightly
4. Add diced tomatoes to one half
5. Fold omelet over and cook 1-2 more minutes
6. Toast bread while omelet cooks
7. Serve omelet on toast`,
    ingredients: [
      { canonicalName: 'eggs', requiredQuantity: 4, unit: 'pcs', optional: false },
      { canonicalName: 'tomato', requiredQuantity: 2, unit: 'pcs', optional: false },
      { canonicalName: 'bread', requiredQuantity: 4, unit: 'pcs', optional: false },
      { canonicalName: 'butter', requiredQuantity: 20, unit: 'g', optional: false },
      { canonicalName: 'cheese', requiredQuantity: 50, unit: 'g', optional: true },
    ],
  },
  {
    slug: 'lentil-soup',
    name: 'Lentil Soup',
    cookTimeMinutes: 30,
    prepTimeMinutes: 5,
    equipmentRequired: ['stovetop'],
    servings: 4,
    instructionsMd: `## Lentil Soup

1. Rinse lentils and set aside
2. Dice onion and mince garlic
3. Sauté onion in olive oil until soft
4. Add garlic and cook 1 minute
5. Add lentils, canned tomatoes, and vegetable broth
6. Bring to boil, then simmer for 25-30 minutes
7. Season with cumin, salt, and pepper
8. Serve with crusty bread`,
    ingredients: [
      { canonicalName: 'red lentils', requiredQuantity: 200, unit: 'g', optional: false },
      { canonicalName: 'onion', requiredQuantity: 1, unit: 'pcs', optional: false },
      { canonicalName: 'canned tomatoes', requiredQuantity: 400, unit: 'g', optional: false },
      { canonicalName: 'vegetable broth', requiredQuantity: 750, unit: 'ml', optional: false },
      { canonicalName: 'olive oil', requiredQuantity: 30, unit: 'ml', optional: false },
      { canonicalName: 'garlic', requiredQuantity: 2, unit: 'pcs', optional: true },
    ],
  },
  {
    slug: 'quesadilla-beans-cheese',
    name: 'Bean and Cheese Quesadillas',
    cookTimeMinutes: 10,
    prepTimeMinutes: 5,
    equipmentRequired: ['stovetop'],
    servings: 2,
    instructionsMd: `## Bean and Cheese Quesadillas

1. Drain and rinse black beans
2. Mash beans slightly with a fork
3. Heat a large pan over medium heat
4. Place tortilla in pan
5. Spread beans on half, top with cheese
6. Fold tortilla and cook until golden, about 2-3 minutes
7. Flip and cook other side
8. Cut into wedges and serve with salsa`,
    ingredients: [
      { canonicalName: 'tortilla wraps', requiredQuantity: 4, unit: 'pcs', optional: false },
      { canonicalName: 'canned black beans', requiredQuantity: 200, unit: 'g', optional: false },
      { canonicalName: 'shredded cheese', requiredQuantity: 150, unit: 'g', optional: false },
      { canonicalName: 'salsa', requiredQuantity: 100, unit: 'g', optional: true },
    ],
  },
];

async function main() {
  console.log('Seeding recipes...');

  for (const recipe of recipes) {
    const existing = await prisma.recipe.findUnique({
      where: { slug: recipe.slug },
    });

    if (existing) {
      console.log(`  Skipping ${recipe.slug} (already exists)`);
      continue;
    }

    const created = await prisma.recipe.create({
      data: {
        slug: recipe.slug,
        name: recipe.name,
        cookTimeMinutes: recipe.cookTimeMinutes,
        prepTimeMinutes: recipe.prepTimeMinutes,
        equipmentRequired: recipe.equipmentRequired,
        servings: recipe.servings,
        instructionsMd: recipe.instructionsMd,
        ingredients: {
          create: recipe.ingredients.map((ing) => ({
            canonicalName: ing.canonicalName,
            requiredQuantity: ing.requiredQuantity,
            unit: ing.unit,
            optional: ing.optional,
          })),
        },
      },
    });

    console.log(`  Created ${created.slug}`);
  }

  console.log('Seeding complete!');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
