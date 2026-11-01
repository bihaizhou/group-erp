import { n as safeParse, t as safeStringify } from "./main-CgduzMv7.js";
import { n as createNaturalSort, r as naturalSort, t as isScriptFile } from "./is_script_file-DECAVJWd.js";
import { RuntimeException } from "./modules/exception.js";
import { flattie } from "flattie";
import { Buffer } from "node:buffer";
import { createHash, timingSafeEqual } from "node:crypto";
import { basename, isAbsolute, relative, sep } from "node:path";
import string from "@poppinss/string";
import lodash from "@poppinss/utils/lodash";
import { promisify } from "node:util";
import { realpath } from "node:fs/promises";
import { execFile } from "node:child_process";
//#region src/secret.ts
const REDACTED = "[redacted]";
/**
* Define a Secret value that hides itself from the logs or the console
* statements.
*
* The idea is to prevent accidental leaking of sensitive information.
* Idea borrowed from.
* https://transcend.io/blog/keep-sensitive-values-out-of-your-logs-with-types
*/
var Secret = class Secret {
	/** The secret value */
	#value;
	#keyword;
	constructor(value, redactedKeyword) {
		this.#value = value;
		this.#keyword = redactedKeyword || REDACTED;
	}
	toJSON() {
		return this.#keyword;
	}
	valueOf() {
		return this.#keyword;
	}
	[Symbol.for("nodejs.util.inspect.custom")]() {
		return this.#keyword;
	}
	toLocaleString() {
		return this.#keyword;
	}
	toString() {
		return this.#keyword;
	}
	/**
	* Returns the original value
	*/
	release() {
		return this.#value;
	}
	/**
	* Transform the original value and create a new
	* secret from it.
	*/
	map(transformFunc) {
		return new Secret(transformFunc(this.#value));
	}
};
//#endregion
//#region src/compose.ts
function compose(superclass, ...mixins) {
	return mixins.reduce((c, mixin) => mixin(c), superclass);
}
//#endregion
//#region src/flatten.ts
/**
* Recursively flatten an object/array.
*/
function flatten(input, glue, keepNullish) {
	return flattie(input, glue, keepNullish);
}
//#endregion
//#region src/unique.ts
/**
* Return a new array with duplicate values removed while preserving order.
*/
function unique(values) {
	return Array.from(new Set(values));
}
//#endregion
//#region src/safe_equal.ts
/**
* Compare two values to see if they are equal. The comparison is done in
* a way to avoid timing-attacks.
*/
function safeEqual(trustedValue, userInput) {
	if (typeof trustedValue === "string" && typeof userInput === "string") {
		/**
		* The length of the comparison value.
		*/
		const trustedLength = Buffer.byteLength(trustedValue);
		/**
		* Expected value
		*/
		const trustedValueBuffer = Buffer.alloc(trustedLength, 0, "utf-8");
		trustedValueBuffer.write(trustedValue);
		/**
		* Actual value (taken from user input)
		*/
		const userValueBuffer = Buffer.alloc(trustedLength, 0, "utf-8");
		userValueBuffer.write(userInput);
		/**
		* Ensure values are same and also have same length
		*/
		return timingSafeEqual(trustedValueBuffer, userValueBuffer) && trustedLength === Buffer.byteLength(userInput);
	}
	return timingSafeEqual(Buffer.from(trustedValue), Buffer.from(userInput));
}
//#endregion
//#region src/import_default.ts
/**
* Dynamically import a module and ensure it has a default export
*/
async function importDefault(importFn, filePath) {
	const moduleExports = await importFn();
	/**
	* Make sure a default export exists
	*/
	if (!("default" in moduleExports)) {
		const errorMessage = filePath ? `Missing "export default" in module "${filePath}"` : `Missing "export default" from lazy import "${importFn}"`;
		throw new RuntimeException(errorMessage, { cause: { source: importFn } });
	}
	return moduleExports.default;
}
//#endregion
//#region src/message_builder.ts
/**
* Message builder exposes an API to "JSON.stringify" values by
* encoding purpose and expiry date inside them.
*
* The return value must be further encrypted to prevent tempering.
*/
var MessageBuilder = class {
	#getExpiryDate(expiresIn) {
		if (!expiresIn) return;
		const expiryMs = string.milliseconds.parse(expiresIn);
		return new Date(Date.now() + expiryMs);
	}
	/**
	* Returns a boolean telling, if message has been expired or not
	*/
	#isExpired(message) {
		if (!message.expiryDate) return false;
		const expiryDate = new Date(message.expiryDate);
		return Number.isNaN(expiryDate.getTime()) || expiryDate < /* @__PURE__ */ new Date();
	}
	/**
	* Builds a message by encoding expiry date and purpose inside it.
	*/
	build(message, expiresIn, purpose) {
		const expiryDate = this.#getExpiryDate(expiresIn);
		return safeStringify({
			message,
			purpose,
			expiryDate
		});
	}
	/**
	* Verifies the message for expiry and purpose.
	*/
	verify(message, purpose) {
		const parsed = safeParse(message);
		/**
		* After JSON.parse we do not receive a valid object
		*/
		if (typeof parsed !== "object" || !parsed) return null;
		/**
		* Missing ".message" property
		*/
		if (!parsed.message) return null;
		/**
		* Ensure purposes are same.
		*/
		if (parsed.purpose !== purpose) return null;
		/**
		* Ensure isn't expired
		*/
		if (this.#isExpired(parsed)) return null;
		return parsed.message;
	}
};
//#endregion
//#region src/imports_bag.ts
/**
* ImportsBag manages and deduplicates imports from the same source
*/
var ImportsBag = class {
	/**
	* Map of source to ImportInfo
	*/
	#imports = /* @__PURE__ */ new Map();
	/**
	* Generate import statement from ImportInfo
	*/
	#generateImportStatement(imp) {
		const parts = [];
		if (imp.defaultImport || imp.namedImports && imp.namedImports.length > 0) {
			const importParts = [];
			if (imp.defaultImport) importParts.push(imp.defaultImport);
			if (imp.namedImports && imp.namedImports.length > 0) importParts.push(`{ ${imp.namedImports.join(", ")} }`);
			parts.push(`import ${importParts.join(", ")} from '${imp.source}'`);
		}
		if (imp.defaultTypeImport || imp.typeImports && imp.typeImports.length > 0) {
			const typeImportParts = [];
			if (imp.defaultTypeImport) typeImportParts.push(imp.defaultTypeImport);
			if (imp.typeImports && imp.typeImports.length > 0) typeImportParts.push(`{ ${imp.typeImports.join(", ")} }`);
			parts.push(`import type ${typeImportParts.join(", ")} from '${imp.source}'`);
		}
		return parts.join("\n");
	}
	/**
	* Add an import to the bag
	*/
	add(importInfo) {
		const existing = this.#imports.get(importInfo.source);
		if (existing) {
			/**
			* Set default import (replaces existing if present)
			*/
			if (importInfo.defaultImport) existing.defaultImport = importInfo.defaultImport;
			/**
			* Set default type import (replaces existing if present)
			*/
			if (importInfo.defaultTypeImport) existing.defaultTypeImport = importInfo.defaultTypeImport;
			/**
			* Merge named imports without deduplication (deduplication happens in toArray)
			*/
			if (importInfo.namedImports) {
				if (!existing.namedImports) existing.namedImports = [];
				existing.namedImports.push(...importInfo.namedImports);
			}
			/**
			* Merge type imports without deduplication (deduplication happens in toArray)
			*/
			if (importInfo.typeImports) {
				if (!existing.typeImports) existing.typeImports = [];
				existing.typeImports.push(...importInfo.typeImports);
			}
		} else this.#imports.set(importInfo.source, {
			source: importInfo.source,
			defaultImport: importInfo.defaultImport,
			defaultTypeImport: importInfo.defaultTypeImport,
			namedImports: importInfo.namedImports ? [...importInfo.namedImports] : void 0,
			typeImports: importInfo.typeImports ? [...importInfo.typeImports] : void 0
		});
		return this;
	}
	/**
	* Get deduplicated imports as an array
	*/
	toArray() {
		return Array.from(this.#imports.values()).map((imp) => ({
			source: imp.source,
			defaultImport: imp.defaultImport,
			defaultTypeImport: imp.defaultTypeImport,
			namedImports: imp.namedImports ? unique(imp.namedImports) : void 0,
			typeImports: imp.typeImports ? unique(imp.typeImports) : void 0
		}));
	}
	/**
	* Get deduplicated imports as a formatted string
	*/
	toString() {
		return this.toArray().map((imp) => this.#generateImportStatement(imp)).join("\n");
	}
};
//#endregion
//#region src/define_static_property.ts
/**
* Define static properties on a class with inheritance in play.
*/
function defineStaticProperty(self, propertyName, { initialValue, strategy }) {
	if (!self.hasOwnProperty(propertyName)) {
		const value = self[propertyName];
		/**
		* Define the property as it is when the strategy is set
		* to "define". Or the value on the prototype chain
		* is set to undefined.
		*/
		if (strategy === "define" || value === void 0) {
			Object.defineProperty(self, propertyName, {
				value: initialValue,
				configurable: true,
				enumerable: true,
				writable: true
			});
			return;
		}
		Object.defineProperty(self, propertyName, {
			value: typeof strategy === "function" ? strategy(value) : lodash.cloneDeep(value),
			configurable: true,
			enumerable: true,
			writable: true
		});
	}
}
//#endregion
//#region src/detect_ai_agent.ts
/**
* Detects which AI coding agent the code is running under.
* Checks for environment variables set by different AI coding assistants:
* - CLAUDECODE='1' for Claude Code
* - GEMINI_CLI='1' for Gemini
* - GITHUB_COPILOT_CLI_MODE='1' for GitHub Copilot
* - WINDSURF_SESSION='1' or TERM_PROGRAM='windsurf' for Windsurf
* - CODEX_CLI='1' or CODEX_SANDBOX='1' for Codex
* - OPENCODE='1' for OpenCode
* - CURSOR_AGENT='1' for Cursor
*/
function detectAIAgent() {
	if (process.env.CLAUDECODE === "1") return "claude";
	if (process.env.GEMINI_CLI === "1") return "gemini";
	if (process.env.GITHUB_COPILOT_CLI_MODE === "1") return "copilot";
	if (process.env.WINDSURF_SESSION === "1" || process.env.TERM_PROGRAM === "windsurf") return "windsurf";
	if (process.env.CODEX_CLI === "1" || process.env.CODEX_SANDBOX === "1") return "codex";
	if (process.env.OPENCODE === "1") return "opencode";
	if (process.env.CURSOR_AGENT === "1") return "cursor";
	return null;
}
/**
* Returns true if the code is running within any AI coding agent.
*/
function isRunningInAIAgent() {
	return detectAIAgent() !== null;
}
//#endregion
//#region src/get_git_worktree.ts
const execFileAsync = promisify(execFile);
/**
* Returns true when the target path is inside the parent path.
*/
function isPathInside(parent, target) {
	const relativePath = relative(parent, target);
	return relativePath === "" || relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath);
}
/**
* Returns information about the linked Git worktree containing the given
* directory. Returns null for the main worktree and directories outside a
* Git repository.
*/
async function getGitWorktree(cwd = process.cwd()) {
	try {
		const [{ stdout }, resolvedCwd] = await Promise.all([execFileAsync("git", [
			"worktree",
			"list",
			"--porcelain",
			"-z"
		], {
			cwd,
			encoding: "utf8",
			windowsHide: true
		}), realpath(cwd)]);
		const worktreePaths = stdout.split("\0").filter((field) => field.startsWith("worktree ")).map((field) => field.slice(9));
		const currentWorktree = (await Promise.all(worktreePaths.map(async (worktreePath, index) => {
			try {
				return {
					index,
					path: await realpath(worktreePath)
				};
			} catch {
				return null;
			}
		}))).filter((worktree) => {
			return worktree !== null && isPathInside(worktree.path, resolvedCwd);
		}).sort((current, next) => next.path.length - current.path.length)[0];
		if (!currentWorktree || currentWorktree.index === 0) return null;
		const name = basename(currentWorktree.path);
		const hash = createHash("sha256").update(currentWorktree.path).digest("hex").slice(0, 12);
		return {
			name,
			hash,
			path: currentWorktree.path,
			slug: string.slug(name, {
				lower: true,
				strict: true
			}) || `worktree-${hash}`
		};
	} catch {
		return null;
	}
}
//#endregion
export { ImportsBag, MessageBuilder, Secret, compose, createNaturalSort, defineStaticProperty, detectAIAgent, flatten, getGitWorktree, importDefault, isRunningInAIAgent, isScriptFile, naturalSort, safeEqual, unique };
