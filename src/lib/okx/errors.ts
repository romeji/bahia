export class OkxError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class OkxValidationError extends OkxError {}

export class OkxConfigurationError extends OkxError {}

export class OkxHttpError extends OkxError {
  readonly status: number;
  readonly responseBody: string;

  constructor(status: number, statusText: string, responseBody: string) {
    super(`OKX HTTP ${status}${statusText ? ` ${statusText}` : ""}`);
    this.status = status;
    this.responseBody = responseBody;
  }
}

export class OkxApiError extends OkxError {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`OKX API ${code}: ${message || "Unknown error"}`);
    this.code = code;
  }
}

export class OkxResponseError extends OkxError {}

