import type { Branch, Role } from '@prisma/client';

/** Shape returned by POST /auth/login and GET /auth/me (stable contract for clients). */
export type AuthUserDto = {
  id: string;
  fullName: string;
  phone: string | null;
  role: Role;
  branchId: string | null;
  branch: { id: string; name: string } | null;
  filesUrl?: string | null;
  shift?: string | null;
  salary?: any;
  startDate?: Date | null;
  isActive?: boolean;
};

type UserWithBranch = {
  id: string;
  fullName: string;
  phone: string | null;
  role: Role;
  branchId: string | null;
  branch: Pick<Branch, 'id' | 'name'> | null;
  filesUrl?: string | null;
  shift?: string | null;
  salary?: any;
  startDate?: Date | null;
  isActive?: boolean;
};

export function toAuthUserDto(user: UserWithBranch): AuthUserDto {
  return {
    id: user.id,
    fullName: user.fullName,
    phone: user.phone,
    role: user.role,
    branchId: user.branchId,
    branch: user.branch ? { id: user.branch.id, name: user.branch.name } : null,
    filesUrl: user.filesUrl,
    shift: user.shift,
    salary: user.salary,
    startDate: user.startDate,
    isActive: user.isActive,
  };
}
