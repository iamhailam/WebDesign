export const ROLES = ['CUSTOMER', 'SALES', 'WAREHOUSE', 'MARKETING', 'ADMIN'] as const;

export type Role = (typeof ROLES)[number];

export interface UserSelf {
  id: number;
  full_name: string;
  email: string;
  phone: string | null;
  role: Role;
  is_active: boolean;
  created_at: string;
}

export interface ActorRecord extends UserSelf {
  token_version: number;
}

export interface AccessTokenClaims {
  id: number;
  role: Role;
  ver: number;
  exp: number;
  iat: number;
}
