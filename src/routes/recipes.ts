import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../models/prisma';

const router = Router();

// GET /v1/recipes - List all recipes with ingredients
router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const recipes = await prisma.recipe.findMany({
      include: {
        ingredients: true,
      },
      orderBy: { name: 'asc' },
    });

    res.json({
      recipes: recipes.map((recipe) => ({
        id: recipe.id,
        slug: recipe.slug,
        name: recipe.name,
        cook_time_minutes: recipe.cookTimeMinutes,
        prep_time_minutes: recipe.prepTimeMinutes,
        total_time_minutes: recipe.cookTimeMinutes + recipe.prepTimeMinutes,
        equipment_required: recipe.equipmentRequired,
        servings: recipe.servings,
        instructions_md: recipe.instructionsMd,
        ingredients: recipe.ingredients.map((ing) => ({
          canonical_name: ing.canonicalName,
          required_quantity: Number(ing.requiredQuantity),
          unit: ing.unit,
          optional: ing.optional,
        })),
      })),
    });
  } catch (err) {
    next(err);
  }
});

// GET /v1/recipes/:slug - Get a specific recipe
router.get('/:slug', async (req: Request<{ slug: string }>, res: Response, next: NextFunction) => {
  try {
    const recipe = await prisma.recipe.findUnique({
      where: { slug: req.params.slug },
      include: {
        ingredients: true,
      },
    });

    if (!recipe) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Recipe not found' },
      });
    }

    res.json({
      id: recipe.id,
      slug: recipe.slug,
      name: recipe.name,
      cook_time_minutes: recipe.cookTimeMinutes,
      prep_time_minutes: recipe.prepTimeMinutes,
      total_time_minutes: recipe.cookTimeMinutes + recipe.prepTimeMinutes,
      equipment_required: recipe.equipmentRequired,
      servings: recipe.servings,
      instructions_md: recipe.instructionsMd,
      ingredients: recipe.ingredients.map((ing) => ({
        canonical_name: ing.canonicalName,
        required_quantity: Number(ing.requiredQuantity),
        unit: ing.unit,
        optional: ing.optional,
      })),
    });
  } catch (err) {
    next(err);
  }
});

export { router as recipeRoutes };
