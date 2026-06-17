export class DispatchError extends Error {
  public readonly kind = "DispatchError" as const;

  constructor(message: string) {
    super(message);
    this.name = "DispatchError";
  }
}
