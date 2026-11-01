import getToOpenAPISchemaFn$1 from './default-u_dwuiYb.js';
import { e as errorMessageWrapper } from './index-CKGGDjCx.js';
import '@standard-community/standard-json';
import './vendors/convert.js';

function getToOpenAPISchemaFn() {
  return async (schema, context) => {
    if ("_zod" in schema) {
      return getToOpenAPISchemaFn$1()(schema, {
        components: context.components,
        options: { io: "input", ...context.options }
      });
    }
    const { createSchema } = await import('zod-openapi').catch(() => {
      throw new Error(
        errorMessageWrapper(`Missing dependencies "zod-openapi v4".`)
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

export { getToOpenAPISchemaFn as default };
