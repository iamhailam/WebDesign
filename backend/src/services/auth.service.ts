import type pg from 'pg';
import { ACCESS_TOKEN_TTL_SECONDS, signAccessToken, type JwtSettings } from '../auth/jwt.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { withTransaction } from '../config/database.js';
import { ApiError } from '../http/error.js';
import type { ActorRecord, Role, UserSelf } from '../types/auth.js';

interface UserRow {
  id: number;
  full_name: string;
  email: string;
  phone: string | null;
  role: Role;
  is_active: boolean;
  created_at: Date | string;
}

interface LoginRow extends UserRow {
  password_hash: string;
  token_version: number;
}

interface ActorRow extends UserRow {
  token_version: number;
}

interface UserListRow extends UserRow {
  total_count: string | number;
}

function requireRow<T>(row: T | undefined): T {
  if (!row) {
    throw new ApiError(500, 'INTERNAL_ERROR', 'Đã xảy ra lỗi hệ thống.');
  }
  return row;
}

function mapUserSelf(row: UserRow): UserSelf {
  return {
    id: row.id,
    full_name: row.full_name,
    email: row.email,
    phone: row.phone ?? null,
    role: row.role,
    is_active: row.is_active,
    created_at: new Date(row.created_at).toISOString(),
  };
}

export interface RegisterInput {
  full_name: string;
  email: string;
  password: string;
  phone: string | null;
}

export interface LoginResult {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  user: UserSelf;
}

export interface ListUsersInput {
  page: number;
  page_size: number;
  search?: string | undefined;
  role?: Role | undefined;
  is_active?: boolean | undefined;
}

export interface UpdateUserInput {
  full_name: string;
  phone: string | null;
  role: Role;
  is_active: boolean;
}

export function createAuthService(pool: pg.Pool, jwtSettings: JwtSettings) {
  async function registerCustomer(input: RegisterInput): Promise<UserSelf> {
    const passwordHash = await hashPassword(input.password);
    return withTransaction(pool, async (client) => {
      const result = await client.query<UserRow>(
        'SELECT id, full_name, email, phone, role, is_active, created_at FROM app.fn_register_customer($1, $2, $3, $4)',
        [input.full_name, input.email, passwordHash, input.phone],
      );
      return mapUserSelf(requireRow(result.rows[0]));
    });
  }

  async function login(email: string, password: string): Promise<LoginResult> {
    const result = await pool.query<LoginRow>(
      'SELECT id, full_name, email, password_hash, phone, role, is_active, token_version, created_at FROM app.fn_get_login_record($1)',
      [email],
    );
    const row = result.rows[0];
    const passwordMatches = await verifyPassword(password, row?.password_hash ?? '');
    if (!row || !row.is_active || !passwordMatches) {
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email hoặc mật khẩu không đúng hoặc tài khoản đã bị vô hiệu hóa.');
    }

    const accessToken = signAccessToken(
      { id: row.id, role: row.role, ver: row.token_version },
      jwtSettings,
    );

    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      user: mapUserSelf(row),
    };
  }

  async function getActor(userId: number): Promise<ActorRecord | null> {
    const result = await pool.query<ActorRow>(
      'SELECT id, full_name, email, phone, role, is_active, token_version, created_at FROM app.fn_get_actor($1)',
      [userId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      ...mapUserSelf(row),
      token_version: row.token_version,
    };
  }

  async function listUsers(actorId: number, query: ListUsersInput) {
    const result = await pool.query<UserListRow>(
      'SELECT id, full_name, email, phone, role, is_active, created_at, total_count FROM app.fn_read_users($1, $2, $3, $4, $5, $6)',
      [
        actorId,
        query.page,
        query.page_size,
        query.search ?? null,
        query.role ?? null,
        query.is_active ?? null,
      ],
    );
    const firstRow = result.rows[0];
    const total = firstRow ? Number(firstRow.total_count) : 0;
    const totalPages = total === 0 ? 0 : Math.ceil(total / query.page_size);
    return {
      items: result.rows.map(mapUserSelf),
      pagination: {
        page: query.page,
        page_size: query.page_size,
        total,
        total_pages: totalPages,
      },
    };
  }

  async function getUserById(actorId: number, targetId: number): Promise<UserSelf> {
    const result = await pool.query<UserRow>(
      'SELECT id, full_name, email, phone, role, is_active, created_at FROM app.fn_read_user($1, $2)',
      [actorId, targetId],
    );
    return mapUserSelf(requireRow(result.rows[0]));
  }

  async function updateUser(
    actorId: number,
    targetId: number,
    input: UpdateUserInput,
    requestId: string,
  ): Promise<UserSelf> {
    return withTransaction(pool, async (client) => {
      const result = await client.query<UserRow>(
        'SELECT id, full_name, email, phone, role, is_active, created_at FROM app.fn_manage_user($1, $2, $3, $4, $5, $6, $7::uuid)',
        [actorId, targetId, input.full_name, input.phone, input.role, input.is_active, requestId],
      );
      return mapUserSelf(requireRow(result.rows[0]));
    });
  }

  return {
    registerCustomer,
    login,
    getActor,
    listUsers,
    getUserById,
    updateUser,
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
