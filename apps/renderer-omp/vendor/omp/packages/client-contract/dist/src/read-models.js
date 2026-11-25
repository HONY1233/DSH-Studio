/**
 * OMP treats a models.yml `apiKey` as an environment variable name when it
 * looks like one (`FOO_BAR`, all-caps identifiers). Literal keys (`sk-…`)
 * and `!command` values are not env names.
 */
export function isModelEnvConfigName(value) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value))
        return false;
    if (/^sk/i.test(value))
        return false;
    return value.includes("_") || (value === value.toUpperCase() && value.length >= 4);
}
//# sourceMappingURL=read-models.js.map