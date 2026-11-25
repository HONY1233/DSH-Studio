export class ContractValidationError extends Error {
    path;
    constructor(message, path = "$") {
        super(`${path}: ${message}`);
        this.path = path;
        this.name = "ContractValidationError";
    }
}
//# sourceMappingURL=contract-error.js.map