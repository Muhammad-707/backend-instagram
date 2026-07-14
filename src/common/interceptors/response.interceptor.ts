import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Response } from 'express';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ApiResponse<T> {
  data: T | null;
  errors: string[] | null;
  statusCode: number;
}

/**
 * Единый конверт: { data, errors, statusCode }.
 * errors ВСЕГДА null при успехе (баг softclub #1: errors: ["success"]).
 */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, ApiResponse<T>> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<ApiResponse<T>> {
    const res = context.switchToHttp().getResponse<Response>();
    return next.handle().pipe(
      map((data) => ({
        data: data === undefined ? null : data,
        errors: null,
        statusCode: res.statusCode,
      })),
    );
  }
}
