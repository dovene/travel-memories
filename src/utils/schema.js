/*
 * Minimal JSON Schema validator (no dependencies) for the subset used by schemas/*.json:
 * type, const, enum, pattern, minLength, maxLength, minimum, maximum, required,
 * properties, additionalProperties: false, items, minItems, maxItems and local $ref.
 *
 * Unsupported keywords throw, so the schemas can never silently claim a rule
 * that is not actually enforced.
 */

const SUPPORTED = new Set([
  "$schema", "$id", "$defs", "$ref", "title", "description",
  "type", "const", "enum", "pattern", "minLength", "maxLength", "minimum", "maximum",
  "required", "properties", "additionalProperties", "items", "minItems", "maxItems",
]);

function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
}

function matchesType(value, type) {
  const actual = typeOf(value);
  if (type === "number") return actual === "number" || actual === "integer";
  return actual === type;
}

function resolveRef(root, ref) {
  if (!ref.startsWith("#/")) throw new Error(`Only local $ref is supported: ${ref}`);
  return ref
    .slice(2)
    .split("/")
    .reduce((node, part) => {
      if (!node || !(part in node)) throw new Error(`Unresolvable $ref: ${ref}`);
      return node[part];
    }, root);
}

function walk(root, schema, value, path, errors) {
  for (const key of Object.keys(schema)) {
    if (!SUPPORTED.has(key)) throw new Error(`Unsupported schema keyword "${key}" at ${path || "/"}`);
  }
  if (schema.$ref) return walk(root, resolveRef(root, schema.$ref), value, path, errors);

  const at = path || "/";
  const push = (message) => errors.push({ path: at, message });

  if ("const" in schema && value !== schema.const) return push(`must be ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) return push(`must be one of: ${schema.enum.join(", ")}`);
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => matchesType(value, t))) return push(`must be of type ${types.join(" or ")}`);
  }

  if (typeof value === "string") {
    if (schema.minLength != null && value.length < schema.minLength)
      push(schema.minLength === 1 ? "must not be empty" : `must be at least ${schema.minLength} characters`);
    if (schema.maxLength != null && value.length > schema.maxLength) push(`must be at most ${schema.maxLength} characters`);
    if (schema.pattern && !new RegExp(schema.pattern, "u").test(value)) push("has an invalid format");
  }

  if (typeof value === "number") {
    if (schema.minimum != null && value < schema.minimum) push(`must be ≥ ${schema.minimum}`);
    if (schema.maximum != null && value > schema.maximum) push(`must be ≤ ${schema.maximum}`);
  }

  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) push(`must have at least ${schema.minItems} items`);
    if (schema.maxItems != null && value.length > schema.maxItems) push(`must have at most ${schema.maxItems} items`);
    if (schema.items) value.forEach((item, i) => walk(root, schema.items, item, `${path}/${i}`, errors));
  }

  if (typeOf(value) === "object") {
    for (const key of schema.required || []) if (!(key in value)) errors.push({ path: `${path}/${key}`, message: "is required" });
    const props = schema.properties || {};
    for (const [key, child] of Object.entries(value)) {
      if (props[key]) walk(root, props[key], child, `${path}/${key}`, errors);
      else if (schema.additionalProperties === false) errors.push({ path: `${path}/${key}`, message: "is not allowed" });
    }
  }
}

/* Returns a list of { path, message } errors; empty when valid. */
export function validate(schema, value, root = schema) {
  const errors = [];
  walk(root, schema, value, "", errors);
  return errors;
}
