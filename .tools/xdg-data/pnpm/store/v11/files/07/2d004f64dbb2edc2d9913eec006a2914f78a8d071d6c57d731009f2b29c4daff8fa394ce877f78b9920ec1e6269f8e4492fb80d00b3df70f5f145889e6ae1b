import { n as API_KEY_ERROR_CODES, t as PACKAGE_VERSION } from "./version-DPvml-_8.mjs";
import { createAuthEndpoint, createAuthMiddleware } from "@better-auth/core/api";
import { getIP } from "@better-auth/core/utils/ip";
import { base64Url } from "@better-auth/utils/base64";
import { createHash } from "@better-auth/utils/hash";
import { BetterAuthError } from "better-auth";
import { APIError, getSessionFromCtx, sessionMiddleware } from "better-auth/api";
import { generateRandomString } from "better-auth/crypto";
import { mergeSchema } from "better-auth/db";
import { APIError as APIError$1 } from "@better-auth/core/error";
import { generateId } from "@better-auth/core/utils/id";
import { safeJSONParse } from "@better-auth/core/utils/json";
import * as z from "zod";
import { mapConcurrent } from "@better-auth/core/utils/async";
import { role } from "better-auth/plugins/access";
import { parseJSON } from "better-auth/client";
//#region src/adapter.ts
const STORAGE_CONCURRENCY = 10;
/**
* Parses double-stringified metadata synchronously without updating the database.
* Use this for reading metadata, then call migrateLegacyMetadataInBackground for DB updates.
*
* @returns The properly parsed metadata object, or the original if already an object
*/
function parseDoubleStringifiedMetadata(metadata) {
	if (metadata == null) return null;
	if (typeof metadata === "object") return metadata;
	return safeJSONParse(metadata);
}
/**
* Checks if metadata needs migration (is a string instead of object)
*/
function needsMetadataMigration(metadata) {
	return metadata != null && typeof metadata === "string";
}
/**
* Batch migrates double-stringified metadata for multiple API keys.
* Runs all updates in parallel to avoid N sequential database calls.
*/
async function batchMigrateLegacyMetadata(ctx, apiKeys, opts) {
	if (opts.storage !== "database" && !opts.fallbackToDatabase) return;
	const keysToMigrate = apiKeys.filter((key) => needsMetadataMigration(key.metadata));
	if (keysToMigrate.length === 0) return;
	const migrationPromises = keysToMigrate.map(async (apiKey) => {
		const parsed = parseDoubleStringifiedMetadata(apiKey.metadata);
		try {
			await ctx.context.adapter.update({
				model: "apikey",
				where: [{
					field: "id",
					value: apiKey.id
				}],
				update: { metadata: parsed }
			});
		} catch (error) {
			ctx.context.logger.warn(`Failed to migrate double-stringified metadata for API key ${apiKey.id}:`, error);
		}
	});
	await Promise.all(migrationPromises);
}
/**
* Migrates double-stringified metadata to properly parsed object.
*
* This handles legacy data where metadata was incorrectly double-stringified.
* If metadata is a string (should be object after adapter's transform.output),
* it parses it and optionally updates the database.
*
* @returns The properly parsed metadata object
*/
async function migrateDoubleStringifiedMetadata(ctx, apiKey, opts) {
	const parsed = parseDoubleStringifiedMetadata(apiKey.metadata);
	if (needsMetadataMigration(apiKey.metadata) && (opts.storage === "database" || opts.fallbackToDatabase)) try {
		await ctx.context.adapter.update({
			model: "apikey",
			where: [{
				field: "id",
				value: apiKey.id
			}],
			update: { metadata: parsed }
		});
	} catch (error) {
		ctx.context.logger.warn(`Failed to migrate double-stringified metadata for API key ${apiKey.id}:`, error);
	}
	return parsed;
}
/**
* Generate storage key for API key by hashed key
*/
function getStorageKeyByHashedKey(hashedKey) {
	return `api-key:${hashedKey}`;
}
/**
* Generate storage key for API key by ID
*/
function getStorageKeyById(id) {
	return `api-key:by-id:${id}`;
}
/**
* Generate storage key for reference's API key list (user or org)
*/
function getStorageKeyByReferenceId(referenceId) {
	return `api-key:by-ref:${referenceId}`;
}
/**
* Serialize API key for storage
*/
function serializeApiKey(apiKey) {
	return JSON.stringify({
		...apiKey,
		createdAt: apiKey.createdAt.toISOString(),
		updatedAt: apiKey.updatedAt.toISOString(),
		expiresAt: apiKey.expiresAt?.toISOString() ?? null,
		lastRefillAt: apiKey.lastRefillAt?.toISOString() ?? null,
		lastRequest: apiKey.lastRequest?.toISOString() ?? null
	});
}
/**
* Deserialize API key from storage
*/
function deserializeApiKey(data) {
	if (!data || typeof data !== "string") return null;
	try {
		const parsed = JSON.parse(data);
		return {
			...parsed,
			createdAt: new Date(parsed.createdAt),
			updatedAt: new Date(parsed.updatedAt),
			expiresAt: parsed.expiresAt ? new Date(parsed.expiresAt) : null,
			lastRefillAt: parsed.lastRefillAt ? new Date(parsed.lastRefillAt) : null,
			lastRequest: parsed.lastRequest ? new Date(parsed.lastRequest) : null
		};
	} catch {
		return null;
	}
}
/**
* Get the storage instance to use (custom methods take precedence)
*/
function getStorageInstance(ctx, opts) {
	if (opts.customStorage) return opts.customStorage;
	return ctx.context.secondaryStorage || null;
}
/**
* Calculate TTL in seconds for an API key
*/
function calculateTTL(apiKey) {
	if (apiKey.expiresAt) {
		const now = Date.now();
		const expiresAt = new Date(apiKey.expiresAt).getTime();
		const ttlSeconds = Math.floor((expiresAt - now) / 1e3);
		if (ttlSeconds > 0) return ttlSeconds;
	}
}
/**
* Get API key from secondary storage by hashed key
*/
async function getApiKeyFromStorage(ctx, hashedKey, storage) {
	const key = getStorageKeyByHashedKey(hashedKey);
	return deserializeApiKey(await storage.get(key));
}
/**
* Get API key from secondary storage by ID
*/
async function getApiKeyByIdFromStorage(ctx, id, storage) {
	const key = getStorageKeyById(id);
	return deserializeApiKey(await storage.get(key));
}
/**
* Serializes reference-list mutations per `refKey` within a single process.
* Each new mutation chains onto the previous one for the same key, so the
* read/modify/write below never interleaves with another mutation of the same
* list. This closes the lost-update race in secondary-storage-only mode, where
* the serialized list is the source of truth for listing.
*
* Limitation: the lock is in-process only. Across multiple server instances
* sharing one secondary storage, concurrent writers can still lose updates.
* Secondary storage with `fallbackToDatabase` avoids this by treating the list
* as an invalidate-only cache with the database as the source of truth.
* FIXME(api-key-reflist-durable): on `next`, drop the source-of-truth reference
* list entirely and make the database authoritative for listing, removing this
* in-process lock.
*/
const refListLocks = /* @__PURE__ */ new Map();
function withRefListLock(refKey, task) {
	const tracked = (refListLocks.get(refKey) ?? Promise.resolve()).then(task, task).finally(() => {
		if (refListLocks.get(refKey) === tracked) refListLocks.delete(refKey);
	});
	refListLocks.set(refKey, tracked);
	return tracked;
}
/**
* Read-modify-write the ref list:
* used only when the list is the source of truth.
*/
async function modifyRefList(storage, refKey, modify) {
	await withRefListLock(refKey, async () => {
		const refListData = await storage.get(refKey);
		let keyIds = [];
		if (refListData && typeof refListData === "string") try {
			keyIds = JSON.parse(refListData);
		} catch {
			keyIds = [];
		}
		else if (Array.isArray(refListData)) keyIds = refListData;
		const next = modify(keyIds);
		if (next.length === 0) await storage.delete(refKey);
		else await storage.set(refKey, JSON.stringify(next));
	});
}
async function setApiKeyInStorage(_ctx, apiKey, storage, ttl, opts) {
	const serialized = serializeApiKey(apiKey);
	const refKey = getStorageKeyByReferenceId(apiKey.referenceId);
	if (opts.fallbackToDatabase) {
		await Promise.all([
			storage.set(getStorageKeyByHashedKey(apiKey.key), serialized, ttl),
			storage.set(getStorageKeyById(apiKey.id), serialized, ttl),
			storage.delete(refKey)
		]);
		return;
	}
	await Promise.all([storage.set(getStorageKeyByHashedKey(apiKey.key), serialized, ttl), storage.set(getStorageKeyById(apiKey.id), serialized, ttl)]);
	await modifyRefList(storage, refKey, (ids) => ids.includes(apiKey.id) ? ids : [...ids, apiKey.id]);
}
/**
* Delete API key from secondary storage
*/
async function deleteApiKeyFromStorage(ctx, apiKey, storage, opts) {
	const refKey = getStorageKeyByReferenceId(apiKey.referenceId);
	if (opts.fallbackToDatabase) {
		await Promise.all([
			storage.delete(getStorageKeyByHashedKey(apiKey.key)),
			storage.delete(getStorageKeyById(apiKey.id)),
			storage.delete(refKey)
		]);
		return;
	}
	await Promise.all([
		storage.delete(getStorageKeyByHashedKey(apiKey.key)),
		storage.delete(getStorageKeyById(apiKey.id)),
		modifyRefList(storage, refKey, (ids) => ids.filter((keyId) => keyId !== apiKey.id))
	]);
}
/**
* Unified getter for API keys with support for all storage modes
*/
async function getApiKey$1(ctx, hashedKey, opts) {
	const storage = getStorageInstance(ctx, opts);
	if (opts.storage === "database") return await ctx.context.adapter.findOne({
		model: "apikey",
		where: [{
			field: "key",
			value: hashedKey
		}]
	});
	if (opts.storage === "secondary-storage" && opts.fallbackToDatabase) {
		if (storage) {
			const cached = await getApiKeyFromStorage(ctx, hashedKey, storage);
			if (cached) return cached;
		}
		const dbKey = await ctx.context.adapter.findOne({
			model: "apikey",
			where: [{
				field: "key",
				value: hashedKey
			}]
		});
		if (dbKey && storage) await setApiKeyInStorage(ctx, dbKey, storage, calculateTTL(dbKey), opts);
		return dbKey;
	}
	if (opts.storage === "secondary-storage") {
		if (!storage) return null;
		return await getApiKeyFromStorage(ctx, hashedKey, storage);
	}
	return await ctx.context.adapter.findOne({
		model: "apikey",
		where: [{
			field: "key",
			value: hashedKey
		}]
	});
}
/**
* Unified getter for API keys by ID
*/
async function getApiKeyById(ctx, id, opts) {
	const storage = getStorageInstance(ctx, opts);
	if (opts.storage === "database") return await ctx.context.adapter.findOne({
		model: "apikey",
		where: [{
			field: "id",
			value: id
		}]
	});
	if (opts.storage === "secondary-storage" && opts.fallbackToDatabase) {
		if (storage) {
			const cached = await getApiKeyByIdFromStorage(ctx, id, storage);
			if (cached) return cached;
		}
		const dbKey = await ctx.context.adapter.findOne({
			model: "apikey",
			where: [{
				field: "id",
				value: id
			}]
		});
		if (dbKey && storage) await setApiKeyInStorage(ctx, dbKey, storage, calculateTTL(dbKey), opts);
		return dbKey;
	}
	if (opts.storage === "secondary-storage") {
		if (!storage) return null;
		return await getApiKeyByIdFromStorage(ctx, id, storage);
	}
	return await ctx.context.adapter.findOne({
		model: "apikey",
		where: [{
			field: "id",
			value: id
		}]
	});
}
/**
* Unified setter for API keys with support for all storage modes
*/
async function setApiKey(ctx, apiKey, opts) {
	const storage = getStorageInstance(ctx, opts);
	const ttl = calculateTTL(apiKey);
	if (opts.storage === "database") return;
	if (opts.storage === "secondary-storage") {
		if (!storage) throw new Error("Secondary storage is required when storage mode is 'secondary-storage'");
		await setApiKeyInStorage(ctx, apiKey, storage, ttl, opts);
		return;
	}
}
/**
* Unified deleter for API keys with support for all storage modes
*/
async function deleteApiKey$1(ctx, apiKey, opts) {
	const storage = getStorageInstance(ctx, opts);
	if (opts.storage === "database") return;
	if (opts.storage === "secondary-storage") {
		if (!storage) throw new Error("Secondary storage is required when storage mode is 'secondary-storage'");
		await deleteApiKeyFromStorage(ctx, apiKey, storage, opts);
		return;
	}
}
/**
* Apply sorting and pagination to an array of API keys in memory
* Used for secondary storage mode where we can't rely on database operations
*/
function applySortingAndPagination(apiKeys, sortBy, sortDirection, limit, offset) {
	let result = [...apiKeys];
	if (sortBy) {
		const direction = sortDirection || "asc";
		result.sort((a, b) => {
			const aValue = a[sortBy];
			const bValue = b[sortBy];
			if (aValue == null && bValue == null) return 0;
			if (aValue == null) return direction === "asc" ? -1 : 1;
			if (bValue == null) return direction === "asc" ? 1 : -1;
			if (aValue < bValue) return direction === "asc" ? -1 : 1;
			if (aValue > bValue) return direction === "asc" ? 1 : -1;
			return 0;
		});
	}
	if (offset !== void 0) result = result.slice(offset);
	if (limit !== void 0) result = result.slice(0, limit);
	return result;
}
/**
* List API keys for a reference (user or org) with support for all storage modes
*/
async function listApiKeys$1(ctx, referenceId, opts, paginationOpts) {
	const storage = getStorageInstance(ctx, opts);
	const { limit, offset, sortBy, sortDirection } = paginationOpts || {};
	if (opts.storage === "database") {
		const [apiKeys, total] = await Promise.all([ctx.context.adapter.findMany({
			model: "apikey",
			where: [{
				field: "referenceId",
				value: referenceId
			}],
			limit,
			offset,
			sortBy: sortBy ? {
				field: sortBy,
				direction: sortDirection || "asc"
			} : void 0
		}), ctx.context.adapter.count({
			model: "apikey",
			where: [{
				field: "referenceId",
				value: referenceId
			}]
		})]);
		return {
			apiKeys,
			total
		};
	}
	if (opts.storage === "secondary-storage" && opts.fallbackToDatabase) {
		const refKey = getStorageKeyByReferenceId(referenceId);
		if (storage) {
			const refListData = await storage.get(refKey);
			let keyIds = [];
			if (refListData && typeof refListData === "string") try {
				keyIds = JSON.parse(refListData);
			} catch {
				keyIds = [];
			}
			else if (Array.isArray(refListData)) keyIds = refListData;
			if (keyIds.length > 0) {
				const apiKeys = (await mapConcurrent(keyIds, (id) => getApiKeyByIdFromStorage(ctx, id, storage), { concurrency: STORAGE_CONCURRENCY })).filter((key) => key !== null && key !== void 0);
				return {
					apiKeys: applySortingAndPagination(apiKeys, sortBy, sortDirection, limit, offset),
					total: apiKeys.length
				};
			}
		}
		const [dbKeys, total] = await Promise.all([ctx.context.adapter.findMany({
			model: "apikey",
			where: [{
				field: "referenceId",
				value: referenceId
			}],
			limit,
			offset,
			sortBy: sortBy ? {
				field: sortBy,
				direction: sortDirection || "asc"
			} : void 0
		}), ctx.context.adapter.count({
			model: "apikey",
			where: [{
				field: "referenceId",
				value: referenceId
			}]
		})]);
		if (storage && dbKeys.length > 0) {
			await mapConcurrent(dbKeys, (apiKey) => setApiKeyInStorage(ctx, apiKey, storage, calculateTTL(apiKey), opts), { concurrency: STORAGE_CONCURRENCY });
			const keyIds = dbKeys.map((apiKey) => apiKey.id);
			await storage.set(refKey, JSON.stringify(keyIds));
		}
		return {
			apiKeys: dbKeys,
			total
		};
	}
	if (opts.storage === "secondary-storage") {
		if (!storage) return {
			apiKeys: [],
			total: 0
		};
		const refKey = getStorageKeyByReferenceId(referenceId);
		const refListData = await storage.get(refKey);
		let keyIds = [];
		if (refListData && typeof refListData === "string") try {
			keyIds = JSON.parse(refListData);
		} catch {
			return {
				apiKeys: [],
				total: 0
			};
		}
		else if (Array.isArray(refListData)) keyIds = refListData;
		else return {
			apiKeys: [],
			total: 0
		};
		const apiKeys = (await mapConcurrent(keyIds, (id) => getApiKeyByIdFromStorage(ctx, id, storage), { concurrency: STORAGE_CONCURRENCY })).filter((key) => key !== null && key !== void 0);
		return {
			apiKeys: applySortingAndPagination(apiKeys, sortBy, sortDirection, limit, offset),
			total: apiKeys.length
		};
	}
	const [apiKeys, total] = await Promise.all([ctx.context.adapter.findMany({
		model: "apikey",
		where: [{
			field: "referenceId",
			value: referenceId
		}],
		limit,
		offset,
		sortBy: sortBy ? {
			field: sortBy,
			direction: sortDirection || "asc"
		} : void 0
	}), ctx.context.adapter.count({
		model: "apikey",
		where: [{
			field: "referenceId",
			value: referenceId
		}]
	})]);
	return {
		apiKeys,
		total
	};
}
//#endregion
//#region src/org-authorization.ts
/**
* Gets the organization plugin options from the context.
* Returns null if the organization plugin is not installed.
*/
function getOrgOptions(ctx) {
	const context = ctx.context;
	if ("orgOptions" in context && context.orgOptions) return context.orgOptions;
	const orgPlugin = context.getPlugin?.("organization");
	if (orgPlugin && "options" in orgPlugin) return orgPlugin.options;
	return null;
}
/**
* Checks if a user is a member of an organization and has the required permission.
* This is used for organization-owned API keys to validate access.
*
* @param ctx - The endpoint context
* @param userId - The ID of the user to check
* @param organizationId - The ID of the organization (from API key's referenceId)
* @param requiredAction - The action the user is trying to perform (create, read, update, delete)
* @returns The member object if authorized
* @throws APIError if not authorized
*/
async function checkOrgApiKeyPermission(ctx, userId, organizationId, requiredAction) {
	const orgOptions = getOrgOptions(ctx);
	if (!orgOptions) {
		const msg = API_KEY_ERROR_CODES.ORGANIZATION_PLUGIN_REQUIRED;
		throw APIError$1.from("INTERNAL_SERVER_ERROR", msg);
	}
	const member = await ctx.context.adapter.findOne({
		model: "member",
		where: [{
			field: "userId",
			value: userId
		}, {
			field: "organizationId",
			value: organizationId
		}]
	});
	if (!member) {
		const msg = API_KEY_ERROR_CODES.USER_NOT_MEMBER_OF_ORGANIZATION;
		throw APIError$1.from("FORBIDDEN", msg);
	}
	if (!await checkPermission(ctx, member.role, organizationId, requiredAction, orgOptions)) {
		const msg = API_KEY_ERROR_CODES.INSUFFICIENT_API_KEY_PERMISSIONS;
		throw APIError$1.from("FORBIDDEN", msg);
	}
	return member;
}
/**
* Checks if a role has the required permission for API key operations.
* Uses the organization's access control system.
*
* Organization owners (determined by orgOptions.creatorRole, default "owner")
* are granted full access to API key operations.
*/
async function checkPermission(ctx, role, organizationId, action, orgOptions) {
	const { hasPermission } = await import("better-auth/plugins/organization");
	try {
		return await hasPermission({
			role,
			options: orgOptions,
			permissions: { apiKey: [action] },
			organizationId,
			allowCreatorAllPermissions: true
		}, ctx);
	} catch {
		return false;
	}
}
//#endregion
//#region src/utils.ts
const getDate = (span, unit = "ms") => {
	return new Date(Date.now() + (unit === "sec" ? span * 1e3 : span));
};
function isAPIError(error) {
	return error instanceof APIError || error instanceof APIError$1 || error?.name === "APIError";
}
//#endregion
//#region src/routes/create-api-key.ts
const createApiKeyBodySchema = z.object({
	configId: z.string().meta({ description: "The configuration ID to use for the API key. If not provided, the default configuration will be used." }).optional(),
	name: z.string().meta({ description: "Name of the Api Key" }).optional(),
	expiresIn: z.number().meta({ description: "Expiration time of the Api Key in seconds" }).min(1).optional().nullable().default(null),
	prefix: z.string().meta({ description: "Prefix of the Api Key" }).regex(/^[a-zA-Z0-9_-]+$/, { message: "Invalid prefix format, must be alphanumeric and contain only underscores and hyphens." }).optional(),
	remaining: z.number().meta({ description: "Remaining number of requests. Server side only" }).min(0).optional().nullable().default(null),
	metadata: z.any().optional(),
	refillAmount: z.number().meta({ description: "Amount to refill the remaining count of the Api Key. server-only. Eg: 100" }).min(1).optional(),
	refillInterval: z.number().meta({ description: "Interval to refill the Api Key in milliseconds. server-only. Eg: 1000" }).optional(),
	rateLimitTimeWindow: z.number().meta({ description: "The duration in milliseconds where each request is counted. Once the `maxRequests` is reached, the request will be rejected until the `timeWindow` has passed, at which point the `timeWindow` will be reset. server-only. Eg: 1000" }).optional(),
	rateLimitMax: z.number().meta({ description: "Maximum amount of requests allowed within a window. Once the `maxRequests` is reached, the request will be rejected until the `timeWindow` has passed, at which point the `timeWindow` will be reset. server-only. Eg: 100" }).optional(),
	rateLimitEnabled: z.boolean().meta({ description: "Whether the key has rate limiting enabled. server-only. Eg: true" }).optional(),
	permissions: z.record(z.string(), z.array(z.string())).meta({ description: "Permissions of the Api Key." }).optional(),
	userId: z.coerce.string().meta({ description: "User Id of the user that the Api Key belongs to. server-only. Eg: \"user-id\"" }).optional(),
	organizationId: z.coerce.string().meta({ description: "Organization Id of the organization that the Api Key belongs to. Eg: 'org-id'" }).optional()
});
function createApiKey({ defaultKeyGenerator, configurations, schema, deleteAllExpiredApiKeys }) {
	return createAuthEndpoint("/api-key/create", {
		method: "POST",
		body: createApiKeyBodySchema,
		metadata: { openapi: {
			description: "Create a new API key for a user",
			responses: { "200": {
				description: "API key created successfully",
				content: { "application/json": { schema: {
					type: "object",
					properties: {
						id: {
							type: "string",
							description: "Unique identifier of the API key"
						},
						createdAt: {
							type: "string",
							format: "date-time",
							description: "Creation timestamp"
						},
						updatedAt: {
							type: "string",
							format: "date-time",
							description: "Last update timestamp"
						},
						name: {
							type: "string",
							nullable: true,
							description: "Name of the API key"
						},
						prefix: {
							type: "string",
							nullable: true,
							description: "Prefix of the API key"
						},
						start: {
							type: "string",
							nullable: true,
							description: "Starting characters of the key (if configured)"
						},
						key: {
							type: "string",
							description: "The full API key (only returned on creation)"
						},
						enabled: {
							type: "boolean",
							description: "Whether the key is enabled"
						},
						expiresAt: {
							type: "string",
							format: "date-time",
							nullable: true,
							description: "Expiration timestamp"
						},
						referenceId: {
							type: "string",
							description: "ID of the reference owning the key"
						},
						lastRefillAt: {
							type: "string",
							format: "date-time",
							nullable: true,
							description: "Last refill timestamp"
						},
						lastRequest: {
							type: "string",
							format: "date-time",
							nullable: true,
							description: "Last request timestamp"
						},
						metadata: {
							type: "object",
							nullable: true,
							additionalProperties: true,
							description: "Metadata associated with the key"
						},
						rateLimitMax: {
							type: "number",
							nullable: true,
							description: "Maximum requests in time window"
						},
						rateLimitTimeWindow: {
							type: "number",
							nullable: true,
							description: "Rate limit time window in milliseconds"
						},
						remaining: {
							type: "number",
							nullable: true,
							description: "Remaining requests"
						},
						refillAmount: {
							type: "number",
							nullable: true,
							description: "Amount to refill"
						},
						refillInterval: {
							type: "number",
							nullable: true,
							description: "Refill interval in milliseconds"
						},
						rateLimitEnabled: {
							type: "boolean",
							description: "Whether rate limiting is enabled"
						},
						requestCount: {
							type: "number",
							description: "Current request count in window"
						},
						permissions: {
							type: "object",
							nullable: true,
							additionalProperties: {
								type: "array",
								items: { type: "string" }
							},
							description: "Permissions associated with the key"
						}
					},
					required: [
						"id",
						"createdAt",
						"updatedAt",
						"key",
						"enabled",
						"referenceId",
						"rateLimitEnabled",
						"requestCount"
					]
				} } }
			} }
		} }
	}, async (ctx) => {
		const { configId, name, expiresIn, prefix, remaining, metadata, refillAmount, refillInterval, permissions, rateLimitMax, rateLimitTimeWindow, rateLimitEnabled } = ctx.body;
		const opts = resolveConfiguration(ctx.context, configurations, configId);
		const keyGenerator = opts.customKeyGenerator || defaultKeyGenerator;
		const session = await getSessionFromCtx(ctx, { disableCookieCache: true });
		const isClientRequest = ctx.request || ctx.headers;
		if (isClientRequest && (refillAmount !== void 0 || refillInterval !== void 0 || rateLimitMax !== void 0 || rateLimitTimeWindow !== void 0 || rateLimitEnabled !== void 0 || permissions !== void 0 || remaining !== null)) throw APIError$1.from("BAD_REQUEST", API_KEY_ERROR_CODES.SERVER_ONLY_PROPERTY);
		if (ctx.request && ctx.body.userId !== void 0) throw APIError$1.from("UNAUTHORIZED", API_KEY_ERROR_CODES.UNAUTHORIZED_SESSION);
		const referencesType = opts.references ?? "user";
		let referenceId;
		if (referencesType === "organization") {
			const orgId = ctx.body.organizationId;
			if (!orgId) {
				const msg = API_KEY_ERROR_CODES.ORGANIZATION_ID_REQUIRED;
				throw APIError$1.from("BAD_REQUEST", msg);
			}
			const userId = session?.user.id || ctx.body.userId;
			if (!userId) throw APIError$1.from("UNAUTHORIZED", API_KEY_ERROR_CODES.UNAUTHORIZED_SESSION);
			await checkOrgApiKeyPermission(ctx, userId, orgId, "create");
			referenceId = orgId;
		} else if (isClientRequest) {
			if (!session?.user.id) {
				const msg = API_KEY_ERROR_CODES.UNAUTHORIZED_SESSION;
				throw APIError$1.from("UNAUTHORIZED", msg);
			}
			referenceId = session.user.id;
		} else {
			const ctxUserId = ctx.body.userId;
			const sessionUserId = session?.user.id;
			if (!sessionUserId && !ctxUserId) {
				const msg = API_KEY_ERROR_CODES.UNAUTHORIZED_SESSION;
				throw APIError$1.from("UNAUTHORIZED", msg);
			}
			if (session && ctxUserId && sessionUserId !== ctxUserId) {
				const msg = API_KEY_ERROR_CODES.UNAUTHORIZED_SESSION;
				throw APIError$1.from("UNAUTHORIZED", msg);
			}
			referenceId = sessionUserId || ctxUserId;
		}
		if (metadata) {
			if (opts.enableMetadata === false) throw APIError$1.from("BAD_REQUEST", API_KEY_ERROR_CODES.METADATA_DISABLED);
			if (typeof metadata !== "object") throw APIError$1.from("BAD_REQUEST", API_KEY_ERROR_CODES.INVALID_METADATA_TYPE);
		}
		if (refillAmount && !refillInterval) {
			const msg = API_KEY_ERROR_CODES.REFILL_AMOUNT_AND_INTERVAL_REQUIRED;
			throw APIError$1.from("BAD_REQUEST", msg);
		}
		if (refillInterval && !refillAmount) {
			const msg = API_KEY_ERROR_CODES.REFILL_INTERVAL_AND_AMOUNT_REQUIRED;
			throw APIError$1.from("BAD_REQUEST", msg);
		}
		if (expiresIn) {
			if (opts.keyExpiration.disableCustomExpiresTime === true) {
				const msg = API_KEY_ERROR_CODES.KEY_DISABLED_EXPIRATION;
				throw APIError$1.from("BAD_REQUEST", msg);
			}
			const expiresIn_in_days = expiresIn / (3600 * 24);
			if (opts.keyExpiration.minExpiresIn > expiresIn_in_days) {
				const msg = API_KEY_ERROR_CODES.EXPIRES_IN_IS_TOO_SMALL;
				throw APIError$1.from("BAD_REQUEST", msg);
			} else if (opts.keyExpiration.maxExpiresIn < expiresIn_in_days) {
				const msg = API_KEY_ERROR_CODES.EXPIRES_IN_IS_TOO_LARGE;
				throw APIError$1.from("BAD_REQUEST", msg);
			}
		}
		if (prefix) {
			if (prefix.length < opts.minimumPrefixLength) throw APIError$1.from("BAD_REQUEST", API_KEY_ERROR_CODES.INVALID_PREFIX_LENGTH);
			if (prefix.length > opts.maximumPrefixLength) throw APIError$1.from("BAD_REQUEST", API_KEY_ERROR_CODES.INVALID_PREFIX_LENGTH);
		}
		if (name) {
			if (name.length < opts.minimumNameLength) throw APIError$1.from("BAD_REQUEST", API_KEY_ERROR_CODES.INVALID_NAME_LENGTH);
			if (name.length > opts.maximumNameLength) throw APIError$1.from("BAD_REQUEST", API_KEY_ERROR_CODES.INVALID_NAME_LENGTH);
		} else if (opts.requireName) throw APIError$1.from("BAD_REQUEST", API_KEY_ERROR_CODES.NAME_REQUIRED);
		deleteAllExpiredApiKeys(ctx.context);
		const key = await keyGenerator({
			length: opts.defaultKeyLength,
			prefix: prefix || opts.defaultPrefix
		});
		const hashed = opts.disableKeyHashing ? key : await defaultKeyHasher(key);
		let start = null;
		if (opts.startingCharactersConfig.shouldStore) start = key.substring(0, opts.startingCharactersConfig.charactersLength);
		const defaultPermissions = opts.permissions?.defaultPermissions ? typeof opts.permissions.defaultPermissions === "function" ? await opts.permissions.defaultPermissions(referenceId, ctx) : opts.permissions.defaultPermissions : void 0;
		const permissionsToApply = permissions ? JSON.stringify(permissions) : defaultPermissions ? JSON.stringify(defaultPermissions) : void 0;
		const data = {
			configId: opts.configId ?? "default",
			createdAt: /* @__PURE__ */ new Date(),
			updatedAt: /* @__PURE__ */ new Date(),
			name: name ?? null,
			prefix: prefix ?? opts.defaultPrefix ?? null,
			start,
			key: hashed,
			enabled: true,
			expiresAt: expiresIn ? getDate(expiresIn, "sec") : opts.keyExpiration.defaultExpiresIn ? getDate(opts.keyExpiration.defaultExpiresIn, "sec") : null,
			referenceId,
			lastRefillAt: null,
			lastRequest: null,
			metadata: null,
			rateLimitMax: rateLimitMax ?? opts.rateLimit.maxRequests ?? null,
			rateLimitTimeWindow: rateLimitTimeWindow ?? opts.rateLimit.timeWindow ?? null,
			remaining: remaining === null ? remaining : remaining ?? refillAmount ?? null,
			refillAmount: refillAmount ?? null,
			refillInterval: refillInterval ?? null,
			rateLimitEnabled: rateLimitEnabled === void 0 ? opts.rateLimit.enabled ?? true : rateLimitEnabled,
			requestCount: 0,
			permissions: permissionsToApply
		};
		if (metadata) data.metadata = metadata;
		let apiKey;
		if (opts.storage === "secondary-storage" && opts.fallbackToDatabase) {
			apiKey = await ctx.context.adapter.create({
				model: API_KEY_TABLE_NAME,
				data
			});
			await setApiKey(ctx, apiKey, opts);
		} else if (opts.storage === "secondary-storage") {
			const id = ctx.context.generateId({ model: "apikey" }) || generateId();
			apiKey = {
				...data,
				id
			};
			await setApiKey(ctx, apiKey, opts);
		} else apiKey = await ctx.context.adapter.create({
			model: API_KEY_TABLE_NAME,
			data
		});
		return ctx.json({
			...apiKey,
			key,
			metadata: metadata ?? null,
			permissions: apiKey.permissions ? safeJSONParse(apiKey.permissions) : null
		});
	});
}
//#endregion
//#region src/routes/delete-all-expired-api-keys.ts
function deleteAllExpiredApiKeysEndpoint({ deleteAllExpiredApiKeys }) {
	return createAuthEndpoint.serverOnly({ method: "POST" }, async (ctx) => {
		try {
			await deleteAllExpiredApiKeys(ctx.context, true);
		} catch (error) {
			ctx.context.logger.error("[API KEY PLUGIN] Failed to delete expired API keys:", error);
			return ctx.json({
				success: false,
				error
			});
		}
		return ctx.json({
			success: true,
			error: null
		});
	});
}
//#endregion
//#region src/routes/delete-api-key.ts
const deleteApiKeyBodySchema = z.object({
	configId: z.string().meta({ description: "The configuration ID to use for the API key lookup. If not provided, the default configuration will be used." }).optional(),
	keyId: z.string().meta({ description: "The id of the Api Key" })
});
function deleteApiKey({ configurations, schema, deleteAllExpiredApiKeys }) {
	return createAuthEndpoint("/api-key/delete", {
		method: "POST",
		body: deleteApiKeyBodySchema,
		use: [sessionMiddleware],
		metadata: { openapi: {
			description: "Delete an existing API key",
			requestBody: { content: { "application/json": { schema: {
				type: "object",
				properties: { keyId: {
					type: "string",
					description: "The id of the API key to delete"
				} },
				required: ["keyId"]
			} } } },
			responses: { "200": {
				description: "API key deleted successfully",
				content: { "application/json": { schema: {
					type: "object",
					properties: { success: {
						type: "boolean",
						description: "Indicates if the API key was successfully deleted"
					} },
					required: ["success"]
				} } }
			} }
		} }
	}, async (ctx) => {
		const { configId, keyId } = ctx.body;
		const session = ctx.context.session;
		if (session.user.banned === true) throw APIError$1.from("UNAUTHORIZED", API_KEY_ERROR_CODES.USER_BANNED);
		const lookupOpts = resolveConfiguration(ctx.context, configurations, configId);
		let apiKey = null;
		apiKey = await getApiKeyById(ctx, keyId, lookupOpts);
		if (!apiKey) throw APIError$1.from("NOT_FOUND", API_KEY_ERROR_CODES.KEY_NOT_FOUND);
		if (!configIdMatches(apiKey.configId, lookupOpts.configId)) throw APIError$1.from("NOT_FOUND", API_KEY_ERROR_CODES.KEY_NOT_FOUND);
		const opts = resolveConfiguration(ctx.context, configurations, apiKey.configId);
		if ((opts.references ?? "user") === "organization") await checkOrgApiKeyPermission(ctx, session.user.id, apiKey.referenceId, "delete");
		else if (apiKey.referenceId !== session.user.id) throw APIError$1.from("NOT_FOUND", API_KEY_ERROR_CODES.KEY_NOT_FOUND);
		try {
			if (opts.storage === "secondary-storage" && opts.fallbackToDatabase) {
				await deleteApiKey$1(ctx, apiKey, opts);
				await ctx.context.adapter.delete({
					model: API_KEY_TABLE_NAME,
					where: [{
						field: "id",
						value: apiKey.id
					}]
				});
			} else if (opts.storage === "database") await ctx.context.adapter.delete({
				model: API_KEY_TABLE_NAME,
				where: [{
					field: "id",
					value: apiKey.id
				}]
			});
			else await deleteApiKey$1(ctx, apiKey, opts);
		} catch (error) {
			throw APIError$1.fromStatus("INTERNAL_SERVER_ERROR", { message: error?.message });
		}
		deleteAllExpiredApiKeys(ctx.context);
		return ctx.json({ success: true });
	});
}
//#endregion
//#region src/routes/get-api-key.ts
const getApiKeyQuerySchema = z.object({
	configId: z.string().meta({ description: "The configuration ID to use for the API key lookup. If not provided, the default configuration will be used." }).optional(),
	id: z.string().meta({ description: "The id of the Api Key" })
});
function getApiKey({ configurations, schema, deleteAllExpiredApiKeys }) {
	return createAuthEndpoint("/api-key/get", {
		method: "GET",
		query: getApiKeyQuerySchema,
		use: [sessionMiddleware],
		metadata: { openapi: {
			description: "Retrieve an existing API key by ID",
			responses: { "200": {
				description: "API key retrieved successfully",
				content: { "application/json": { schema: {
					type: "object",
					properties: {
						id: {
							type: "string",
							description: "ID"
						},
						name: {
							type: "string",
							nullable: true,
							description: "The name of the key"
						},
						start: {
							type: "string",
							nullable: true,
							description: "Shows the first few characters of the API key, including the prefix. This allows you to show those few characters in the UI to make it easier for users to identify the API key."
						},
						prefix: {
							type: "string",
							nullable: true,
							description: "The API Key prefix. Stored as plain text."
						},
						userId: {
							type: "string",
							description: "The owner of the user id"
						},
						refillInterval: {
							type: "number",
							nullable: true,
							description: "The interval in milliseconds between refills of the `remaining` count. Example: 3600000 // refill every hour (3600000ms = 1h)"
						},
						refillAmount: {
							type: "number",
							nullable: true,
							description: "The amount to refill"
						},
						lastRefillAt: {
							type: "string",
							format: "date-time",
							nullable: true,
							description: "The last refill date"
						},
						enabled: {
							type: "boolean",
							description: "Sets if key is enabled or disabled",
							default: true
						},
						rateLimitEnabled: {
							type: "boolean",
							description: "Whether the key has rate limiting enabled"
						},
						rateLimitTimeWindow: {
							type: "number",
							nullable: true,
							description: "The duration in milliseconds"
						},
						rateLimitMax: {
							type: "number",
							nullable: true,
							description: "Maximum amount of requests allowed within a window"
						},
						requestCount: {
							type: "number",
							description: "The number of requests made within the rate limit time window"
						},
						remaining: {
							type: "number",
							nullable: true,
							description: "Remaining requests (every time api key is used this should updated and should be updated on refill as well)"
						},
						lastRequest: {
							type: "string",
							format: "date-time",
							nullable: true,
							description: "When last request occurred"
						},
						expiresAt: {
							type: "string",
							format: "date-time",
							nullable: true,
							description: "Expiry date of a key"
						},
						createdAt: {
							type: "string",
							format: "date-time",
							description: "created at"
						},
						updatedAt: {
							type: "string",
							format: "date-time",
							description: "updated at"
						},
						metadata: {
							type: "object",
							nullable: true,
							additionalProperties: true,
							description: "Extra metadata about the apiKey"
						},
						permissions: {
							type: "string",
							nullable: true,
							description: "Permissions for the api key (stored as JSON string)"
						}
					},
					required: [
						"id",
						"userId",
						"enabled",
						"rateLimitEnabled",
						"requestCount",
						"createdAt",
						"updatedAt"
					]
				} } }
			} }
		} }
	}, async (ctx) => {
		const { configId, id } = ctx.query;
		const session = ctx.context.session;
		const lookupOpts = resolveConfiguration(ctx.context, configurations, configId);
		let apiKey = null;
		apiKey = await getApiKeyById(ctx, id, lookupOpts);
		if (!apiKey) throw APIError$1.from("NOT_FOUND", API_KEY_ERROR_CODES.KEY_NOT_FOUND);
		if (!configIdMatches(apiKey.configId, lookupOpts.configId)) throw APIError$1.from("NOT_FOUND", API_KEY_ERROR_CODES.KEY_NOT_FOUND);
		const opts = resolveConfiguration(ctx.context, configurations, apiKey.configId);
		if ((opts.references ?? "user") === "organization") await checkOrgApiKeyPermission(ctx, session.user.id, apiKey.referenceId, "read");
		else if (apiKey.referenceId !== session.user.id) throw APIError$1.from("NOT_FOUND", API_KEY_ERROR_CODES.KEY_NOT_FOUND);
		deleteAllExpiredApiKeys(ctx.context);
		const metadata = await migrateDoubleStringifiedMetadata(ctx, apiKey, opts);
		const { key: _key, ...returningApiKey } = apiKey;
		return ctx.json({
			...returningApiKey,
			metadata,
			permissions: returningApiKey.permissions ? safeJSONParse(returningApiKey.permissions) : null
		});
	});
}
//#endregion
//#region src/routes/list-api-keys.ts
/**
* Generate a unique identifier for a configuration's storage backend.
* Used to group configurations that share the same storage and avoid duplicate queries.
*/
function getStorageIdentifier(config) {
	if (config.storage === "database") return "database";
	if (config.customStorage) return `custom:${config.configId ?? "default"}`;
	return config.fallbackToDatabase ? "secondary-storage-with-fallback" : "secondary-storage";
}
const listApiKeysQuerySchema = z.object({
	configId: z.string().meta({ description: "Filter by configuration ID. If not provided, returns keys from all configurations." }).optional(),
	organizationId: z.string().meta({ description: "Organization ID to list keys for. If provided, returns organization-owned keys. If not provided, returns user-owned keys." }).optional(),
	limit: z.coerce.number().int().nonnegative().meta({ description: "The number of API keys to return" }).optional(),
	offset: z.coerce.number().int().nonnegative().meta({ description: "The offset to start from" }).optional(),
	sortBy: z.string().meta({ description: "The field to sort by (e.g., createdAt, name, expiresAt)" }).optional(),
	sortDirection: z.enum(["asc", "desc"]).meta({ description: "The direction to sort by" }).optional()
}).optional();
function listApiKeys({ configurations, schema, deleteAllExpiredApiKeys }) {
	return createAuthEndpoint("/api-key/list", {
		method: "GET",
		use: [sessionMiddleware],
		query: listApiKeysQuerySchema,
		metadata: { openapi: {
			description: "List all API keys for the authenticated user or for a specific organization",
			responses: { "200": {
				description: "API keys retrieved successfully",
				content: { "application/json": { schema: {
					type: "object",
					properties: {
						apiKeys: {
							type: "array",
							items: {
								type: "object",
								properties: {
									id: {
										type: "string",
										description: "ID"
									},
									name: {
										type: "string",
										nullable: true,
										description: "The name of the key"
									},
									start: {
										type: "string",
										nullable: true,
										description: "Shows the first few characters of the API key, including the prefix. This allows you to show those few characters in the UI to make it easier for users to identify the API key."
									},
									prefix: {
										type: "string",
										nullable: true,
										description: "The API Key prefix. Stored as plain text."
									},
									userId: {
										type: "string",
										description: "The owner of the user id"
									},
									refillInterval: {
										type: "number",
										nullable: true,
										description: "The interval in milliseconds between refills of the `remaining` count. Example: 3600000 // refill every hour (3600000ms = 1h)"
									},
									refillAmount: {
										type: "number",
										nullable: true,
										description: "The amount to refill"
									},
									lastRefillAt: {
										type: "string",
										format: "date-time",
										nullable: true,
										description: "The last refill date"
									},
									enabled: {
										type: "boolean",
										description: "Sets if key is enabled or disabled",
										default: true
									},
									rateLimitEnabled: {
										type: "boolean",
										description: "Whether the key has rate limiting enabled"
									},
									rateLimitTimeWindow: {
										type: "number",
										nullable: true,
										description: "The duration in milliseconds"
									},
									rateLimitMax: {
										type: "number",
										nullable: true,
										description: "Maximum amount of requests allowed within a window"
									},
									requestCount: {
										type: "number",
										description: "The number of requests made within the rate limit time window"
									},
									remaining: {
										type: "number",
										nullable: true,
										description: "Remaining requests (every time api key is used this should updated and should be updated on refill as well)"
									},
									lastRequest: {
										type: "string",
										format: "date-time",
										nullable: true,
										description: "When last request occurred"
									},
									expiresAt: {
										type: "string",
										format: "date-time",
										nullable: true,
										description: "Expiry date of a key"
									},
									createdAt: {
										type: "string",
										format: "date-time",
										description: "created at"
									},
									updatedAt: {
										type: "string",
										format: "date-time",
										description: "updated at"
									},
									metadata: {
										type: "object",
										nullable: true,
										additionalProperties: true,
										description: "Extra metadata about the apiKey"
									},
									permissions: {
										type: "string",
										nullable: true,
										description: "Permissions for the api key (stored as JSON string)"
									}
								},
								required: [
									"id",
									"userId",
									"enabled",
									"rateLimitEnabled",
									"requestCount",
									"createdAt",
									"updatedAt"
								]
							}
						},
						total: {
							type: "number",
							description: "Total number of API keys"
						},
						limit: {
							type: "number",
							nullable: true,
							description: "The limit used for pagination"
						},
						offset: {
							type: "number",
							nullable: true,
							description: "The offset used for pagination"
						}
					},
					required: ["apiKeys", "total"]
				} } }
			} }
		} }
	}, async (ctx) => {
		const session = ctx.context.session;
		const configId = ctx.query?.configId;
		const organizationId = ctx.query?.organizationId;
		const limit = ctx.query?.limit != null ? Number(ctx.query.limit) : void 0;
		const offset = ctx.query?.offset != null ? Number(ctx.query.offset) : void 0;
		if (organizationId) await checkOrgApiKeyPermission(ctx, session.user.id, organizationId, "read");
		const referenceId = organizationId ?? session.user.id;
		const expectedReferencesType = organizationId ? "organization" : "user";
		let allApiKeys = [];
		if (configId) {
			const { apiKeys } = await listApiKeys$1(ctx, referenceId, resolveConfiguration(ctx.context, configurations, configId), {
				limit: void 0,
				offset: void 0,
				sortBy: ctx.query?.sortBy,
				sortDirection: ctx.query?.sortDirection
			});
			allApiKeys = apiKeys;
		} else {
			const storageGroups = /* @__PURE__ */ new Map();
			for (const config of configurations) {
				const storageKey = getStorageIdentifier(config);
				if (!storageGroups.has(storageKey)) storageGroups.set(storageKey, config);
			}
			const groupResults = await Promise.all([...storageGroups.values()].map((opts) => listApiKeys$1(ctx, referenceId, opts, {
				limit: void 0,
				offset: void 0,
				sortBy: ctx.query?.sortBy,
				sortDirection: ctx.query?.sortDirection
			})));
			const seenIds = /* @__PURE__ */ new Set();
			for (const { apiKeys } of groupResults) for (const key of apiKeys) if (!seenIds.has(key.id)) {
				seenIds.add(key.id);
				allApiKeys.push(key);
			}
		}
		let filteredApiKeys = allApiKeys.filter((key) => {
			return (configurations.find((c) => {
				if (isDefaultConfigId(key.configId)) return isDefaultConfigId(c.configId);
				return c.configId === key.configId;
			})?.references ?? "user") === expectedReferencesType && key.referenceId === referenceId;
		});
		if (configId) filteredApiKeys = filteredApiKeys.filter((key) => configIdMatches(key.configId, configId));
		const total = filteredApiKeys.length;
		let paginatedApiKeys = filteredApiKeys;
		if (offset !== void 0) paginatedApiKeys = paginatedApiKeys.slice(offset);
		if (limit !== void 0) paginatedApiKeys = paginatedApiKeys.slice(0, limit);
		deleteAllExpiredApiKeys(ctx.context);
		const returningApiKeys = paginatedApiKeys.map((apiKey) => {
			const { key: _key, ...rest } = apiKey;
			return {
				...rest,
				metadata: parseDoubleStringifiedMetadata(apiKey.metadata),
				permissions: rest.permissions ? safeJSONParse(rest.permissions) : null
			};
		});
		const dbConfig = configurations.find((c) => c.storage === "database" || c.fallbackToDatabase);
		if (dbConfig) await ctx.context.runInBackgroundOrAwait(batchMigrateLegacyMetadata(ctx, paginatedApiKeys, dbConfig));
		return ctx.json({
			apiKeys: returningApiKeys,
			total,
			limit,
			offset
		});
	});
}
//#endregion
//#region src/routes/update-api-key.ts
const updateApiKeyBodySchema = z.object({
	configId: z.string().meta({ description: "The configuration ID to use for the API key lookup. If not provided, the default configuration will be used." }).optional(),
	keyId: z.string().meta({ description: "The id of the Api Key" }),
	userId: z.coerce.string().meta({ description: "The id of the user which the api key belongs to. server-only. Eg: \"some-user-id\"" }).optional(),
	name: z.string().meta({ description: "The name of the key" }).optional(),
	enabled: z.boolean().meta({ description: "Whether the Api Key is enabled or not" }).optional(),
	remaining: z.number().meta({ description: "The number of remaining requests" }).min(1).optional(),
	refillAmount: z.number().meta({ description: "The refill amount" }).optional(),
	refillInterval: z.number().meta({ description: "The refill interval" }).optional(),
	metadata: z.any().optional(),
	expiresIn: z.number().meta({ description: "Expiration time of the Api Key in seconds" }).min(1).optional().nullable(),
	rateLimitEnabled: z.boolean().meta({ description: "Whether the key has rate limiting enabled." }).optional(),
	rateLimitTimeWindow: z.number().meta({ description: "The duration in milliseconds where each request is counted. server-only. Eg: 1000" }).optional(),
	rateLimitMax: z.number().meta({ description: "Maximum amount of requests allowed within a window. Once the `maxRequests` is reached, the request will be rejected until the `timeWindow` has passed, at which point the `timeWindow` will be reset. server-only. Eg: 100" }).optional(),
	permissions: z.record(z.string(), z.array(z.string())).meta({ description: "Update the permissions on the API Key. server-only." }).optional().nullable()
});
function updateApiKey({ configurations, schema, deleteAllExpiredApiKeys }) {
	return createAuthEndpoint("/api-key/update", {
		method: "POST",
		body: updateApiKeyBodySchema,
		metadata: { openapi: {
			description: "Update an existing API key by ID",
			responses: { "200": {
				description: "API key updated successfully",
				content: { "application/json": { schema: {
					type: "object",
					properties: {
						id: {
							type: "string",
							description: "ID"
						},
						name: {
							type: "string",
							nullable: true,
							description: "The name of the key"
						},
						start: {
							type: "string",
							nullable: true,
							description: "Shows the first few characters of the API key, including the prefix. This allows you to show those few characters in the UI to make it easier for users to identify the API key."
						},
						prefix: {
							type: "string",
							nullable: true,
							description: "The API Key prefix. Stored as plain text."
						},
						userId: {
							type: "string",
							description: "The owner of the user id"
						},
						refillInterval: {
							type: "number",
							nullable: true,
							description: "The interval in milliseconds between refills of the `remaining` count. Example: 3600000 // refill every hour (3600000ms = 1h)"
						},
						refillAmount: {
							type: "number",
							nullable: true,
							description: "The amount to refill"
						},
						lastRefillAt: {
							type: "string",
							format: "date-time",
							nullable: true,
							description: "The last refill date"
						},
						enabled: {
							type: "boolean",
							description: "Sets if key is enabled or disabled",
							default: true
						},
						rateLimitEnabled: {
							type: "boolean",
							description: "Whether the key has rate limiting enabled"
						},
						rateLimitTimeWindow: {
							type: "number",
							nullable: true,
							description: "The duration in milliseconds"
						},
						rateLimitMax: {
							type: "number",
							nullable: true,
							description: "Maximum amount of requests allowed within a window"
						},
						requestCount: {
							type: "number",
							description: "The number of requests made within the rate limit time window"
						},
						remaining: {
							type: "number",
							nullable: true,
							description: "Remaining requests (every time api key is used this should updated and should be updated on refill as well)"
						},
						lastRequest: {
							type: "string",
							format: "date-time",
							nullable: true,
							description: "When last request occurred"
						},
						expiresAt: {
							type: "string",
							format: "date-time",
							nullable: true,
							description: "Expiry date of a key"
						},
						createdAt: {
							type: "string",
							format: "date-time",
							description: "created at"
						},
						updatedAt: {
							type: "string",
							format: "date-time",
							description: "updated at"
						},
						metadata: {
							type: "object",
							nullable: true,
							additionalProperties: true,
							description: "Extra metadata about the apiKey"
						},
						permissions: {
							type: "string",
							nullable: true,
							description: "Permissions for the api key (stored as JSON string)"
						}
					},
					required: [
						"id",
						"userId",
						"enabled",
						"rateLimitEnabled",
						"requestCount",
						"createdAt",
						"updatedAt"
					]
				} } }
			} }
		} }
	}, async (ctx) => {
		const { configId, keyId, expiresIn, enabled, metadata, refillAmount, refillInterval, remaining, name, permissions, rateLimitEnabled, rateLimitTimeWindow, rateLimitMax } = ctx.body;
		const session = await getSessionFromCtx(ctx, { disableCookieCache: true });
		const authRequired = ctx.request || ctx.headers;
		const user = authRequired && !session ? null : session?.user || { id: ctx.body.userId };
		if (!user?.id) throw APIError$1.from("UNAUTHORIZED", API_KEY_ERROR_CODES.UNAUTHORIZED_SESSION);
		if (session && ctx.body.userId && session?.user.id !== ctx.body.userId) throw APIError$1.from("UNAUTHORIZED", API_KEY_ERROR_CODES.UNAUTHORIZED_SESSION);
		if (authRequired) {
			if (refillAmount !== void 0 || refillInterval !== void 0 || rateLimitMax !== void 0 || rateLimitTimeWindow !== void 0 || rateLimitEnabled !== void 0 || remaining !== void 0 || permissions !== void 0) throw APIError$1.from("BAD_REQUEST", API_KEY_ERROR_CODES.SERVER_ONLY_PROPERTY);
		}
		const lookupOpts = resolveConfiguration(ctx.context, configurations, configId);
		let apiKey = null;
		apiKey = await getApiKeyById(ctx, keyId, lookupOpts);
		if (!apiKey) throw APIError$1.from("NOT_FOUND", API_KEY_ERROR_CODES.KEY_NOT_FOUND);
		if (!configIdMatches(apiKey.configId, lookupOpts.configId)) throw APIError$1.from("NOT_FOUND", API_KEY_ERROR_CODES.KEY_NOT_FOUND);
		const opts = resolveConfiguration(ctx.context, configurations, apiKey.configId);
		if ((opts.references ?? "user") === "organization") await checkOrgApiKeyPermission(ctx, user.id, apiKey.referenceId, "update");
		else if (apiKey.referenceId !== user.id) throw APIError$1.from("NOT_FOUND", API_KEY_ERROR_CODES.KEY_NOT_FOUND);
		const newValues = {};
		if (name !== void 0) {
			if (name.length < opts.minimumNameLength) throw APIError$1.from("BAD_REQUEST", API_KEY_ERROR_CODES.INVALID_NAME_LENGTH);
			else if (name.length > opts.maximumNameLength) throw APIError$1.from("BAD_REQUEST", API_KEY_ERROR_CODES.INVALID_NAME_LENGTH);
			newValues.name = name;
		}
		if (enabled !== void 0) newValues.enabled = enabled;
		if (expiresIn !== void 0) {
			if (opts.keyExpiration.disableCustomExpiresTime === true) throw APIError$1.from("BAD_REQUEST", API_KEY_ERROR_CODES.KEY_DISABLED_EXPIRATION);
			if (expiresIn !== null) {
				const expiresIn_in_days = expiresIn / (3600 * 24);
				if (expiresIn_in_days < opts.keyExpiration.minExpiresIn) throw APIError$1.from("BAD_REQUEST", API_KEY_ERROR_CODES.EXPIRES_IN_IS_TOO_SMALL);
				else if (expiresIn_in_days > opts.keyExpiration.maxExpiresIn) throw APIError$1.from("BAD_REQUEST", API_KEY_ERROR_CODES.EXPIRES_IN_IS_TOO_LARGE);
			}
			newValues.expiresAt = expiresIn ? getDate(expiresIn, "sec") : null;
		}
		if (metadata !== void 0 && opts.enableMetadata === true) {
			if (typeof metadata !== "object") throw APIError$1.from("BAD_REQUEST", API_KEY_ERROR_CODES.INVALID_METADATA_TYPE);
			newValues.metadata = metadata;
		}
		if (remaining !== void 0) newValues.remaining = remaining;
		if (refillAmount !== void 0 || refillInterval !== void 0) {
			if (refillAmount !== void 0 && refillInterval === void 0) throw APIError$1.from("BAD_REQUEST", API_KEY_ERROR_CODES.REFILL_AMOUNT_AND_INTERVAL_REQUIRED);
			else if (refillInterval !== void 0 && refillAmount === void 0) throw APIError$1.from("BAD_REQUEST", API_KEY_ERROR_CODES.REFILL_INTERVAL_AND_AMOUNT_REQUIRED);
			newValues.refillAmount = refillAmount;
			newValues.refillInterval = refillInterval;
		}
		if (rateLimitEnabled !== void 0) newValues.rateLimitEnabled = rateLimitEnabled;
		if (rateLimitTimeWindow !== void 0) newValues.rateLimitTimeWindow = rateLimitTimeWindow;
		if (rateLimitMax !== void 0) newValues.rateLimitMax = rateLimitMax;
		if (permissions !== void 0) newValues.permissions = JSON.stringify(permissions);
		if (Object.keys(newValues).length === 0) throw APIError$1.from("BAD_REQUEST", API_KEY_ERROR_CODES.NO_VALUES_TO_UPDATE);
		let newApiKey = apiKey;
		try {
			if (opts.storage === "secondary-storage" && opts.fallbackToDatabase) {
				const dbUpdated = await ctx.context.adapter.update({
					model: API_KEY_TABLE_NAME,
					where: [{
						field: "id",
						value: apiKey.id
					}],
					update: newValues
				});
				if (dbUpdated) {
					await setApiKey(ctx, dbUpdated, opts);
					newApiKey = dbUpdated;
				}
			} else if (opts.storage === "database") {
				const result = await ctx.context.adapter.update({
					model: API_KEY_TABLE_NAME,
					where: [{
						field: "id",
						value: apiKey.id
					}],
					update: newValues
				});
				if (result) newApiKey = result;
			} else {
				const updated = {
					...apiKey,
					...newValues,
					updatedAt: /* @__PURE__ */ new Date()
				};
				await setApiKey(ctx, updated, opts);
				newApiKey = updated;
			}
		} catch (error) {
			throw APIError$1.fromStatus("INTERNAL_SERVER_ERROR", { message: error?.message });
		}
		deleteAllExpiredApiKeys(ctx.context);
		const migratedMetadata = await migrateDoubleStringifiedMetadata(ctx, newApiKey, opts);
		const { key: _key, ...returningApiKey } = newApiKey;
		return ctx.json({
			...returningApiKey,
			metadata: migratedMetadata,
			permissions: returningApiKey.permissions ? safeJSONParse(returningApiKey.permissions) : null
		});
	});
}
//#endregion
//#region src/rate-limit.ts
/**
* Decides how the current request affects the per-key rate-limit counter, based
* on the read-in-memory ApiKey. The verify route applies the result atomically;
* this function performs no writes.
*/
function evaluateRateLimit(apiKey, opts) {
	const now = /* @__PURE__ */ new Date();
	const lastRequest = apiKey.lastRequest;
	const rateLimitTimeWindow = apiKey.rateLimitTimeWindow;
	const rateLimitMax = apiKey.rateLimitMax;
	if (opts.rateLimit.enabled === false) return {
		type: "skip",
		lastRequest: now
	};
	if (apiKey.rateLimitEnabled === false) return {
		type: "skip",
		lastRequest: now
	};
	if (rateLimitTimeWindow === null || rateLimitMax === null) return {
		type: "skip",
		lastRequest: null
	};
	if (lastRequest === null) return {
		type: "start",
		now
	};
	const timeSinceLastRequest = now.getTime() - new Date(lastRequest).getTime();
	if (timeSinceLastRequest > rateLimitTimeWindow) return {
		type: "reset",
		now,
		windowStart: new Date(now.getTime() - rateLimitTimeWindow)
	};
	if (apiKey.requestCount >= rateLimitMax) return {
		type: "deny",
		message: API_KEY_ERROR_CODES.RATE_LIMIT_EXCEEDED.message,
		tryAgainIn: Math.ceil(rateLimitTimeWindow - timeSinceLastRequest)
	};
	return {
		type: "increment",
		now,
		max: rateLimitMax,
		windowStart: new Date(now.getTime() - rateLimitTimeWindow)
	};
}
//#endregion
//#region src/routes/verify-api-key.ts
async function validateApiKey({ key, ctx, lookupOpts, configurations, schema, permissions, expectedConfigId, runCustomValidator }) {
	const hashedKey = lookupOpts.disableKeyHashing ? key : await defaultKeyHasher(key);
	const apiKey = await getApiKey$1(ctx, hashedKey, lookupOpts);
	if (!apiKey) throw APIError$1.from("UNAUTHORIZED", API_KEY_ERROR_CODES.INVALID_API_KEY);
	if (expectedConfigId !== void 0 && !configIdMatches(apiKey.configId, expectedConfigId)) throw APIError$1.from("UNAUTHORIZED", API_KEY_ERROR_CODES.INVALID_API_KEY);
	const opts = resolveConfiguration(ctx.context, configurations, apiKey.configId);
	if (runCustomValidator && opts.customAPIKeyValidator) {
		if (!await opts.customAPIKeyValidator({
			ctx,
			key
		})) throw APIError$1.from("UNAUTHORIZED", API_KEY_ERROR_CODES.KEY_NOT_FOUND);
	}
	if (apiKey.enabled === false) throw APIError$1.from("UNAUTHORIZED", API_KEY_ERROR_CODES.KEY_DISABLED);
	if (apiKey.expiresAt) {
		if (Date.now() > new Date(apiKey.expiresAt).getTime()) {
			const deleteExpiredKey = async () => {
				if (opts.storage === "secondary-storage" && opts.fallbackToDatabase) {
					await deleteApiKey$1(ctx, apiKey, opts);
					await ctx.context.adapter.delete({
						model: API_KEY_TABLE_NAME,
						where: [{
							field: "id",
							value: apiKey.id
						}]
					});
				} else if (opts.storage === "secondary-storage") await deleteApiKey$1(ctx, apiKey, opts);
				else await ctx.context.adapter.delete({
					model: API_KEY_TABLE_NAME,
					where: [{
						field: "id",
						value: apiKey.id
					}]
				});
			};
			if (opts.deferUpdates) ctx.context.runInBackground(deleteExpiredKey().catch((error) => {
				ctx.context.logger.error("Deferred update failed:", error);
			}));
			else await deleteExpiredKey();
			throw APIError$1.from("UNAUTHORIZED", API_KEY_ERROR_CODES.KEY_EXPIRED);
		}
	}
	if (permissions) {
		const apiKeyPermissions = apiKey.permissions ? safeJSONParse(apiKey.permissions) : null;
		if (!apiKeyPermissions) throw APIError$1.from("UNAUTHORIZED", API_KEY_ERROR_CODES.KEY_NOT_FOUND);
		if (!role(apiKeyPermissions).authorize(permissions).success) throw APIError$1.from("UNAUTHORIZED", API_KEY_ERROR_CODES.KEY_NOT_FOUND);
	}
	if (apiKey.remaining === 0 && apiKey.refillAmount === null) {
		const deleteExhaustedKey = async () => {
			if (opts.storage === "secondary-storage" && opts.fallbackToDatabase) {
				await deleteApiKey$1(ctx, apiKey, opts);
				await ctx.context.adapter.delete({
					model: API_KEY_TABLE_NAME,
					where: [{
						field: "id",
						value: apiKey.id
					}]
				});
			} else if (opts.storage === "secondary-storage") await deleteApiKey$1(ctx, apiKey, opts);
			else await ctx.context.adapter.delete({
				model: API_KEY_TABLE_NAME,
				where: [{
					field: "id",
					value: apiKey.id
				}]
			});
		};
		if (opts.deferUpdates) ctx.context.runInBackground(deleteExhaustedKey().catch((error) => {
			ctx.context.logger.error("Deferred update failed:", error);
		}));
		else await deleteExhaustedKey();
		throw APIError$1.from("TOO_MANY_REQUESTS", API_KEY_ERROR_CODES.USAGE_EXCEEDED);
	}
	return {
		apiKey: opts.storage === "database" || opts.storage === "secondary-storage" && opts.fallbackToDatabase ? await claimUsageInDatabase({
			ctx,
			apiKey,
			opts,
			hashedKey
		}) : await claimUsageInSecondaryStorage({
			ctx,
			apiKey,
			opts,
			hashedKey
		}),
		opts
	};
}
/**
* Atomically consume quota and a rate-limit slot against the database row, the
* source of truth for `database` and `secondary-storage` + `fallbackToDatabase`
* modes. Each guarded `incrementOne` only mutates the row while the guard still
* holds, so concurrent verifications cannot drive `remaining` below zero or push
* `requestCount` past the configured max. The cache (when present) is refreshed
* from the resulting row.
*/
async function claimUsageInDatabase({ ctx, apiKey, opts, hashedKey }) {
	let row = apiKey;
	if (apiKey.remaining !== null) row = await consumeRemaining(ctx, apiKey);
	row = await consumeRateLimit(ctx, row, opts);
	const finalRow = await ctx.context.adapter.update({
		model: API_KEY_TABLE_NAME,
		where: [{
			field: "id",
			value: row.id
		}],
		update: { updatedAt: /* @__PURE__ */ new Date() }
	});
	if (!finalRow) throw APIError$1.from("UNAUTHORIZED", API_KEY_ERROR_CODES.INVALID_API_KEY);
	if (opts.storage === "secondary-storage" && opts.fallbackToDatabase) await setApiKey(ctx, finalRow, opts);
	return finalRow;
}
/**
* Guarded quota consumption. When a refill is due, exactly one verification wins
* the refill (compare-and-swap on the observed `lastRefillAt`); any concurrent
* verification falls through to the plain guarded decrement against the refilled
* value. The decrement only applies while `remaining > 0`, so it can never go
* negative. Returns the updated row; throws when the quota is exhausted.
*/
async function consumeRemaining(ctx, apiKey) {
	const now = /* @__PURE__ */ new Date();
	const { refillInterval, refillAmount } = apiKey;
	if (refillInterval && refillAmount) {
		const lastTime = new Date(apiKey.lastRefillAt ?? apiKey.createdAt).getTime();
		if (now.getTime() - lastTime > refillInterval) {
			const refilled = await ctx.context.adapter.incrementOne({
				model: API_KEY_TABLE_NAME,
				where: [{
					field: "id",
					value: apiKey.id
				}, {
					field: "lastRefillAt",
					value: apiKey.lastRefillAt
				}],
				increment: {},
				set: {
					remaining: refillAmount - 1,
					lastRefillAt: now
				}
			});
			if (refilled) return refilled;
		}
	}
	const decremented = await ctx.context.adapter.incrementOne({
		model: API_KEY_TABLE_NAME,
		where: [{
			field: "id",
			value: apiKey.id
		}, {
			field: "remaining",
			operator: "gt",
			value: 0
		}],
		increment: { remaining: -1 }
	});
	if (!decremented) throw APIError$1.from("TOO_MANY_REQUESTS", API_KEY_ERROR_CODES.USAGE_EXCEEDED);
	return decremented;
}
/**
* Guarded rate-limit consumption. The common in-window path increments
* `requestCount` only while it is below the max (compare-and-swap), so a burst
* of concurrent verifications can never exceed the limit. Window resets and the
* first request in a window are guarded conditional sets; a request that loses
* every guard within an active window is rejected. Returns the updated row, or
* the unchanged row when rate limiting does not apply.
*/
async function consumeRateLimit(ctx, apiKey, opts) {
	const decision = evaluateRateLimit(apiKey, opts);
	if (decision.type === "deny") throw new APIError$1("TOO_MANY_REQUESTS", {
		message: decision.message,
		code: "RATE_LIMITED",
		details: { tryAgainIn: decision.tryAgainIn }
	});
	if (decision.type === "skip") {
		if (decision.lastRequest === null) return apiKey;
		return await ctx.context.adapter.update({
			model: "apikey",
			where: [{
				field: "id",
				value: apiKey.id
			}],
			update: { lastRequest: decision.lastRequest }
		}) ?? apiKey;
	}
	if (decision.type === "increment") {
		const incremented = await ctx.context.adapter.incrementOne({
			model: API_KEY_TABLE_NAME,
			where: [
				{
					field: "id",
					value: apiKey.id
				},
				{
					field: "lastRequest",
					operator: "gt",
					value: decision.windowStart
				},
				{
					field: "requestCount",
					operator: "lt",
					value: decision.max
				}
			],
			increment: { requestCount: 1 },
			set: { lastRequest: decision.now }
		});
		if (incremented) return incremented;
		const fresh = await ctx.context.adapter.findOne({
			model: API_KEY_TABLE_NAME,
			where: [{
				field: "id",
				value: apiKey.id
			}]
		});
		if (!fresh) throw APIError$1.from("UNAUTHORIZED", API_KEY_ERROR_CODES.INVALID_API_KEY);
		return consumeRateLimit(ctx, fresh, opts);
	}
	const windowGuard = decision.type === "reset" ? {
		field: "lastRequest",
		operator: "lte",
		value: decision.windowStart
	} : {
		field: "lastRequest",
		operator: "eq",
		value: null
	};
	const started = await ctx.context.adapter.incrementOne({
		model: API_KEY_TABLE_NAME,
		where: [{
			field: "id",
			value: apiKey.id
		}, windowGuard],
		increment: {},
		set: {
			requestCount: 1,
			lastRequest: decision.now
		}
	});
	if (started) return started;
	const fresh = await ctx.context.adapter.findOne({
		model: API_KEY_TABLE_NAME,
		where: [{
			field: "id",
			value: apiKey.id
		}]
	});
	if (!fresh) throw APIError$1.from("UNAUTHORIZED", API_KEY_ERROR_CODES.INVALID_API_KEY);
	return consumeRateLimit(ctx, fresh, opts);
}
/**
* Secondary-storage-only mode has no database row to guard, so quota and
* rate-limit consumption stays a read-modify-write merge over the serialized
* key. This is the residual non-atomic path; strict enforcement requires the
* database (use `fallbackToDatabase`) or an atomic secondary-storage primitive.
* FIXME(api-key-secondary-atomic): back this with SecondaryStorage.increment on
* `next` so secondary-storage-only mode enforces quota and rate limits atomically.
*/
async function claimUsageInSecondaryStorage({ ctx, apiKey, opts, hashedKey }) {
	let remaining = apiKey.remaining;
	let lastRefillAt = apiKey.lastRefillAt;
	if (remaining !== null) {
		const now = Date.now();
		const { refillInterval, refillAmount } = apiKey;
		const lastTime = new Date(lastRefillAt ?? apiKey.createdAt).getTime();
		if (refillInterval && refillAmount && now - lastTime > refillInterval) {
			remaining = refillAmount;
			lastRefillAt = /* @__PURE__ */ new Date();
		}
		if (remaining === 0) throw APIError$1.from("TOO_MANY_REQUESTS", API_KEY_ERROR_CODES.USAGE_EXCEEDED);
		remaining--;
	}
	const mutations = {
		...applyRateLimitToSnapshot(apiKey, opts),
		remaining,
		lastRefillAt,
		updatedAt: /* @__PURE__ */ new Date()
	};
	const performUpdate = async () => {
		const fresh = await getApiKey$1(ctx, hashedKey, opts);
		if (!fresh) return null;
		const merged = {
			...fresh,
			...mutations
		};
		await setApiKey(ctx, merged, opts);
		return merged;
	};
	if (opts.deferUpdates) {
		ctx.context.runInBackground(performUpdate().catch((error) => {
			ctx.context.logger.error("Failed to update API key:", error);
		}));
		return {
			...apiKey,
			...mutations
		};
	}
	const updated = await performUpdate();
	if (!updated) throw APIError$1.from("INTERNAL_SERVER_ERROR", API_KEY_ERROR_CODES.FAILED_TO_UPDATE_API_KEY);
	return updated;
}
/**
* Translate a rate-limit decision into a counter snapshot for the
* secondary-storage merge write. Denials throw before any write.
*/
function applyRateLimitToSnapshot(apiKey, opts) {
	const decision = evaluateRateLimit(apiKey, opts);
	switch (decision.type) {
		case "deny": throw new APIError$1("TOO_MANY_REQUESTS", {
			message: decision.message,
			code: "RATE_LIMITED",
			details: { tryAgainIn: decision.tryAgainIn }
		});
		case "skip": return decision.lastRequest === null ? {} : { lastRequest: decision.lastRequest };
		case "start":
		case "reset": return {
			lastRequest: decision.now,
			requestCount: 1
		};
		case "increment": return {
			lastRequest: decision.now,
			requestCount: apiKey.requestCount + 1
		};
	}
}
const verifyApiKeyBodySchema = z.object({
	configId: z.string().meta({ description: "Configuration ID to scope verification to. When omitted, the key is validated against its own configuration." }).optional(),
	key: z.string().meta({ description: "The key to verify" }),
	permissions: z.record(z.string(), z.array(z.string())).meta({ description: "The permissions to verify." }).optional()
});
function verifyApiKey({ configurations, schema, deleteAllExpiredApiKeys }) {
	return createAuthEndpoint.serverOnly({
		method: "POST",
		body: verifyApiKeyBodySchema
	}, async (ctx) => {
		const { configId, key } = ctx.body;
		const lookupOpts = resolveConfiguration(ctx.context, configurations, configId);
		if (configId !== void 0 && lookupOpts.customAPIKeyValidator) {
			if (!await lookupOpts.customAPIKeyValidator({
				ctx,
				key
			})) return ctx.json({
				valid: false,
				error: {
					message: API_KEY_ERROR_CODES.INVALID_API_KEY,
					code: "KEY_NOT_FOUND"
				},
				key: null
			});
		}
		let apiKey = null;
		let opts;
		try {
			const result = await validateApiKey({
				key,
				permissions: ctx.body.permissions,
				ctx,
				lookupOpts,
				configurations,
				schema,
				expectedConfigId: configId,
				runCustomValidator: configId === void 0
			});
			apiKey = result.apiKey;
			opts = result.opts;
			if (opts.deferUpdates) ctx.context.runInBackground(deleteAllExpiredApiKeys(ctx.context).catch((err) => {
				ctx.context.logger.error("Failed to delete expired API keys:", err);
			}));
		} catch (error) {
			ctx.context.logger.error("Failed to validate API key:", error);
			if (isAPIError(error)) return ctx.json({
				valid: false,
				error: {
					...error.body,
					message: error.body?.message,
					code: error.body?.code
				},
				key: null
			});
			return ctx.json({
				valid: false,
				error: {
					message: API_KEY_ERROR_CODES.INVALID_API_KEY,
					code: "INVALID_API_KEY"
				},
				key: null
			});
		}
		const { key: _, ...returningApiKey } = apiKey ?? {
			key: 1,
			permissions: void 0
		};
		let migratedMetadata = null;
		if (apiKey) migratedMetadata = await migrateDoubleStringifiedMetadata(ctx, apiKey, opts);
		returningApiKey.permissions = returningApiKey.permissions ? safeJSONParse(returningApiKey.permissions) : null;
		return ctx.json({
			valid: true,
			error: null,
			key: apiKey === null ? null : {
				...returningApiKey,
				metadata: migratedMetadata
			}
		});
	});
}
//#endregion
//#region src/routes/index.ts
function resolveConfiguration(authContext, configurations, configId) {
	const getDefaultConfig = () => {
		const defaultConfig = configurations.find((c) => !c.configId || c.configId === "default");
		if (!defaultConfig) {
			authContext.logger.error("No default api-key configuration found. Either provide an api-key configuration with configId 'default' or provide a configuration with no `configId` set.");
			const error = API_KEY_ERROR_CODES.NO_DEFAULT_API_KEY_CONFIGURATION_FOUND;
			throw APIError.from("BAD_REQUEST", error);
		}
		return {
			...defaultConfig,
			configId: "default"
		};
	};
	if (!configId) return getDefaultConfig();
	return configurations.find((c) => c.configId === configId) ?? getDefaultConfig();
}
/**
* Checks if a configId value represents the default configuration.
* Treats null, undefined, and "default" as equivalent (all are default).
* This handles backward compatibility for keys created before the configId field existed.
*/
function isDefaultConfigId(configId) {
	return !configId || configId === "default";
}
/**
* Checks if two configId values match, treating null/undefined as "default".
* This handles backward compatibility for keys created before the configId field existed.
*/
function configIdMatches(keyConfigId, expectedConfigId) {
	if (isDefaultConfigId(keyConfigId) && isDefaultConfigId(expectedConfigId)) return true;
	return keyConfigId === expectedConfigId;
}
let lastChecked = null;
async function deleteAllExpiredApiKeys(ctx, byPassLastCheckTime = false) {
	if (lastChecked && !byPassLastCheckTime) {
		if ((/* @__PURE__ */ new Date()).getTime() - lastChecked.getTime() < 1e4) return;
	}
	lastChecked = /* @__PURE__ */ new Date();
	await ctx.adapter.deleteMany({
		model: API_KEY_TABLE_NAME,
		where: [{
			field: "expiresAt",
			operator: "lt",
			value: /* @__PURE__ */ new Date()
		}, {
			field: "expiresAt",
			operator: "ne",
			value: null
		}]
	}).catch((error) => {
		ctx.logger.error(`Failed to delete expired API keys:`, error);
	});
}
function createApiKeyRoutes({ defaultKeyGenerator, configurations, schema }) {
	return {
		createApiKey: createApiKey({
			defaultKeyGenerator,
			configurations,
			schema,
			deleteAllExpiredApiKeys
		}),
		verifyApiKey: verifyApiKey({
			configurations,
			schema,
			deleteAllExpiredApiKeys
		}),
		getApiKey: getApiKey({
			configurations,
			schema,
			deleteAllExpiredApiKeys
		}),
		updateApiKey: updateApiKey({
			configurations,
			schema,
			deleteAllExpiredApiKeys
		}),
		deleteApiKey: deleteApiKey({
			configurations,
			schema,
			deleteAllExpiredApiKeys
		}),
		listApiKeys: listApiKeys({
			configurations,
			schema,
			deleteAllExpiredApiKeys
		}),
		deleteAllExpiredApiKeys: deleteAllExpiredApiKeysEndpoint({ deleteAllExpiredApiKeys })
	};
}
//#endregion
//#region src/schema.ts
const apiKeySchema = ({ defaultRateLimitMax, defaultTimeWindow }) => ({ apikey: { fields: {
	configId: {
		type: "string",
		required: true,
		defaultValue: "default",
		input: false,
		index: true
	},
	/**
	* The name of the key.
	*/
	name: {
		type: "string",
		required: false,
		input: false
	},
	/**
	* Shows the first few characters of the API key
	* This allows you to show those few characters in the UI to make it easier for users to identify the API key.
	*/
	start: {
		type: "string",
		required: false,
		input: false
	},
	/**
	* The ID of the entity that owns this key (userId or organizationId based on config's `references` setting).
	*/
	referenceId: {
		type: "string",
		required: true,
		input: false,
		index: true
	},
	/**
	* The prefix of the key.
	*/
	prefix: {
		type: "string",
		required: false,
		input: false
	},
	/**
	* The hashed key value.
	*/
	key: {
		type: "string",
		required: true,
		input: false,
		index: true
	},
	/**
	* The interval to refill the key in milliseconds.
	*/
	refillInterval: {
		type: "number",
		required: false,
		input: false
	},
	/**
	* The amount to refill the remaining count of the key.
	*/
	refillAmount: {
		type: "number",
		required: false,
		input: false
	},
	/**
	* The date and time when the key was last refilled.
	*/
	lastRefillAt: {
		type: "date",
		required: false,
		input: false
	},
	/**
	* Whether the key is enabled.
	*/
	enabled: {
		type: "boolean",
		required: false,
		input: false,
		defaultValue: true
	},
	/**
	* Whether the key has rate limiting enabled.
	*/
	rateLimitEnabled: {
		type: "boolean",
		required: false,
		input: false,
		defaultValue: true
	},
	/**
	* The time window in milliseconds for the rate limit.
	*/
	rateLimitTimeWindow: {
		type: "number",
		required: false,
		input: false,
		defaultValue: defaultTimeWindow
	},
	/**
	* The maximum number of requests allowed within the `rateLimitTimeWindow`.
	*/
	rateLimitMax: {
		type: "number",
		required: false,
		input: false,
		defaultValue: defaultRateLimitMax
	},
	/**
	* The number of requests made within the rate limit time window
	*/
	requestCount: {
		type: "number",
		required: false,
		input: false,
		defaultValue: 0
	},
	/**
	* The remaining number of requests before the key is revoked.
	*
	* If this is null, then the key is not revoked.
	*
	* If `refillInterval` & `refillAmount` are provided, than this will refill accordingly.
	*/
	remaining: {
		type: "number",
		required: false,
		input: false
	},
	/**
	* The date and time of the last request made to the key.
	*/
	lastRequest: {
		type: "date",
		required: false,
		input: false
	},
	/**
	* The date and time when the key will expire.
	*/
	expiresAt: {
		type: "date",
		required: false,
		input: false
	},
	/**
	* The date and time when the key was created.
	*/
	createdAt: {
		type: "date",
		required: true,
		input: false
	},
	/**
	* The date and time when the key was last updated.
	*/
	updatedAt: {
		type: "date",
		required: true,
		input: false
	},
	/**
	* The permissions of the key.
	*/
	permissions: {
		type: "string",
		required: false,
		input: false
	},
	/**
	* Any additional metadata you want to store with the key.
	*/
	metadata: {
		type: "string",
		required: false,
		input: true,
		transform: {
			input(value) {
				return JSON.stringify(value);
			},
			output(value) {
				if (!value) return null;
				return parseJSON(value);
			}
		}
	}
} } });
//#endregion
//#region src/index.ts
const defaultKeyHasher = async (key) => {
	const hash = await createHash("SHA-256").digest(new TextEncoder().encode(key));
	return base64Url.encode(new Uint8Array(hash), { padding: false });
};
const API_KEY_TABLE_NAME = "apikey";
function apiKey(_configurations, _options) {
	if (Array.isArray(_configurations) && _configurations.length > 0) {
		if (!_configurations.every((option) => option.configId)) throw new BetterAuthError("configId is required for each API key configuration in the api-key plugin.");
		const configIds = _configurations.map((option) => option.configId);
		if (new Set(configIds).size !== configIds.length) throw new BetterAuthError("configId must be unique for each API key configuration in the api-key plugin.");
	}
	const options = _options ?? { schema: Array.isArray(_configurations) ? void 0 : _configurations?.schema };
	const configurations = [...(Array.isArray(_configurations) ? _configurations : [_configurations]).map((config) => ({
		...config,
		apiKeyHeaders: config?.apiKeyHeaders ?? "x-api-key",
		defaultKeyLength: config?.defaultKeyLength || 64,
		maximumPrefixLength: config?.maximumPrefixLength ?? 32,
		minimumPrefixLength: config?.minimumPrefixLength ?? 1,
		maximumNameLength: config?.maximumNameLength ?? 32,
		minimumNameLength: config?.minimumNameLength ?? 1,
		enableMetadata: config?.enableMetadata ?? false,
		disableKeyHashing: config?.disableKeyHashing ?? false,
		requireName: config?.requireName ?? false,
		storage: config?.storage ?? "database",
		rateLimit: {
			enabled: config?.rateLimit?.enabled === void 0 ? true : config?.rateLimit?.enabled,
			timeWindow: config?.rateLimit?.timeWindow ?? 1e3 * 60 * 60 * 24,
			maxRequests: config?.rateLimit?.maxRequests ?? 10
		},
		keyExpiration: {
			defaultExpiresIn: config?.keyExpiration?.defaultExpiresIn ?? null,
			disableCustomExpiresTime: config?.keyExpiration?.disableCustomExpiresTime ?? false,
			maxExpiresIn: config?.keyExpiration?.maxExpiresIn ?? 365,
			minExpiresIn: config?.keyExpiration?.minExpiresIn ?? 1
		},
		startingCharactersConfig: {
			shouldStore: config?.startingCharactersConfig?.shouldStore ?? true,
			charactersLength: config?.startingCharactersConfig?.charactersLength ?? 6
		},
		enableSessionForAPIKeys: config?.enableSessionForAPIKeys ?? false,
		fallbackToDatabase: config?.fallbackToDatabase ?? false,
		customStorage: config?.customStorage,
		deferUpdates: config?.deferUpdates ?? false
	}))];
	const schema = mergeSchema(apiKeySchema({
		defaultRateLimitMax: (configurations.length === 1 ? configurations[0]?.rateLimit.maxRequests : void 0) ?? 10,
		defaultTimeWindow: (configurations.length === 1 ? configurations[0]?.rateLimit.timeWindow : void 0) ?? 1e3 * 60 * 60 * 24
	}), options.schema);
	const defaultKeyGenerator = async (opts) => {
		const key = generateRandomString(opts.length, "a-z", "A-Z");
		return `${opts.prefix || ""}${key}`;
	};
	function getApiKeyFromConfig(ctx, config) {
		if (config.customAPIKeyGetter) return config.customAPIKeyGetter(ctx);
		if (Array.isArray(config.apiKeyHeaders)) {
			for (const header of config.apiKeyHeaders) {
				const value = ctx.headers?.get(header);
				if (value) return value;
			}
			return null;
		}
		return ctx.headers?.get(config.apiKeyHeaders) ?? null;
	}
	function findApiKeyAndConfig(ctx) {
		for (const config of configurations) {
			if (!config.enableSessionForAPIKeys) continue;
			const key = getApiKeyFromConfig(ctx, config);
			if (key) return {
				key,
				config
			};
		}
		return null;
	}
	const routes = createApiKeyRoutes({
		defaultKeyGenerator,
		configurations,
		schema
	});
	return {
		id: "api-key",
		version: PACKAGE_VERSION,
		$ERROR_CODES: API_KEY_ERROR_CODES,
		hooks: { before: [{
			matcher: (ctx) => !!findApiKeyAndConfig(ctx),
			handler: createAuthMiddleware(async (ctx) => {
				const { key, config } = findApiKeyAndConfig(ctx);
				if (typeof key !== "string") throw APIError.from("BAD_REQUEST", API_KEY_ERROR_CODES.INVALID_API_KEY_GETTER_RETURN_TYPE);
				if (key.length < config.defaultKeyLength) throw APIError.from("FORBIDDEN", API_KEY_ERROR_CODES.INVALID_API_KEY);
				if (config.customAPIKeyValidator) {
					if (!await config.customAPIKeyValidator({
						ctx,
						key
					})) throw APIError.from("FORBIDDEN", API_KEY_ERROR_CODES.INVALID_API_KEY);
				}
				const { apiKey } = await validateApiKey({
					key,
					ctx,
					lookupOpts: config,
					configurations,
					schema,
					expectedConfigId: config.configId
				});
				const cleanupTask = deleteAllExpiredApiKeys(ctx.context).catch((err) => {
					ctx.context.logger.error("Failed to delete expired API keys:", err);
				});
				if (config.deferUpdates) ctx.context.runInBackground(cleanupTask);
				if ((config.references ?? "user") !== "user") {
					const msg = API_KEY_ERROR_CODES.INVALID_REFERENCE_ID_FROM_API_KEY;
					throw APIError.from("UNAUTHORIZED", msg);
				}
				const user = await ctx.context.internalAdapter.findUserById(apiKey.referenceId);
				if (!user) {
					const msg = API_KEY_ERROR_CODES.INVALID_REFERENCE_ID_FROM_API_KEY;
					throw APIError.from("UNAUTHORIZED", msg);
				}
				const session = {
					user,
					session: {
						id: apiKey.id,
						token: key,
						userId: apiKey.referenceId,
						userAgent: ctx.request?.headers.get("user-agent") ?? null,
						ipAddress: ctx.request ? getIP(ctx.request, ctx.context.options) : null,
						createdAt: /* @__PURE__ */ new Date(),
						updatedAt: /* @__PURE__ */ new Date(),
						expiresAt: apiKey.expiresAt || getDate(ctx.context.options.session?.expiresIn || 3600 * 24 * 7, "ms")
					}
				};
				ctx.context.session = session;
				if (ctx.path === "/get-session") return session;
				else return { context: ctx };
			})
		}] },
		endpoints: {
			/**
			* ### Endpoint
			*
			* POST `/api-key/create`
			*
			* ### API Methods
			*
			* **server:**
			* `auth.api.createApiKey`
			*
			* **client:**
			* `authClient.apiKey.create`
			*
			* @see [Read our docs to learn more.](https://better-auth.com/docs/plugins/api-key#api-method-api-key-create)
			*/
			createApiKey: routes.createApiKey,
			/**
			* ### Endpoint
			*
			* POST `/api-key/verify`
			*
			* ### API Methods
			*
			* **server:**
			* `auth.api.verifyApiKey`
			*
			* @see [Read our docs to learn more.](https://better-auth.com/docs/plugins/api-key#api-method-api-key-verify)
			*/
			verifyApiKey: routes.verifyApiKey,
			/**
			* ### Endpoint
			*
			* GET `/api-key/get`
			*
			* ### API Methods
			*
			* **server:**
			* `auth.api.getApiKey`
			*
			* **client:**
			* `authClient.apiKey.get`
			*
			* @see [Read our docs to learn more.](https://better-auth.com/docs/plugins/api-key#api-method-api-key-get)
			*/
			getApiKey: routes.getApiKey,
			/**
			* ### Endpoint
			*
			* POST `/api-key/update`
			*
			* ### API Methods
			*
			* **server:**
			* `auth.api.updateApiKey`
			*
			* **client:**
			* `authClient.apiKey.update`
			*
			* @see [Read our docs to learn more.](https://better-auth.com/docs/plugins/api-key#api-method-api-key-update)
			*/
			updateApiKey: routes.updateApiKey,
			/**
			* ### Endpoint
			*
			* POST `/api-key/delete`
			*
			* ### API Methods
			*
			* **server:**
			* `auth.api.deleteApiKey`
			*
			* **client:**
			* `authClient.apiKey.delete`
			*
			* @see [Read our docs to learn more.](https://better-auth.com/docs/plugins/api-key#api-method-api-key-delete)
			*/
			deleteApiKey: routes.deleteApiKey,
			/**
			* ### Endpoint
			*
			* GET `/api-key/list`
			*
			* ### API Methods
			*
			* **server:**
			* `auth.api.listApiKeys`
			*
			* **client:**
			* `authClient.apiKey.list`
			*
			* @see [Read our docs to learn more.](https://better-auth.com/docs/plugins/api-key#api-method-api-key-list)
			*/
			listApiKeys: routes.listApiKeys,
			/**
			* ### Endpoint
			*
			* POST `/api-key/delete-all-expired-api-keys`
			*
			* ### API Methods
			*
			* **server:**
			* `auth.api.deleteAllExpiredApiKeys`
			*
			* @see [Read our docs to learn more.](https://better-auth.com/docs/plugins/api-key#api-method-api-key-delete-all-expired-api-keys)
			*/
			deleteAllExpiredApiKeys: routes.deleteAllExpiredApiKeys
		},
		schema
	};
}
//#endregion
export { API_KEY_ERROR_CODES, API_KEY_TABLE_NAME, apiKey, defaultKeyHasher };
