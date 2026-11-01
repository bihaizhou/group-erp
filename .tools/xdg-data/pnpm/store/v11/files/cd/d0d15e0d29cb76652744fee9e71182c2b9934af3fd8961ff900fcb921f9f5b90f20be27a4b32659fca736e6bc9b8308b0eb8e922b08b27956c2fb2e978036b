'use strict';

const errorMessageWrapper = (message) => `standard-openapi: ${message}`;
const openapiVendorMap = /* @__PURE__ */ new Map();

const getToOpenAPISchemaFn = async (vendor) => {
  const cached = openapiVendorMap.get(vendor);
  if (cached) {
    return cached;
  }
  let vendorFn;
  switch (vendor) {
    case "valibot":
      vendorFn = (await Promise.resolve().then(function () { return require('./valibot-CNm53x33.cjs'); })).default();
      break;
    case "zod":
      vendorFn = (await Promise.resolve().then(function () { return require('./zod-CGmtQIIB.cjs'); })).default();
      break;
    default:
      vendorFn = (await Promise.resolve().then(function () { return require('./default-DNjsfw3o.cjs'); })).default();
  }
  openapiVendorMap.set(vendor, vendorFn);
  return vendorFn;
};

const toOpenAPISchema = async (schema, context = {}) => {
  const fn = await getToOpenAPISchemaFn(schema["~standard"].vendor);
  const { components = {}, options } = context;
  const _schema = await fn(schema, { components, options });
  return {
    schema: _schema,
    components: Object.keys(components).length > 0 ? components : void 0
  };
};
function loadVendor(vendor, fn) {
  openapiVendorMap.set(vendor, fn);
}

exports.errorMessageWrapper = errorMessageWrapper;
exports.loadVendor = loadVendor;
exports.toOpenAPISchema = toOpenAPISchema;
