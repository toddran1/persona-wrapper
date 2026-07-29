import type { AuthClientType } from "@persona/shared";

declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        sessionId: string;
        clientType: AuthClientType;
        policyConsentRequired: boolean;
        isAdmin?: boolean;
      };
    }
  }
}

export {};
