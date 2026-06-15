export class VersionResolveError extends Error {
  public readonly kind = "VersionResolveError" as const;

  constructor(message: string) {
    super(message);
    this.name = "VersionResolveError";
  }
}
