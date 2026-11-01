'use strict';

const describeDocument = (jsonSchema) => {
  const { $defs, $id, definitions, ref } = jsonSchema;
  const named = Object.entries({ ...definitions, ...$defs }).flatMap(
    ([key, entry]) => {
      const name = entry?.ref ?? entry?.$id;
      return typeof name === "string" ? [{ entry, key, name }] : [];
    }
  );
  const root = ref ?? $id;
  const descriptions = Object.fromEntries(
    [...named, ...root ? [{ entry: jsonSchema, name: root }] : []].flatMap(
      ({ entry, name }) => typeof entry?.description === "string" ? [[name, entry.description]] : []
    )
  );
  return {
    descriptions,
    names: Object.fromEntries(named.map(({ key, name }) => [key, name])),
    root,
    rootReferences: []
  };
};
const namedComponent = ($ref, { names, root }) => {
  if ($ref === "#") {
    return root;
  }
  const token = /^#\/(?:\$defs|definitions)\/(.+)$/.exec($ref)?.[1];
  const key = token?.replaceAll("~1", "/").replaceAll("~0", "~");
  return key && Object.hasOwn(names, key) ? names[key] : void 0;
};
const usesByComponents = /* @__PURE__ */ new WeakMap();
const generatedRoots = /* @__PURE__ */ new WeakMap();
const freeRootName = (components, reserved) => {
  let name = "Root";
  for (let suffix = 2; Object.hasOwn(components.schemas ?? {}, name) || reserved?.has(name); suffix++) {
    name = `Root${suffix}`;
  }
  return name;
};
const moveGeneratedRoot = (id, components, reserved) => {
  const roots = generatedRoots.get(components);
  const references = roots?.get(id);
  if (!references || !components.schemas) return;
  const name = freeRootName(components, reserved);
  components.schemas[name] = components.schemas[id];
  delete components.schemas[id];
  for (const reference of references) {
    reference.$ref = `#/components/schemas/${name}`;
  }
  roots?.delete(id);
  roots?.set(name, references);
  const uses = usesByComponents.get(components);
  const previous = uses?.get(id);
  if (previous) {
    uses?.delete(id);
    uses?.set(name, previous);
  }
};
const use = (id, description, components, siblings = {}) => {
  const uses = usesByComponents.get(components) ?? /* @__PURE__ */ new Map();
  usesByComponents.set(components, uses);
  const previous = uses.get(id);
  const shared = !previous || previous.shared && previous.description === description;
  if (previous?.shared && !shared) {
    if (previous.description !== void 0) {
      previous.references.forEach((reference2) => {
        reference2.description = previous.description;
      });
    }
    const current = components.schemas?.[id];
    if (current) {
      const { description: _, ...undescribed } = current;
      components.schemas = { ...components.schemas, [id]: undescribed };
    }
  }
  const reference = {
    ...siblings,
    $ref: `#/components/schemas/${id}`,
    ...!shared && description !== void 0 ? { description } : {}
  };
  if (shared && previous) {
    previous.references.push(reference);
  } else {
    uses.set(id, {
      description,
      references: shared ? [reference] : [],
      shared
    });
  }
  return { reference, shared };
};
const register = (id, schema, { components }) => {
  moveGeneratedRoot(id, components);
  const { description, ...undescribed } = schema;
  const { reference, shared } = use(id, description, components);
  components.schemas = {
    ...components.schemas,
    [id]: shared ? schema : undescribed
  };
  return reference;
};
const convertToOpenAPISchema = (jsonSchema, context) => {
  const document = describeDocument(jsonSchema);
  const names = new Set(Object.values(document.names));
  if (document.root) names.add(document.root);
  for (const name2 of names) {
    moveGeneratedRoot(name2, context.components, names);
  }
  const schema = convert(jsonSchema, context, document);
  if (document.rootReferences.length === 0) {
    return schema;
  }
  const name = freeRootName(context.components);
  const reference = register(name, schema, context);
  for (const use2 of document.rootReferences) {
    use2.$ref = reference.$ref;
  }
  const roots = generatedRoots.get(context.components) ?? /* @__PURE__ */ new Map();
  roots.set(name, [reference, ...document.rootReferences]);
  generatedRoots.set(context.components, roots);
  return reference;
};
const convert = (jsonSchema, context, document) => {
  if (typeof jsonSchema === "boolean") {
    return jsonSchema;
  }
  const _jsonSchema = JSON.parse(JSON.stringify(jsonSchema));
  if ("nullable" in _jsonSchema && _jsonSchema.nullable === true) {
    if (_jsonSchema.type) {
      if (Array.isArray(_jsonSchema.type)) {
        if (!_jsonSchema.type.includes("null")) {
          _jsonSchema.type.push("null");
        }
      } else {
        _jsonSchema.type = [_jsonSchema.type, "null"];
      }
    } else {
      _jsonSchema.type = ["null"];
    }
    delete _jsonSchema.nullable;
  }
  if (_jsonSchema.$schema) {
    delete _jsonSchema.$schema;
  }
  const nestedSchemaKeys = [
    "properties",
    "additionalProperties",
    "items",
    "prefixItems",
    "additionalItems",
    "allOf",
    "anyOf",
    "oneOf",
    "not",
    "if",
    "then",
    "else",
    "definitions",
    "$defs",
    "patternProperties",
    "dependentSchemas",
    "propertyNames",
    "contains",
    "contentSchema",
    "unevaluatedProperties",
    "unevaluatedItems"
  ];
  nestedSchemaKeys.forEach((key) => {
    if (_jsonSchema[key] && (typeof _jsonSchema[key] === "object" || Array.isArray(_jsonSchema[key]))) {
      if (key === "properties" || key === "definitions" || key === "$defs" || key === "patternProperties" || key === "dependentSchemas") {
        for (const subKey in _jsonSchema[key]) {
          _jsonSchema[key][subKey] = convert(
            _jsonSchema[key][subKey],
            context,
            document
          );
        }
      } else if (key === "allOf" || key === "anyOf" || key === "oneOf" || key === "prefixItems") {
        _jsonSchema[key] = _jsonSchema[key].map(
          (item) => convert(item, context, document)
        );
      } else if (key === "items") {
        if (Array.isArray(_jsonSchema[key])) {
          _jsonSchema[key] = _jsonSchema[key].map(
            (item) => convert(item, context, document)
          );
        } else {
          _jsonSchema[key] = convert(_jsonSchema[key], context, document);
        }
      } else {
        _jsonSchema[key] = convert(_jsonSchema[key], context, document);
      }
    }
  });
  if (_jsonSchema.$defs || _jsonSchema.definitions) {
    const lifted = Object.entries({
      ..._jsonSchema.definitions,
      ..._jsonSchema.$defs
    }).filter(([key]) => !Object.hasOwn(document.names, key));
    const names = new Set(lifted.map(([name]) => name));
    for (const name of names) {
      moveGeneratedRoot(name, context.components, names);
    }
    context.components.schemas = {
      ...Object.fromEntries(lifted),
      ...context.components.schemas
    };
    delete _jsonSchema.$defs;
    delete _jsonSchema.definitions;
  }
  if (_jsonSchema.ref || _jsonSchema.$id) {
    const { ref, $id, ...component } = _jsonSchema;
    return register(ref || $id, component, context);
  } else if (_jsonSchema.$ref) {
    const { $ref, ...rest } = _jsonSchema;
    const lowerRef = $ref.toLowerCase();
    if (lowerRef.startsWith("http://") || lowerRef.startsWith("https://") || $ref.startsWith("//")) {
      return { ...rest, $ref };
    }
    if ($ref === "#" && !document.root) {
      const reference = { ...rest, $ref };
      document.rootReferences.push(reference);
      return reference;
    }
    const named = namedComponent($ref, document);
    if (named && rest.description === void 0) {
      return use(named, document.descriptions[named], context.components, rest).reference;
    }
    return {
      ...rest,
      $ref: `#/components/schemas/${named ?? $ref.split("/").pop()}`
    };
  }
  return _jsonSchema;
};

exports.convertToOpenAPISchema = convertToOpenAPISchema;
