import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  type PaginationQueryDto,
} from './pagination.dto';

export type PaginationMeta = {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
};

export type PaginatedResponse<T> = {
  data: T[];
  pagination: PaginationMeta;
};

export type NormalizedPagination = {
  limit: number;
  offset: number;
  page: number;
  pageSize: number;
};

export function normalizePagination(
  query: PaginationQueryDto,
): NormalizedPagination {
  const page = query.page ?? DEFAULT_PAGE;
  const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;

  return {
    limit: pageSize,
    offset: (page - 1) * pageSize,
    page,
    pageSize,
  };
}

export function createPaginatedResponse<T>(
  data: T[],
  totalItems: number,
  pagination: Pick<NormalizedPagination, 'page' | 'pageSize'>,
): PaginatedResponse<T> {
  const totalPages = Math.max(1, Math.ceil(totalItems / pagination.pageSize));

  return {
    data,
    pagination: {
      hasNextPage: pagination.page < totalPages,
      hasPreviousPage: pagination.page > 1,
      page: pagination.page,
      pageSize: pagination.pageSize,
      totalItems,
      totalPages,
    },
  };
}
