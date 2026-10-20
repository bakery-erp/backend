export interface PaginationParams {
  page: number;
  limit: number;
  skip: number;
  take: number;
}

export interface PaginationMetadata {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
  pagination: PaginationMetadata;
}

/**
 * Parses page and limit from query params with safe defaults and boundaries.
 */
export function parsePagination(
  query: Record<string, unknown>,
  defaultLimit: number = 20,
  maxLimit: number = 100
): PaginationParams {
  const rawPage = Number(query.page);
  const rawLimit = Number(query.limit ?? query.pageSize);

  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, maxLimit) : defaultLimit;
  const skip = (page - 1) * limit;

  return {
    page,
    limit,
    skip,
    take: limit,
  };
}

/**
 * Wraps list data and total into standard pagination response.
 */
export function buildPaginatedResponse<T>(
  data: T[],
  total: number,
  page: number,
  limit: number
): PaginatedResult<T> {
  const totalPages = Math.max(1, Math.ceil(total / (limit || 1)));
  const hasNextPage = page < totalPages;
  const hasPrevPage = page > 1;

  const metadata: PaginationMetadata = {
    page,
    limit,
    total,
    totalPages,
    hasNextPage,
    hasPrevPage,
  };

  return {
    data,
    total,
    page,
    limit,
    totalPages,
    hasNextPage,
    hasPrevPage,
    pagination: metadata,
  };
}
