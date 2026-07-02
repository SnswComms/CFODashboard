import { createAuthClient } from 'better-auth/react';
import { adminClient } from 'better-auth/client/plugins';

// Same-origin: no baseURL — browser traffic goes through the Next /api rewrite
// (localhost:3000 -> Express :4000), and the default basePath /api/auth matches
// the backend mount, so cookies flow without CORS.
export const authClient = createAuthClient({
  plugins: [adminClient()],
});

export const { useSession, signIn, signOut } = authClient;

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  role?: string | null;
  banned?: boolean | null;
  image?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};
