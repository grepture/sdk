export class GreptureError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "GreptureError";
  }
}

export class AuthError extends GreptureError {
  constructor(message: string) {
    super(401, message);
    this.name = "AuthError";
  }
}

export class BadRequestError extends GreptureError {
  constructor(message: string) {
    super(400, message);
    this.name = "BadRequestError";
  }
}

export class BlockedError extends GreptureError {
  constructor(message: string) {
    super(403, message);
    this.name = "BlockedError";
  }
}

export class ProxyError extends GreptureError {
  constructor(status: number, message: string) {
    super(status, message);
    this.name = "ProxyError";
  }
}
