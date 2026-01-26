import { ErrorCodes, ApiError } from '../types';

export class AppError extends Error {
  constructor(
    public code: keyof typeof ErrorCodes,
    message: string,
    public statusCode: number = 500,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AppError';
  }

  toResponse(): ApiError {
    return {
      error: {
        code: this.code,
        message: this.message,
        details: this.details,
      },
    };
  }
}

export class InvalidInputError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('INVALID_INPUT', message, 400, details);
  }
}

export class NoFeasibleTimeWindowError extends AppError {
  constructor(details?: Record<string, unknown>) {
    super(
      'NO_FEASIBLE_TIME_WINDOW',
      'No feasible time window available for cooking tonight.',
      409,
      details
    );
  }
}

export class NoEligibleRecipeError extends AppError {
  constructor(details?: Record<string, unknown>) {
    super(
      'NO_ELIGIBLE_RECIPE',
      'No eligible recipe fits the time window and equipment constraints.',
      409,
      details
    );
  }
}

export class PlanNotFoundError extends AppError {
  constructor(planId: string) {
    super('PLAN_NOT_FOUND', `Plan with ID ${planId} not found.`, 404);
  }
}

export class InvalidPlanStatusError extends AppError {
  constructor(currentStatus: string, attemptedStatus: string) {
    super(
      'INVALID_PLAN_STATUS',
      `Cannot transition plan from '${currentStatus}' to '${attemptedStatus}'.`,
      409,
      { currentStatus, attemptedStatus }
    );
  }
}
