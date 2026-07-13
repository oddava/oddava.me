import {
  adminJson,
  withAdminSecurityHeaders,
} from '../../../../lib/server/admin';
import {
  CredentialValidationError,
  IntegrationNotManageableError,
  UnknownIntegrationError,
} from '../../../../lib/server/integrations';
import { isStorageUnavailableError } from '../../../../lib/server/community';

/**
 * Maps the integration domain's error types onto HTTP. Keeping this in one
 * place is what stops each route from inventing its own status codes for the
 * same failure.
 */
export function integrationErrorResponse(error: unknown): Response {
  if (error instanceof UnknownIntegrationError) {
    return adminJson(
      { error: error.message, code: 'unknown_integration' },
      { status: 404 },
    );
  }

  if (error instanceof IntegrationNotManageableError) {
    return adminJson(
      { error: error.message, code: 'not_manageable' },
      { status: 409 },
    );
  }

  if (error instanceof CredentialValidationError) {
    return adminJson(
      {
        error: error.message,
        code: 'invalid_credentials',
        issues: error.issues.map((issue) => ({
          path: [issue.key],
          message: issue.message,
        })),
      },
      { status: 422 },
    );
  }

  if (isStorageUnavailableError(error)) {
    return adminJson(
      {
        error:
          'Integration settings cannot be saved because persistent storage is unavailable.',
        code: 'storage_unavailable',
      },
      { status: 503 },
    );
  }

  console.error('[integrations] request failed', error);
  return adminJson(
    { error: 'The request failed.', code: 'integration_error' },
    { status: 500 },
  );
}

export { adminJson, withAdminSecurityHeaders };
