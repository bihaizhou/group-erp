'use strict';

var _default = require('./default-DNjsfw3o.cjs');
var index = require('./index-C_MuiE7X.cjs');
require('@standard-community/standard-json');
require('./vendors/convert.cjs');

function getToOpenAPISchemaFn() {
  return async (schema, context) => {
    if ("_zod" in schema) {
      return _default.default()(schema, {
        components: context.components,
        options: { io: "input", ...context.options }
      });
    }
    const { createSchema } = await import('zod-openapi').catch(() => {
      throw new Error(
        index.errorMessageWrapper(`Missing dependencies "zod-openapi v4".`)
      );
    });
    const { schema: _schema, components } = createSchema(
      // @ts-expect-error
      schema,
      { schemaType: "input", ...context.options }
    );
    if (components) {
      context.components.schemas = {
        ...context.components.schemas,
        ...components
      };
    }
    return _schema;
  };
}

exports.default = getToOpenAPISchemaFn;
