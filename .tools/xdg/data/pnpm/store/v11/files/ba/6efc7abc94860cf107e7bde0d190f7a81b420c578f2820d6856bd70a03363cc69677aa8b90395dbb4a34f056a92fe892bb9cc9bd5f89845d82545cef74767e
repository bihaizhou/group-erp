import * as openapi_types from 'openapi-types';
import { OpenAPIV3_1 } from 'openapi-types';
import * as hono from 'hono';
import { Env, Input, Context, Next, MiddlewareHandler, ValidationTargets, Hono } from 'hono';
import { TypedResponse, RouterRoute, ValidationTargets as ValidationTargets$1, BlankEnv, Input as Input$1, BlankInput, Schema, BlankSchema, MiddlewareHandler as MiddlewareHandler$1 } from 'hono/types';
import { loadVendor as loadVendor$2, ToOpenAPISchemaContext } from '@standard-community/standard-openapi';
import { Hook } from '@hono/standard-validator';
import { loadVendor as loadVendor$1 } from '@standard-community/standard-json';
import { StandardSchemaV1 } from '@standard-schema/spec';
import { StatusCode } from 'hono/utils/http-status';
import { JSONParsed } from 'hono/utils/types';
import { InferInput } from 'hono/validator';
import { JSONSchema7 } from 'json-schema';

declare function loadVendor(vendor: string, fn: {
    toJSONSchema?: Parameters<typeof loadVendor$1>[1];
    toOpenAPISchema?: Parameters<typeof loadVendor$2>[1];
}): void;
/**
 * Generate a resolver for a validation schema
 * @param schema Validation schema
 * @returns Resolver result
 */
declare function resolver<Schema extends StandardSchemaV1>(schema: Schema, userDefinedOptions?: Record<string, unknown>): {
    vendor: string;
    validate: (value: unknown) => StandardSchemaV1.Result<unknown> | Promise<StandardSchemaV1.Result<unknown>>;
    toJSONSchema: (customOptions?: Record<string, unknown>) => JSONSchema7 | Promise<JSONSchema7>;
    toOpenAPISchema: (customOptions?: Record<string, unknown>, direction?: SchemaDirection) => Promise<{
        schema: OpenAPIV3_1.SchemaObject;
        components: OpenAPIV3_1.ComponentsObject | undefined;
    }>;
};
type HasUndefined<T> = undefined extends T ? true : false;
/**
 * Create a validator middleware
 * @param target Target for validation
 * @param schema Validation schema
 * @param hook Hook for validation
 * @returns Middleware handler
 */
declare function validator<Schema extends StandardSchemaV1, Target extends keyof ValidationTargets, E extends Env, P extends string, In = StandardSchemaV1.InferInput<Schema>, Out = StandardSchemaV1.InferOutput<Schema>, I extends Input = {
    in: HasUndefined<In> extends true ? {
        [K in Target]?: [In] extends [ValidationTargets[K]] ? In : InferInput<In, K>;
    } : {
        [K in Target]: [In] extends [ValidationTargets[K]] ? In : InferInput<In, K>;
    };
    out: {
        [K in Target]: Out;
    };
}, V extends I = I>(target: Target, schema: Schema, hook?: Hook<StandardSchemaV1.InferOutput<Schema>, E, P, Target>, options?: ResolverReturnType["options"]): MiddlewareHandler<E, P, V>;
/**
 * Describe a route with OpenAPI specs.
 * @param spec Options for describing a route
 * @returns Middleware handler
 */
declare function describeRoute(spec: DescribeRouteOptions): MiddlewareHandler;
type ResponseObject<T extends Partial<Record<StatusCode, StandardSchemaV1>>> = {
    [K in keyof T]: OpenAPIV3_1.ReferenceObject | (OpenAPIV3_1.ResponseObject & {
        content?: {
            [media: string]: OpenAPIV3_1.MediaTypeObject & {
                vSchema?: T[K];
            };
        };
    });
};
type Num<T> = T extends `${infer N extends number}` ? N : T;
type HandlerResponse<T extends Partial<Record<StatusCode, StandardSchemaV1>> = Partial<Record<StatusCode, StandardSchemaV1>>> = PromiseOr<{
    [K in keyof T]: T[K] extends StandardSchemaV1 ? TypedResponse<JSONParsed<StandardSchemaV1.InferOutput<T[K]>>, Num<K> extends StatusCode ? Num<K> : never> : never;
}[keyof T]>;
type Handler<E extends Env, P extends string, I extends Input, T extends Partial<Record<StatusCode, StandardSchemaV1>> = Partial<Record<StatusCode, StandardSchemaV1>>> = (c: Context<E, P, I>, next: Next) => HandlerResponse<T>;
declare function describeResponse<E extends Env, P extends string, I extends Input, T extends Partial<Record<StatusCode, StandardSchemaV1>> = Partial<Record<StatusCode, StandardSchemaV1>>>(handler: Handler<E, P, I, T>, responses: ResponseObject<T>, options?: Record<string, unknown>): Handler<E, P, I, T>;

/**
 * The unique symbol for the middlewares, which makes it easier to identify them. Not meant to be used directly, unless you're creating a custom middleware.
 */
declare const uniqueSymbol: unique symbol;
/**
 * Internal marker key set on an operation's spec when it is produced by a
 * `validator()` middleware. It is used to decide whether to auto-inject the
 * default 400 validation error response, and is stripped from the operation
 * before the spec is emitted. Must be an enumerable string key so it survives
 * the `Object.entries`-based merge in `mergeSpecs`.
 */
declare const VALIDATION_MARKER = "__HonoOpenAPIValidator__";
declare const ALLOWED_METHODS: readonly ["GET", "PUT", "POST", "DELETE", "OPTIONS", "HEAD", "PATCH", "TRACE"];
type AllowedMethods = (typeof ALLOWED_METHODS)[number];
declare const setSpecComponents: (spec: object, components: OpenAPIV3_1.ComponentsObject[]) => WeakMap<object, OpenAPIV3_1.ComponentsObject[]>;
declare const getSpecComponents: (spec: unknown) => OpenAPIV3_1.ComponentsObject[];
declare function clearSpecsContext(): void;
declare function registerSchemaPath({ route, specs, paths }: RegisterSchemaPathOptions, pathContext?: Map<string, Omit<OpenAPIV3_1.OperationObject<{}>, "responses" | "operationId" | "requestBody"> & {
    operationId?: string | ((route: RouterRoute) => string);
    requestBody?: OpenAPIV3_1.ReferenceObject | (Omit<OpenAPIV3_1.RequestBodyObject, "content"> & {
        content: ContentWithResolver;
    });
    hide?: boolean | ((props: {
        c?: hono.Context;
        method: string;
        path: string;
    }) => boolean);
    responses?: ResponsesWithResolver;
} & {
    operationId?: string | ((route: RouterRoute) => string);
}>): void;
declare function removeExcludedPaths(paths: OpenAPIV3_1.PathsObject, ctx: SpecContext): OpenAPIV3_1.PathsObject<{}, {}>;
/**
 * Keeps the generated components that the documented operations brought in,
 * and the ones those operations or `documentation` refer to, directly or
 * through other components. An operation can refer to a component it didn't
 * bring in itself, such as a `$ref` written by hand in `describeRoute`.
 *
 * Components are collected from every route while the paths are generated,
 * including routes that are hidden or excluded afterwards. Without this, those
 * routes would still publish the schemas only they use.
 */
declare function documentedComponents(components: OpenAPIV3_1.ComponentsObject, paths: OpenAPIV3_1.PathsObject, documentation: unknown): OpenAPIV3_1.ComponentsObject;

type PromiseOr<T> = T | Promise<T>;
/**
 * Whether a schema describes what a route accepts (`input`) or what it
 * sends (`output`). They differ for schemas with defaults or transforms.
 */
type SchemaDirection = "input" | "output";
type ResolverReturnType = ReturnType<typeof resolver> & {
    options?: {
        /**
         * Override the media type of the request body, if not specified, it will be `application/json` for `json` target and `multipart/form-data` for `form` target.
         */
        media?: string;
    } & Partial<ToOpenAPISchemaContext>;
};
type HandlerUniqueProperty = (ResolverReturnType & {
    target: keyof ValidationTargets$1;
}) | {
    spec: DescribeRouteOptions;
};
/**
 * A header object that accepts resolver() output in its schema.
 */
type HeaderObjectWithResolver = Omit<OpenAPIV3_1.HeaderObject, "schema"> & {
    schema?: OpenAPIV3_1.ReferenceObject | OpenAPIV3_1.SchemaObject | ResolverReturnType;
};
/**
 * A headers map that accepts resolver() output in its headers' schemas.
 */
type HeadersWithResolver = {
    [header: string]: HeaderObjectWithResolver | OpenAPIV3_1.ReferenceObject;
};
/**
 * An encoding object whose headers accept resolver() output in their schemas.
 */
type EncodingObjectWithResolver = Omit<OpenAPIV3_1.EncodingObject, "headers"> & {
    headers?: HeadersWithResolver;
};
/**
 * A media type object that accepts resolver() output in addition to standard schema types,
 * in its schema and in its encoding's headers.
 */
type MediaTypeObjectWithResolver = Omit<OpenAPIV3_1.MediaTypeObject, "encoding" | "schema"> & {
    encoding?: {
        [property: string]: EncodingObjectWithResolver;
    };
    schema?: OpenAPIV3_1.ReferenceObject | OpenAPIV3_1.SchemaObject | ResolverReturnType;
};
type ContentWithResolver = {
    [media: string]: MediaTypeObjectWithResolver;
};
/**
 * A response object that accepts resolver() output in schema positions.
 */
type ResponseObjectWithResolver = (Omit<OpenAPIV3_1.ResponseObject, "content" | "headers"> & {
    content?: ContentWithResolver;
    headers?: HeadersWithResolver;
}) | OpenAPIV3_1.ReferenceObject;
type RequestBodyObjectWithResolver = (Omit<OpenAPIV3_1.RequestBodyObject, "content"> & {
    content: ContentWithResolver;
}) | OpenAPIV3_1.ReferenceObject;
/**
 * A responses map that accepts resolver() output in schema positions.
 */
type ResponsesWithResolver = {
    [key: string]: ResponseObjectWithResolver;
};
/**
 * Extended document type that allows resolver() in documentation.components.responses
 */
type DocumentWithResolver = Omit<Partial<OpenAPIV3_1.Document>, "x-express-openapi-additional-middleware" | "x-express-openapi-validation-strict" | "components"> & {
    components?: Omit<OpenAPIV3_1.ComponentsObject, "responses"> & {
        responses?: ResponsesWithResolver;
    };
};
type GenerateSpecOptions = {
    /**
     * Customize OpenAPI config, refers to Swagger 2.0 config
     *
     * @see https://swagger.io/specification/v2/
     */
    documentation: DocumentWithResolver;
    /**
     * Include paths which don't have the handlers.
     * This is useful when you want to document the
     * API without implementing it or index all the paths.
     */
    includeEmptyPaths: boolean;
    /**
     * Determine if Swagger should exclude static files (by checking if the last path segment contains a period).
     *
     * @default true
     */
    excludeStaticFile: boolean;
    /**
     * Paths to exclude from OpenAPI endpoint
     *
     * @default []
     */
    exclude: string | RegExp | Array<string | RegExp>;
    /**
     * Exclude methods from the specs
     */
    excludeMethods: AllowedMethods[];
    /**
     * Exclude tags from OpenAPI
     */
    excludeTags: string[];
    /**
     * Default options for `describeRoute` method
     */
    defaultOptions: Partial<Record<AllowedMethods | "ALL", DescribeRouteOptions>>;
    /**
     * Automatically include a 400 validation error response for routes
     * that use `validator()`. Set to `false` to disable, `true` to use
     * the built-in schema, or provide a custom `ResponseObject`.
     *
     * @default true
     */
    defaultValidationErrorResponse: boolean | OpenAPIV3_1.ResponseObject;
};
type OperationId = string | ((route: RouterRoute) => string);
type DescribeRouteOptions = Omit<OpenAPIV3_1.OperationObject, "requestBody" | "responses" | "operationId"> & {
    operationId?: OperationId;
    /**
     * Request body metadata. `resolver()` values are converted to OpenAPI
     * schemas while generating the document.
     */
    requestBody?: RequestBodyObjectWithResolver;
    /**
     * Pass `true` to hide route from OpenAPI/swagger document
     */
    hide?: boolean | ((props: {
        c?: Context;
        method: string;
        path: string;
    }) => boolean);
    /**
     * Responses of the request
     */
    responses?: ResponsesWithResolver;
};
type RegisterSchemaPathOptions = {
    route: RouterRoute;
    specs?: DescribeRouteOptions & {
        operationId?: OperationId;
    };
    paths: Partial<OpenAPIV3_1.PathsObject>;
};
type HaveDefaultValues = "documentation" | "excludeStaticFile" | "exclude" | "excludeMethods" | "excludeTags" | "defaultValidationErrorResponse";
type SanitizedGenerateSpecOptions = Pick<GenerateSpecOptions, HaveDefaultValues> & Omit<Partial<GenerateSpecOptions>, HaveDefaultValues>;
type SpecContext = {
    components: OpenAPIV3_1.ComponentsObject;
    options: SanitizedGenerateSpecOptions;
    validationErrorResponse?: OpenAPIV3_1.ResponseObject;
};

/**
 * Route handler for OpenAPI specs
 * @param hono Instance of Hono
 * @param options Options for generating OpenAPI specs
 * @returns Middleware handler for OpenAPI specs
 */
declare function openAPIRouteHandler<E extends Env = BlankEnv, P extends string = string, I extends Input$1 = BlankInput, S extends Schema = BlankSchema>(hono: Hono<E, S, P>, options?: Partial<GenerateSpecOptions>): MiddlewareHandler$1<E, P, I>;
/**
 * Generate OpenAPI specs for the given Hono instance
 * @param hono Instance of Hono
 * @param options Options for generating OpenAPI specs
 * @param config Configuration for OpenAPI route handler
 * @param Context Route context for hiding routes
 * @returns OpenAPI specs
 */
declare function generateSpecs<E extends Env = BlankEnv, P extends string = string, I extends Input$1 = BlankInput, S extends Schema = BlankSchema>(hono: Hono<E, S, P>, options?: Partial<GenerateSpecOptions>, c?: Context<E, P, I>): Promise<{
    tags: openapi_types.OpenAPIV3.TagObject[];
    info: {
        description: string;
        title: string;
        termsOfService?: string;
        contact?: openapi_types.OpenAPIV3.ContactObject;
        version: string;
        summary?: string;
        license?: OpenAPIV3_1.LicenseObject;
    };
    paths: {
        [x: string]: Omit<openapi_types.OpenAPIV3.PathItemObject<{}>, "parameters" | "servers"> & {
            servers?: OpenAPIV3_1.ServerObject[];
            parameters?: (OpenAPIV3_1.ReferenceObject | OpenAPIV3_1.ParameterObject)[];
        } & {
            get?: OpenAPIV3_1.OperationObject<{}>;
            put?: OpenAPIV3_1.OperationObject<{}>;
            post?: OpenAPIV3_1.OperationObject<{}>;
            delete?: OpenAPIV3_1.OperationObject<{}>;
            options?: OpenAPIV3_1.OperationObject<{}>;
            head?: OpenAPIV3_1.OperationObject<{}>;
            patch?: OpenAPIV3_1.OperationObject<{}>;
            trace?: OpenAPIV3_1.OperationObject<{}>;
        };
    };
    components: OpenAPIV3_1.ComponentsObject;
    webhooks?: Record<string, OpenAPIV3_1.PathItemObject | OpenAPIV3_1.ReferenceObject>;
    externalDocs?: openapi_types.OpenAPIV3.ExternalDocumentationObject;
    security?: openapi_types.OpenAPIV3.SecurityRequirementObject[];
    servers?: OpenAPIV3_1.ServerObject[];
    openapi: string;
    jsonSchemaDialect?: string;
}>;

export { ALLOWED_METHODS, type AllowedMethods, type ContentWithResolver, type DescribeRouteOptions, type GenerateSpecOptions, type HandlerUniqueProperty, type HeadersWithResolver, type PromiseOr, type RegisterSchemaPathOptions, type ResolverReturnType, type ResponsesWithResolver, type SchemaDirection, type SpecContext, VALIDATION_MARKER, clearSpecsContext, describeResponse, describeRoute, documentedComponents, generateSpecs, getSpecComponents, loadVendor, openAPIRouteHandler, registerSchemaPath, removeExcludedPaths, resolver, setSpecComponents, uniqueSymbol, validator };
