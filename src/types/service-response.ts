export interface ServiceResponse<T = any> {
  data?: T;
  error?: string;
  status?: number;
}

export type SuccessResponse<T> = { data: T };
export type ErrorResponse = { error: string; status: number };

export type ServiceResult<T = any> = Promise<ServiceResponse<T>>;
