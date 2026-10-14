import { STATUS_CODES } from 'node:http';

// RFC 9457 Problem Details; about:blank means the HTTP status describes the problem.
export const problem = (status: number, detail: string) => ({
  type: 'about:blank',
  title: STATUS_CODES[status] ?? 'Error',
  status,
  detail,
});

// The error handler turns this into a Problem Details response with the given status.
export const fail = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });
