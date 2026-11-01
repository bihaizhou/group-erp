import { findTargetHandler } from 'hono/utils/handler';
import { checkOptionalParameter } from 'hono/utils/url';
import { sValidator } from '@hono/standard-validator';
import { loadVendor as loadVendor$1, toJsonSchema } from '@standard-community/standard-json';
import { loadVendor as loadVendor$2, toOpenAPISchema } from '@standard-community/standard-openapi';

const COMPONENTS_PREFIX = "#/components/";
const SCHEMA_REF = `${COMPONENTS_PREFIX}schemas/`;
const decodeName = (name) => name.replaceAll("~1", "/").replaceAll("~0", "~");
const encodeName = (name) => name.replaceAll("~", "~0").replaceAll("/", "~1");
const renameRef = (ref, rename) => {
  if (!ref.startsWith(SCHEMA_REF)) {
    return ref;
  }
  const renamed = rename(decodeName(ref.slice(SCHEMA_REF.length)));
  return renamed === void 0 ? ref : `${SCHEMA_REF}${encodeName(renamed)}`;
};
const renameMappingTarget = (target, rename) => {
  if (target.startsWith(SCHEMA_REF)) {
    return renameRef(target, rename);
  }
  if (target.includes("/") || target.includes("#")) {
    return target;
  }
  return rename(target) ?? target;
};
const isDiscriminator = (value) => value != null && typeof value === "object" && typeof value.propertyName === "string";
const LITERAL_FIELDS = /* @__PURE__ */ new Set([
  "example",
  "default",
  "enum",
  "const",
  "value"
]);
const REFERENCE_MAPS = /* @__PURE__ */ new Set([
  "paths",
  "webhooks",
  "examples",
  "schemas",
  "parameters",
  "responses",
  "requestBodies",
  "headers",
  "content",
  "encoding",
  "links",
  "callbacks",
  "pathItems",
  "properties",
  "patternProperties",
  "$defs",
  "definitions",
  "dependentSchemas",
  "dependencies"
]);
const mapReferences = (value, reference, isMap = false) => {
  if (Array.isArray(value)) {
    return value.map((item) => mapReferences(item, reference));
  }
  if (value == null || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if (isMap) {
        return [key, mapReferences(item, reference)];
      }
      if (LITERAL_FIELDS.has(key) || key.startsWith("x-") || key === "examples" && Array.isArray(item)) {
        return [key, item];
      }
      if (key === "$ref" && typeof item === "string") {
        return [key, reference(item, false)];
      }
      if (key === "discriminator" && isDiscriminator(item) && item.mapping) {
        return [
          key,
          {
            ...item,
            mapping: Object.fromEntries(
              Object.entries(item.mapping).map(([name, target]) => [
                name,
                reference(target, true)
              ])
            )
          }
        ];
      }
      return [key, mapReferences(item, reference, REFERENCE_MAPS.has(key))];
    })
  );
};
const renameSchemaRefs = (value, rename, isMap = false) => mapReferences(
  value,
  (target, mapping) => mapping ? renameMappingTarget(target, rename) : renameRef(target, rename),
  isMap
);
const componentRefs = (value) => {
  const refs = [];
  mapReferences(value, (target, mapping) => {
    if (target.startsWith(COMPONENTS_PREFIX)) {
      refs.push(target.slice(COMPONENTS_PREFIX.length));
    } else if (mapping && !target.includes("/") && !target.includes("#")) {
      refs.push(`schemas/${encodeName(target)}`);
    }
    return target;
  });
  return refs;
};

const uniqueSymbol = Symbol.for("hono-openapi");
const VALIDATION_MARKER = "__HonoOpenAPIValidator__";
const ALLOWED_METHODS = [
  "GET",
  "PUT",
  "POST",
  "DELETE",
  "OPTIONS",
  "HEAD",
  "PATCH",
  "TRACE"
];
const toOpenAPIPathSegment = (segment) => {
  let tmp = segment;
  if (tmp.startsWith(":")) {
    const match = tmp.match(/^:([^{?]+)(?:{(.+)})?(\?)?$/);
    if (match) {
      const paramName = match[1];
      tmp = `{${paramName}}`;
    } else {
      tmp = tmp.slice(1, tmp.length);
      if (tmp.endsWith("?")) tmp = tmp.slice(0, -1);
      tmp = `{${tmp}}`;
    }
  }
  return tmp;
};
const toOpenAPIPath = (path) => path.split("/").map(toOpenAPIPathSegment).join("/");
const toPascalCase = (text) => text.split(/[\W_]+/).filter(Boolean).map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join("");
const generateOperationId = (route) => {
  let operationId = route.method.toLowerCase();
  if (route.path === "/") return `${operationId}Index`;
  for (const segment of route.path.split("/")) {
    const openApiPathSegment = toOpenAPIPathSegment(segment);
    if (openApiPathSegment.charCodeAt(0) === 123) {
      operationId += `By${toPascalCase(openApiPathSegment.slice(1, -1))}`;
    } else {
      operationId += toPascalCase(openApiPathSegment);
    }
  }
  return operationId;
};
const generatedOperationIds = /* @__PURE__ */ new WeakMap();
const derivedOperationIds = /* @__PURE__ */ new WeakMap();
const pathParameterNames = (path) => path.split("/").filter((segment) => segment.startsWith(":")).map((segment) => toOpenAPIPathSegment(segment).slice(1, -1));
const expandOptionalParameters = (route) => {
  const paths = checkOptionalParameter(route.path);
  if (!paths) {
    return [{ route, omitted: void 0 }];
  }
  const names = pathParameterNames(route.path);
  return paths.map((path) => {
    const kept = pathParameterNames(path);
    return {
      route: { ...route, path },
      omitted: names.filter((name) => !kept.includes(name))
    };
  });
};
const withOmittedParameters = (specs, omitted) => {
  if (!omitted || !specs) {
    return specs;
  }
  const expanded = {
    ...specs,
    ...omitted.length && typeof specs.operationId === "string" ? {
      operationId: `${specs.operationId}Without${omitted.map(toPascalCase).join("And")}`
    } : {}
  };
  if (omitted.length && typeof expanded.operationId === "string") {
    derivedOperationIds.set(expanded, expanded.operationId);
  }
  setSpecComponents(expanded, getSpecComponents(specs));
  expandedOperations.add(expanded);
  return expanded;
};
const paramKey = (param) => "$ref" in param ? param.$ref : `${param.in} ${param.name}`;
function mergeParameters(...params) {
  const merged = params.flatMap((x) => x ?? []).reduce((acc, param) => {
    acc.set(paramKey(param), param);
    return acc;
  }, /* @__PURE__ */ new Map());
  return Array.from(merged.values());
}
const specComponents = /* @__PURE__ */ new WeakMap();
const setSpecComponents = (spec, components) => specComponents.set(spec, components);
const getSpecComponents = (spec) => spec != null && typeof spec === "object" && specComponents.get(spec) || [];
const expandedOperations = /* @__PURE__ */ new WeakSet();
const isExpandedOperation = (spec) => spec != null && typeof spec === "object" && expandedOperations.has(spec);
const specsByPathContext = /* @__PURE__ */ new Map();
function getPathContext(path, pathContext) {
  const context = [];
  for (const [key, data] of pathContext) {
    if (!data) continue;
    const prefix = key.endsWith("/*") ? key.slice(0, -2) : key;
    if (path === prefix || path.startsWith(`${prefix}/`)) {
      context.push(data);
    }
  }
  return context;
}
function clearSpecsContext() {
  specsByPathContext.clear();
}
function mergeRequestBodies(previous, current, fromValidator = false) {
  if (!previous || !current || "$ref" in previous || "$ref" in current) {
    return current;
  }
  return {
    ...previous,
    ...current,
    // A validator only infers `required`, so a value the route described wins.
    ...fromValidator && previous.required !== void 0 ? { required: previous.required } : {},
    content: {
      ...previous.content,
      ...current.content
    }
  };
}
function mergeSpecs(route, ...specs) {
  const generatedOperationId = generateOperationId(route);
  const operationIdSpec = specs.findLast(
    (spec) => spec?.operationId != null && generatedOperationIds.get(spec) !== spec.operationId
  );
  const merged = specs.reduce(
    (prev, spec) => {
      if (!spec || !prev) return prev;
      for (const [key, value] of Object.entries(spec)) {
        if (value == null) continue;
        if (key === "operationId" && generatedOperationIds.get(spec) === value) {
          continue;
        }
        if (key in prev && (typeof value === "object" || typeof value === "function" && key === "operationId")) {
          if (Array.isArray(value)) {
            const values = [...prev[key] ?? [], ...value];
            if (key === "tags") {
              prev[key] = Array.from(new Set(values));
            } else if (key === "parameters") {
              prev[key] = mergeParameters(values);
            } else {
              prev[key] = values;
            }
          } else if (typeof value === "function") {
            prev[key] = value(route);
          } else {
            if (key === "parameters") {
              prev[key] = mergeParameters(prev[key], value);
            } else if (key === "requestBody") {
              prev.requestBody = mergeRequestBodies(
                prev.requestBody,
                value,
                spec[VALIDATION_MARKER] === true
              );
            } else {
              prev[key] = {
                ...prev[key],
                ...value
              };
            }
          }
        } else {
          prev[key] = value;
        }
      }
      return prev;
    },
    {
      operationId: generatedOperationId
    }
  );
  if (!operationIdSpec) {
    generatedOperationIds.set(merged, generatedOperationId);
  } else if (derivedOperationIds.get(operationIdSpec) === merged.operationId) {
    derivedOperationIds.set(merged, merged.operationId);
  }
  setSpecComponents(merged, specs.flatMap(getSpecComponents));
  if (specs.some(isExpandedOperation)) {
    expandedOperations.add(merged);
  }
  return merged;
}
function registerSchemaPath({ route, specs, paths }, pathContext = specsByPathContext) {
  const path = toOpenAPIPath(route.path);
  const method = route.method.toLowerCase();
  if (method === "all") {
    if (!specs) return;
    if (pathContext.has(path)) {
      const prev = pathContext.get(path) ?? {};
      pathContext.set(path, mergeSpecs(route, prev, specs));
    } else {
      pathContext.set(path, specs);
    }
  } else {
    const context = getPathContext(path, pathContext);
    if (!(path in paths)) {
      paths[path] = {};
    }
    if (paths[path]) {
      paths[path][method] = mergeSpecs(
        route,
        ...context,
        paths[path]?.[method],
        specs
      );
    }
  }
}
const uniqueOperationIds = (paths) => {
  const methods = ALLOWED_METHODS.map(
    (method) => method.toLowerCase()
  );
  const operations = Object.values(paths).flatMap(
    (item) => methods.flatMap((method) => {
      const operation = item?.[method];
      return typeof operation?.operationId === "string" ? [operation] : [];
    })
  );
  const isGenerated = (operation) => generatedOperationIds.get(operation) === operation.operationId || derivedOperationIds.get(operation) === operation.operationId;
  const reserved = new Set(operations.map(({ operationId }) => operationId));
  const explicit = operations.filter((operation) => !isGenerated(operation));
  operations.filter(isGenerated).reduce(
    (taken, operation) => {
      const operationId = operation.operationId;
      if (taken.has(operationId)) {
        operation.operationId = withFreeSuffix(
          operationId,
          (id) => taken.has(id) || reserved.has(id)
        );
      }
      return taken.add(operation.operationId);
    },
    new Set(explicit.map(({ operationId }) => operationId))
  );
};
const withFreeSuffix = (operationId, isUsed) => {
  let suffix = 2;
  while (isUsed(`${operationId}${suffix}`)) suffix++;
  return `${operationId}${suffix}`;
};
const parameterComponent = (ref, ctx) => {
  const prefix = "#/components/parameters/";
  if (!ref.$ref.startsWith(prefix)) {
    return void 0;
  }
  const name = ref.$ref.slice(prefix.length);
  const generated = ctx.components.parameters?.[name];
  if (generated) {
    return { generated: true, name, parameter: generated };
  }
  const documented = ctx.options.documentation?.components?.parameters?.[name];
  return documented && { generated: false, name, parameter: documented };
};
function removeExcludedPaths(paths, ctx) {
  const { exclude, excludeStaticFile } = ctx.options;
  const newPaths = {};
  const _exclude = Array.isArray(exclude) ? exclude : [exclude];
  for (const [key, value] of Object.entries(paths)) {
    if (value == null) continue;
    const isExplicitlyExcluded = _exclude.some((x) => {
      if (typeof x === "string") return key === x;
      return x.test(key);
    });
    if (isExplicitlyExcluded) continue;
    const isWildcardWithoutParameters = key.includes("*") && !key.includes("{");
    if (isWildcardWithoutParameters) continue;
    if (excludeStaticFile) {
      const hasPathParameters = key.includes("{");
      const lastSegment = key.split("/").pop() || "";
      const looksLikeStaticFile = lastSegment.includes(".");
      const shouldExcludeAsStaticFile = !hasPathParameters && looksLikeStaticFile;
      if (shouldExcludeAsStaticFile) continue;
    }
    for (const method of Object.keys(value)) {
      const schema = value[method];
      if (schema == null) continue;
      const hasValidation = schema[VALIDATION_MARKER] === true;
      delete schema[VALIDATION_MARKER];
      if (schema.parameters && isExpandedOperation(schema)) {
        const names = key.split("/").filter((x) => x.startsWith("{")).map((x) => x.slice(1, -1));
        schema.parameters = schema.parameters.flatMap(
          (x) => {
            const component = "$ref" in x ? parameterComponent(x, ctx) : void 0;
            const parameter = component?.parameter ?? x;
            if ("$ref" in parameter || parameter.in !== "path") {
              return [x];
            }
            if (!names.includes(parameter.name)) {
              return [];
            }
            if (!component) {
              return [{ ...parameter, required: true }];
            }
            if (component.generated && !parameter.required) {
              ctx.components.parameters = {
                ...ctx.components.parameters,
                [component.name]: { ...parameter, required: true }
              };
            }
            return [x];
          }
        );
      }
      if (key.includes("{")) {
        schema.parameters = schema.parameters ? [...schema.parameters] : [];
        const pathParameters = key.split("/").filter(
          (x) => x.startsWith("{") && !schema.parameters.find(
            (params) => params.in === "path" && params.name === x.slice(1, x.length - 1)
          )
        );
        for (const param of pathParameters) {
          const paramName = param.slice(1, param.length - 1);
          const index = schema.parameters.findIndex(
            (x) => {
              if ("$ref" in x) {
                const param2 = parameterComponent(x, ctx)?.parameter;
                if (param2 && !("$ref" in param2)) {
                  return param2.in === "path" && param2.name === paramName;
                }
                return false;
              }
              return x.in === "path" && x.name === paramName;
            }
          );
          if (index === -1) {
            schema.parameters.push({
              schema: { type: "string" },
              in: "path",
              name: paramName,
              required: true
            });
          }
        }
      }
      if (!schema.responses || Object.keys(schema.responses).length === 0) {
        schema.responses = {
          200: { description: "Successful response" }
        };
      }
      if (hasValidation && ctx.options.defaultValidationErrorResponse !== false && !schema.responses["400"]) {
        const errorResponse = ctx.options.defaultValidationErrorResponse;
        if (typeof errorResponse === "object") {
          schema.responses["400"] = structuredClone(errorResponse);
        } else if (ctx.validationErrorResponse) {
          schema.responses["400"] = structuredClone(
            ctx.validationErrorResponse
          );
        }
      }
    }
    const filteredValue = {};
    for (const method of Object.keys(value)) {
      if (value[method] != null) {
        filteredValue[method] = value[method];
      }
    }
    if (Object.keys(filteredValue).length > 0) {
      newPaths[key] = filteredValue;
    }
  }
  return newPaths;
}
const componentKey = (type, name) => `${type}/${encodeName(name)}`;
const reachableRefs = (refs, components, reached) => refs.reduce((seen, ref) => {
  if (seen.has(ref)) {
    return seen;
  }
  const [type, ...name] = ref.split("/");
  const component = components[type]?.[decodeName(name.join("/"))];
  return reachableRefs(componentRefs(component), components, seen.add(ref));
}, reached);
function documentedComponents(components, paths, documentation) {
  const contributed = new Set(
    Object.values(paths).flatMap((item) => item == null ? [] : Object.values(item)).flatMap(getSpecComponents).flatMap(
      (operationComponents) => Object.entries(operationComponents).flatMap(
        ([type, entries]) => Object.keys(entries ?? {}).map((name) => componentKey(type, name))
      )
    )
  );
  const kept = reachableRefs(
    [...componentRefs(paths), ...componentRefs(documentation)],
    components,
    contributed
  );
  return Object.fromEntries(
    Object.entries(components).flatMap(([type, entries]) => {
      const remaining = Object.entries(entries ?? {}).filter(
        ([name]) => kept.has(componentKey(type, name))
      );
      return remaining.length > 0 ? [[type, Object.fromEntries(remaining)]] : [];
    })
  );
}

const DEFAULT_OPTIONS = {
  documentation: {},
  excludeStaticFile: true,
  exclude: [],
  excludeMethods: ["OPTIONS"],
  excludeTags: [],
  defaultValidationErrorResponse: true
};
const DEFAULT_VALIDATION_ERROR = {
  description: "Validation Error",
  content: {
    "application/json": {
      schema: {
        type: "object",
        properties: {
          success: { type: "boolean", enum: [false] },
          error: {
            type: "array",
            items: {}
          },
          data: {}
        },
        required: ["success", "error", "data"]
      }
    }
  }
};
function openAPIRouteHandler(hono, options) {
  let specs;
  return async (c) => {
    if (specs) return c.json(specs);
    specs = await generateSpecs(hono, options, c);
    return c.json(specs);
  };
}
async function generateSpecs(hono, options = DEFAULT_OPTIONS, c) {
  const ctx = {
    components: {},
    // @ts-expect-error
    options: {
      ...DEFAULT_OPTIONS,
      ...options
    },
    validationErrorResponse: DEFAULT_VALIDATION_ERROR
  };
  const _documentation = ctx.options.documentation ?? {};
  const documentation = {
    ..._documentation,
    components: _documentation.components && { ..._documentation.components }
  };
  const paths = await generatePaths(hono, ctx);
  for (const path in paths) {
    for (const method in paths[path]) {
      const isHidden = getHiddenValue({
        valueOrFunc: paths[path][method]?.hide,
        method,
        path,
        c
      });
      if (isHidden) {
        paths[path][method] = void 0;
      }
    }
  }
  const resolvedDocumentation = documentation.components?.responses ? await resolveResponseSchemas(documentation.components.responses) : void 0;
  if (resolvedDocumentation && documentation.components) {
    documentation.components.responses = resolvedDocumentation.responses;
  }
  const documentedPaths = removeExcludedPaths(paths, ctx);
  uniqueOperationIds({ ...documentedPaths, ...documentation.paths });
  const { components, paths: outputPaths } = splitOutputComponents(
    mergeComponentsObjects(
      documentation.components,
      resolvedDocumentation?.components,
      documentedComponents(
        ctx.components,
        documentedPaths,
        withOutputRefs([documentation, resolvedDocumentation?.components], ctx)
      )
    ),
    documentedPaths
  );
  return {
    openapi: "3.1.0",
    ...documentation,
    tags: documentation.tags?.filter(
      (tag) => !ctx.options.excludeTags?.includes(tag?.name)
    ),
    info: {
      title: "Hono Documentation",
      description: "Development documentation",
      version: "0.0.0",
      ...documentation.info
    },
    paths: {
      ...outputPaths,
      ...documentation.paths
    },
    components
  };
}
async function generatePaths(hono, ctx) {
  const paths = {};
  const pathContext = /* @__PURE__ */ new Map();
  const defaulted = /* @__PURE__ */ new Set();
  for (const route of hono.routes) {
    const middlewareHandler = findTargetHandler(route.handler)[uniqueSymbol];
    if (!middlewareHandler) {
      if (ctx.options.includeEmptyPaths) {
        expandOptionalParameters(route).forEach(
          (expanded) => registerSchemaPath(
            {
              route: expanded.route,
              paths
            },
            pathContext
          )
        );
      }
      continue;
    }
    const routeMethod = route.method;
    if (routeMethod !== "ALL") {
      if (ctx.options.excludeMethods?.includes(routeMethod)) {
        continue;
      }
      if (!ALLOWED_METHODS.includes(routeMethod)) {
        continue;
      }
    }
    const operation = `${routeMethod} ${route.path}`;
    const defaultOptionsForThisMethod = !defaulted.has(operation) && ctx.options.defaultOptions?.[routeMethod] && {
      ...ctx.options.defaultOptions[routeMethod]
    };
    defaulted.add(operation);
    const {
      schema: routeSpecs,
      components = {},
      unreferencedComponents
    } = await getSpec(
      middlewareHandler,
      defaultOptionsForThisMethod,
      ctx.components.parameters
    );
    ctx.components = mergeComponentsObjects(
      ctx.components,
      components,
      unreferencedComponents
    );
    setSpecComponents(routeSpecs, [components]);
    expandOptionalParameters(route).forEach(
      (expanded) => registerSchemaPath(
        {
          route: expanded.route,
          specs: withOmittedParameters(routeSpecs, expanded.omitted),
          paths
        },
        pathContext
      )
    );
  }
  return paths;
}
function getHiddenValue(options) {
  const { valueOrFunc, c, method, path } = options;
  if (valueOrFunc != null) {
    if (typeof valueOrFunc === "boolean") {
      return valueOrFunc;
    }
    if (typeof valueOrFunc === "function") {
      return valueOrFunc({ c, method, path });
    }
  }
  return false;
}
const COMBINING_KEYWORDS = ["allOf", "anyOf", "oneOf", "not", "if"];
const needsBody = (schema, components) => {
  const resolved = "$ref" in schema ? components?.schemas?.[schema.$ref.split("/").at(-1) ?? ""] : schema;
  if (!resolved || "$ref" in resolved) {
    return true;
  }
  const types = [resolved.type].flat();
  return !types.includes("object") || COMBINING_KEYWORDS.some((keyword) => keyword in resolved) || (resolved.required?.length ?? 0) > 0 || (resolved.minProperties ?? 0) > 0;
};
async function getSpec(middlewareHandler, defaultOptions, parameterComponents) {
  if ("spec" in middlewareHandler) {
    const tmp = {
      ...defaultOptions,
      ...middlewareHandler.spec,
      responses: {
        ...defaultOptions?.responses,
        ...middlewareHandler.spec.responses
      }
    };
    return {
      ...await resolveSpecSchemas(tmp),
      unreferencedComponents: void 0
    };
  }
  const result = await middlewareHandler.toOpenAPISchema();
  liftSchemaDefs(result);
  let unreferencedComponents;
  const docs = {
    ...defaultOptions,
    // Mark this operation as validator-derived so a default 400 validation
    // error response can be auto-injected later (see removeExcludedPaths).
    [VALIDATION_MARKER]: true
  };
  if (middlewareHandler.target === "form" || middlewareHandler.target === "json") {
    const mediaTypes = middlewareHandler.options?.media ? [middlewareHandler.options.media] : middlewareHandler.target === "json" ? ["application/json"] : ["application/x-www-form-urlencoded", "multipart/form-data"];
    const content = Object.fromEntries(
      mediaTypes.map((media) => [media, { schema: result.schema }])
    );
    if (!docs.requestBody || !("content" in docs.requestBody) || !docs.requestBody.content) {
      docs.requestBody = {
        ...needsBody(result.schema, result.components) ? { required: true } : {},
        content
      };
    } else {
      docs.requestBody = {
        ...docs.requestBody,
        content: { ...docs.requestBody.content, ...content }
      };
    }
  } else {
    let parameters = [];
    if ("$ref" in result.schema) {
      const ref = result.schema.$ref;
      const pos = ref.split("/").pop();
      if (pos && result.components?.schemas?.[pos]) {
        const schema = result.components.schemas[pos];
        const generatedParameters = generateParameters(
          middlewareHandler.target,
          schema,
          result.components.schemas
        );
        const singleParameter = generatedParameters.length === 1 ? generatedParameters[0] : void 0;
        const existingParameter = parameterComponents?.[pos];
        if (singleParameter && (!existingParameter || "in" in existingParameter && existingParameter.in === singleParameter.in && existingParameter.name === singleParameter.name)) {
          result.components.parameters ??= {};
          result.components.parameters[pos] = singleParameter;
          parameters.push({ $ref: `#/components/parameters/${pos}` });
          delete result.components.schemas[pos];
        } else {
          parameters = generatedParameters;
          unreferencedComponents = { schemas: { [pos]: schema } };
          delete result.components.schemas[pos];
        }
      }
    } else {
      parameters = generateParameters(
        middlewareHandler.target,
        result.schema,
        result.components?.schemas
      );
    }
    docs.parameters = parameters;
  }
  const resolved = await resolveSpecSchemas(docs);
  return {
    schema: resolved.schema,
    components: mergeComponentsObjects(result.components, resolved.components),
    unreferencedComponents
  };
}
async function resolveSpecSchemas(spec) {
  const schema = { ...spec };
  let components = {};
  if (schema.responses) {
    const resolved = await resolveResponseSchemas(schema.responses);
    schema.responses = resolved.responses;
    components = resolved.components;
  }
  if (schema.requestBody && "content" in schema.requestBody) {
    const resolved = await resolveContentSchemas(schema.requestBody.content);
    schema.requestBody = { ...schema.requestBody, content: resolved.content };
    components = mergeComponentsObjects(components, resolved.components);
  }
  return { schema, components };
}
function generateParameters(target, schema, schemas) {
  const parameters = [];
  for (const [key, property] of collectParameterProperties(schema, schemas)) {
    const def = {
      in: target === "param" ? "path" : target,
      name: key,
      // @ts-expect-error ParameterObject uses the OpenAPI 3.0 schema type.
      schema: property.schema
    };
    if (property.required) {
      def.required = true;
    }
    if (def.schema && "description" in def.schema && def.schema.description) {
      def.description = def.schema.description;
      def.schema = { ...def.schema, description: void 0 };
    }
    if (def.schema && "deprecated" in def.schema && def.schema.deprecated) {
      def.deprecated = true;
      def.schema = { ...def.schema, deprecated: void 0 };
    }
    const referenced = def.schema && "$ref" in def.schema ? referencedSchema(def.schema.$ref, schemas) : void 0;
    if (referenced?.description && !def.description) {
      def.description = referenced.description;
    }
    if (referenced?.deprecated) {
      def.deprecated = true;
    }
    parameters.push(def);
  }
  return parameters;
}
const referencedSchema = ($ref, schemas) => {
  const prefix = "#/components/schemas/";
  if (!$ref.startsWith(prefix)) {
    return void 0;
  }
  const name = $ref.slice(prefix.length).replaceAll("~1", "/").replaceAll("~0", "~");
  return schemas?.[name];
};
const intersect = (entries) => {
  const properties = /* @__PURE__ */ new Map();
  for (const [key, property] of entries) {
    const existing = properties.get(key);
    properties.set(
      key,
      existing ? {
        required: existing.required || property.required,
        schema: { allOf: [existing.schema, property.schema] }
      } : property
    );
  }
  return properties;
};
const unite = (variants) => {
  const keys = new Set(variants.flatMap((variant) => [...variant.keys()]));
  return new Map(
    [...keys].map((key) => {
      const found = variants.map((variant) => variant.get(key));
      const [first, ...others] = new Map(
        found.filter((property) => property !== void 0).map(({ schema }) => [JSON.stringify(schema), schema])
      ).values();
      return [
        key,
        {
          required: found.every((property) => property?.required),
          schema: others.length ? { anyOf: [first, ...others] } : first
        }
      ];
    })
  );
};
const collectParameterProperties = (schema, schemas) => {
  const collectMember = (member, resolving) => {
    if (!("$ref" in member)) return collect(member, resolving);
    const prefix = "#/components/schemas/";
    if (!member.$ref.startsWith(prefix)) return /* @__PURE__ */ new Map();
    const name = member.$ref.slice(prefix.length).replaceAll("~1", "/").replaceAll("~0", "~");
    const referencedSchema2 = schemas?.[name];
    if (!referencedSchema2 || resolving.has(name)) return /* @__PURE__ */ new Map();
    return collect(referencedSchema2, new Set(resolving).add(name));
  };
  const collect = (current, resolving) => intersect([
    ...Object.entries(current.properties ?? {}).map(
      ([key, value]) => [
        key,
        { required: Boolean(current.required?.includes(key)), schema: value }
      ]
    ),
    ...(current.allOf ?? []).flatMap((member) => [
      ...collectMember(member, resolving)
    ]),
    ...[current.anyOf, current.oneOf].filter((variants) => variants?.length).flatMap((variants = []) => [
      ...unite(
        variants.map((variant) => collectMember(variant, resolving))
      )
    ])
  ]);
  return collect(schema, /* @__PURE__ */ new Set());
};
const resolveHeaders = async (headers, direction) => {
  const resolved = await Promise.all(
    Object.entries(headers).map(async ([name, header]) => {
      if ("$ref" in header || typeof header.schema !== "object" || header.schema === null || !("toOpenAPISchema" in header.schema)) {
        return { components: void 0, entry: [name, header] };
      }
      const result = await header.schema.toOpenAPISchema(void 0, direction);
      liftSchemaDefs(result);
      return {
        components: result.components,
        entry: [name, { ...header, schema: result.schema }]
      };
    })
  );
  return {
    components: mergeComponentsObjects(
      {},
      ...resolved.map(({ components }) => components)
    ),
    headers: Object.fromEntries(resolved.map(({ entry }) => entry))
  };
};
const resolveEncoding = async (encoding, direction) => {
  const resolved = await Promise.all(
    Object.entries(encoding).map(async ([property, entry]) => {
      if (!entry.headers) {
        return { components: void 0, entry: [property, entry] };
      }
      const { components, headers } = await resolveHeaders(
        entry.headers,
        direction
      );
      return { components, entry: [property, { ...entry, headers }] };
    })
  );
  return {
    components: mergeComponentsObjects(
      {},
      ...resolved.map(({ components }) => components)
    ),
    encoding: Object.fromEntries(
      resolved.map(({ entry }) => entry)
    )
  };
};
async function resolveContentSchemas(content, direction) {
  let components = {};
  const resolvedContent = {};
  for (const [contentKey, raw] of Object.entries(content)) {
    if (!raw) continue;
    const encoding = raw.encoding ? await resolveEncoding(raw.encoding, direction) : void 0;
    const media = encoding ? { ...raw, encoding: encoding.encoding } : raw;
    if (encoding) {
      components = mergeComponentsObjects(components, encoding.components);
    }
    if (media.schema != null && typeof media.schema === "object" && "toOpenAPISchema" in media.schema) {
      const result = await media.schema.toOpenAPISchema(void 0, direction);
      liftSchemaDefs(result);
      resolvedContent[contentKey] = {
        ...media,
        schema: result.schema
      };
      if (result.components) {
        components = mergeComponentsObjects(components, result.components);
      }
    } else {
      resolvedContent[contentKey] = media;
    }
  }
  return { content: resolvedContent, components };
}
async function resolveResponseSchemas(responses) {
  let components = {};
  const resolvedResponses = {};
  for (const [key, response] of Object.entries(responses)) {
    if (!response || "$ref" in response || !response.content && !response.headers) {
      resolvedResponses[key] = response;
      continue;
    }
    const content = response.content ? await resolveContentSchemas(response.content, "output") : void 0;
    const headers = response.headers ? await resolveHeaders(response.headers, "output") : void 0;
    resolvedResponses[key] = {
      ...response,
      ...content && { content: content.content },
      ...headers && { headers: headers.headers }
    };
    components = mergeComponentsObjects(
      components,
      content?.components,
      headers?.components
    );
  }
  return markAsOutput(resolvedResponses, components);
}
function liftSchemaDefs(result) {
  const defs = result.schema.$defs;
  if (!defs || typeof defs !== "object") return;
  result.components ??= {};
  result.components.schemas = {
    ...defs,
    ...result.components.schemas
  };
  delete result.schema.$defs;
}
function mergeComponentsObjects(...components) {
  return components.reduce(
    (prev, component, index) => {
      if (component == null || index === 0) return prev;
      if (prev.schemas && Object.keys(prev.schemas).length > 0 || component.schemas && Object.keys(component.schemas).length > 0) {
        prev.schemas = {
          ...prev.schemas,
          ...component.schemas
        };
      }
      if (prev.parameters && Object.keys(prev.parameters).length > 0 || component.parameters && Object.keys(component.parameters).length > 0) {
        prev.parameters = {
          ...prev.parameters,
          ...component.parameters
        };
      }
      return prev;
    },
    components[0] ?? {}
  );
}
const OUTPUT_MARK = "\0output";
const isOutput = (name) => name.endsWith(OUTPUT_MARK);
const inputName = (output) => output.slice(0, -OUTPUT_MARK.length);
const markAsOutput = (responses, components) => {
  const schemas = components.schemas ?? {};
  const mark = (name) => Object.hasOwn(schemas, name) ? `${name}${OUTPUT_MARK}` : void 0;
  return {
    responses: renameSchemaRefs(responses, mark, true),
    components: {
      ...components,
      ...components.schemas && {
        schemas: Object.fromEntries(
          Object.entries(schemas).map(([name, schema]) => [
            `${name}${OUTPUT_MARK}`,
            renameSchemaRefs(schema, mark)
          ])
        )
      }
    }
  };
};
const withOutputRefs = (documentation, ctx) => [
  documentation,
  componentRefs(documentation).filter((ref) => ref.startsWith("schemas/")).map((ref) => decodeName(ref.slice("schemas/".length))).filter(
    (name) => !Object.hasOwn(ctx.components.schemas ?? {}, name) && Object.hasOwn(ctx.components.schemas ?? {}, `${name}${OUTPUT_MARK}`)
  ).map((name) => ({
    $ref: `${SCHEMA_REF}${encodeName(`${name}${OUTPUT_MARK}`)}`
  }))
];
const canonical = (value) => JSON.stringify(
  value,
  (_key, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(
    Object.entries(item).toSorted(([a], [b]) => a.localeCompare(b))
  ) : item
);
const freeName = (name, used) => {
  let candidate = name;
  for (let suffix = 2; used.has(candidate); suffix++) {
    candidate = `${name}${suffix}`;
  }
  return candidate;
};
const assignOutputNames = (outputs, taken) => {
  const used = new Set(taken);
  const names = /* @__PURE__ */ new Map();
  for (const output of outputs) {
    const name = freeName(`${inputName(output)}Output`, used);
    used.add(name);
    names.set(output, name);
  }
  return names;
};
const splitOutputComponents = (components, paths) => {
  const { schemas = {}, ...otherComponents } = components;
  const outputs = Object.keys(schemas).filter(isOutput);
  if (outputs.length === 0) {
    return { components, paths };
  }
  const asInput = (name) => isOutput(name) ? inputName(name) : void 0;
  const shared = new Set(
    outputs.filter((output) => Object.hasOwn(schemas, inputName(output)))
  );
  const outputRefs = new Map(
    [...shared].map(
      (output) => [
        output,
        componentRefs(schemas[output]).filter((ref) => ref.startsWith("schemas/")).map((ref) => decodeName(ref.slice("schemas/".length)))
      ]
    )
  );
  const refersTo = (output, split2) => outputRefs.get(output)?.some((name) => split2.has(name));
  const split = new Set(
    [...shared].filter(
      (output) => canonical(renameSchemaRefs(schemas[output], asInput)) !== canonical(schemas[inputName(output)])
    )
  );
  let previousSize;
  do {
    previousSize = split.size;
    for (const output of shared) {
      if (!split.has(output) && refersTo(output, split)) {
        split.add(output);
      }
    }
  } while (split.size !== previousSize);
  const taken = [
    ...Object.keys(schemas).filter((name) => !isOutput(name)),
    ...outputs.filter((output) => !shared.has(output)).map(inputName)
  ];
  const outputNames = assignOutputNames([...split].toSorted(), taken);
  const rename = (name) => isOutput(name) ? outputNames.get(name) ?? inputName(name) : void 0;
  return {
    components: {
      ...renameSchemaRefs(otherComponents, rename),
      schemas: Object.fromEntries(
        Object.entries(schemas).flatMap(([name, schema]) => {
          const renamed = renameSchemaRefs(schema, rename);
          if (!isOutput(name)) {
            return [[name, renamed]];
          }
          const output = outputNames.get(name);
          if (output) {
            return [[output, renamed]];
          }
          return Object.hasOwn(schemas, inputName(name)) ? [] : [[inputName(name), renamed]];
        })
      )
    },
    paths: renameSchemaRefs(paths, rename, true)
  };
};

function loadVendor(vendor, fn) {
  if (fn.toJSONSchema) {
    loadVendor$1(vendor, fn.toJSONSchema);
  }
  if (fn.toOpenAPISchema) {
    loadVendor$2(vendor, fn.toOpenAPISchema);
  }
}
const arktypeMorphFallback = (ctx) => ctx.base;
const zodV4DateOverride = (ctx) => {
  if (ctx.zodSchema._zod.def.type === "date") {
    ctx.jsonSchema.type = "string";
    ctx.jsonSchema.format = "date-time";
  }
};
function resolver(schema, userDefinedOptions) {
  const vendor = schema["~standard"].vendor;
  return {
    vendor,
    validate: schema["~standard"].validate,
    toJSONSchema: (customOptions) => toJsonSchema(schema, { ...userDefinedOptions, ...customOptions }),
    toOpenAPISchema: (customOptions, direction) => {
      const context = {
        ...userDefinedOptions,
        ...customOptions,
        ...vendor === "arktype" ? injectArktypeFallback(userDefinedOptions, customOptions) : void 0,
        ...vendor === "zod" ? injectZodV4DateOverride(schema, userDefinedOptions, customOptions) : void 0
      };
      const directionOptions = direction === "output" ? outputOptions(schema) : void 0;
      return toOpenAPISchema(
        schema,
        directionOptions ? {
          ...context,
          // Options the caller passed win over this default
          options: {
            ...directionOptions,
            ...context.options
          }
        } : context
      );
    }
  };
}
const outputOptions = (schema) => {
  switch (schema["~standard"].vendor) {
    case "zod":
      return "_zod" in schema ? { io: "output" } : { schemaType: "output" };
    case "valibot":
      return { typeMode: "output" };
    default:
      return void 0;
  }
};
function injectArktypeFallback(userDefined, custom) {
  const userNested = userDefined?.options;
  const customNested = custom?.options;
  if (userDefined?.fallback || userNested?.fallback || custom?.fallback || customNested?.fallback) {
    return void 0;
  }
  return {
    options: {
      fallback: arktypeMorphFallback,
      ...userNested,
      ...customNested
    }
  };
}
function injectZodV4DateOverride(schema, userDefined, custom) {
  if (!("_zod" in schema)) return void 0;
  const userNested = userDefined?.options;
  const customNested = custom?.options;
  if (userDefined?.override || userNested?.override || custom?.override || customNested?.override) {
    return void 0;
  }
  return {
    options: {
      unrepresentable: "any",
      override: zodV4DateOverride,
      ...userNested,
      ...customNested
    }
  };
}
function validator(target, schema, hook, options) {
  const middleware = sValidator(target, schema, hook);
  Object.defineProperty(middleware, "name", {
    value: "validator",
    configurable: true
  });
  return Object.assign(middleware, {
    [uniqueSymbol]: {
      target,
      ...resolver(schema, options),
      options
    }
  });
}
function describeRoute(spec) {
  const middleware = async (_c, next) => {
    await next();
  };
  Object.defineProperty(middleware, "name", {
    value: "describeRoute",
    configurable: true
  });
  return Object.assign(middleware, {
    [uniqueSymbol]: {
      spec
    }
  });
}
function describeResponse(handler, responses, options) {
  const _responses = Object.entries(responses).reduce(
    (acc, [statusCode, response]) => {
      if (response.content) {
        const content = Object.entries(response.content).reduce(
          (contentAcc, [mediaType, media]) => {
            if (media.vSchema) {
              const { vSchema, ...rest } = media;
              contentAcc[mediaType] = {
                ...rest,
                schema: resolver(vSchema, options)
              };
            } else {
              contentAcc[mediaType] = media;
            }
            return contentAcc;
          },
          {}
        );
        acc[statusCode] = { ...response, content };
      } else {
        acc[statusCode] = response;
      }
      return acc;
    },
    {}
  );
  return Object.assign(handler, {
    [uniqueSymbol]: {
      spec: { responses: _responses }
    }
  });
}

export { ALLOWED_METHODS, VALIDATION_MARKER, clearSpecsContext, describeResponse, describeRoute, documentedComponents, generateSpecs, getSpecComponents, loadVendor, openAPIRouteHandler, registerSchemaPath, removeExcludedPaths, resolver, setSpecComponents, uniqueSymbol, validator };
