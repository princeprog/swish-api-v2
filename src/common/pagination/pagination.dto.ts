import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Min } from 'class-validator';

export const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;
export const DEFAULT_PAGE = 1;
export const DEFAULT_PAGE_SIZE = 10;

export type PageSizeOption = (typeof PAGE_SIZE_OPTIONS)[number];

export class PaginationQueryDto {
  @IsInt()
  @IsOptional()
  @Min(1)
  @Type(() => Number)
  page?: number = DEFAULT_PAGE;

  @IsIn(PAGE_SIZE_OPTIONS)
  @IsOptional()
  @Type(() => Number)
  pageSize?: PageSizeOption = DEFAULT_PAGE_SIZE;
}

export function TrimmedOptionalString() {
  return Transform(({ value }) => {
    if (typeof value !== 'string') {
      return value;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  });
}
