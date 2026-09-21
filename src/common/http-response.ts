export type ApiResponse<T> = {
  code: number;
  data: T | null;
  msg: string;
  message: string;
  success: boolean;
};

export function ok<T>(data: T, msg = '操作成功'): ApiResponse<T> {
  return { code: 200, data, msg, message: msg, success: true };
}

export function fail(code: number, msg: string): ApiResponse<null> {
  return { code, data: null, msg, message: msg, success: false };
}
