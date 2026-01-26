import express, { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError, InvalidInputError } from './utils/errors';
import { planRoutes } from './routes/plan';
import { inventoryRoutes } from './routes/inventory';
import { recipeRoutes } from './routes/recipes';
import { householdRoutes } from './routes/households';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Routes
app.use('/v1/plan', planRoutes);
app.use('/v1/inventory', inventoryRoutes);
app.use('/v1/recipes', recipeRoutes);
app.use('/v1/households', householdRoutes);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Error handling middleware
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Error:', err);

  if (err instanceof ZodError) {
    const inputError = new InvalidInputError('Validation failed', {
      issues: err.issues,
    });
    return res.status(inputError.statusCode).json(inputError.toResponse());
  }

  if (err instanceof AppError) {
    return res.status(err.statusCode).json(err.toResponse());
  }

  // Generic error
  return res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
    },
  });
});

// 404 handler
app.use((_req, res) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: 'Endpoint not found.',
    },
  });
});

app.listen(PORT, () => {
  console.log(`Josy server running on port ${PORT}`);
});

export default app;
