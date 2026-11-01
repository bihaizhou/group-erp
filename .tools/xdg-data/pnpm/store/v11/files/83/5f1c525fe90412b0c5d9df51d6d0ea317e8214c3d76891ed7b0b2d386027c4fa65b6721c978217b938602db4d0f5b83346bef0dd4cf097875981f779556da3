import * as openapi_types from 'openapi-types';
import { StandardSchemaV1 } from '@standard-schema/spec';
import { T as ToOpenAPISchemaFn, a as ToOpenAPISchemaContext } from './utils-6SPsNbjx.cjs';

/**
 * Converts a Standard Schema to a OpenAPI schema.
 */
declare const toOpenAPISchema: (schema: StandardSchemaV1, context?: Partial<ToOpenAPISchemaContext>) => Promise<{
    schema: openapi_types.OpenAPIV3_1.SchemaObject;
    components: openapi_types.OpenAPIV3_1.ComponentsObject | undefined;
}>;
/**
 * Load vendor before calling toOpenAPISchema,
 * for imporving performance and adding support for unsupported vendors
 */
declare function loadVendor(vendor: string, fn: ToOpenAPISchemaFn): void;

export { ToOpenAPISchemaContext, ToOpenAPISchemaFn, loadVendor, toOpenAPISchema };
