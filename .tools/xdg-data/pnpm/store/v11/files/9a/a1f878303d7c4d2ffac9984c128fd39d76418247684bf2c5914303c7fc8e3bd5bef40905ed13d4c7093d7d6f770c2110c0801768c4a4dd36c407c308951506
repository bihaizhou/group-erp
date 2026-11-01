'use strict';

var standardJson = require('@standard-community/standard-json');
var vendors_convert = require('./vendors/convert.cjs');

function getToOpenAPISchemaFn() {
  return async (schema, context) => vendors_convert.convertToOpenAPISchema(
    await standardJson.toJsonSchema(schema, context.options),
    context
  );
}

exports.default = getToOpenAPISchemaFn;
