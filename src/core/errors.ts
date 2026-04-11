export class GlialNodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GlialNodeError";
  }
}

export class ValidationError extends GlialNodeError {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class ConfigurationError extends GlialNodeError {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}
