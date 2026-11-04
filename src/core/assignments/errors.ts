/** Den ansatte finnes ikke i organisasjonen, er slettet eller har sluttet. Ingenting er endret. */
export class EmployeeNotFoundError extends Error {
  constructor() {
    super("Den ansatte finnes ikke.");
    this.name = "EmployeeNotFoundError";
  }
}
