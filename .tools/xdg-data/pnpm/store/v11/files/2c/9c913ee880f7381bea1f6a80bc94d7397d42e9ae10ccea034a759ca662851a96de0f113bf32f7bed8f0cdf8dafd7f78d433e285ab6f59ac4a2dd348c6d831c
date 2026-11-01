import { t as string } from "./string-DVIVpZLG.js";
import { extname } from "node:path";
//#region string_builder.ts
/**
* StringBuilder exposes a fluent API to transform a string value
*/
var StringBuilder = class {
	#value;
	constructor(value) {
		this.#value = typeof value === "string" ? value : value.toString();
	}
	/**
	* Applies dash case transformation
	*/
	dashCase() {
		this.#value = string.dashCase(this.#value);
		return this;
	}
	/**
	* Applies dot case transformation
	*/
	dotCase() {
		this.#value = string.dotCase(this.#value);
		return this;
	}
	/**
	* Applies snake case transformation
	*/
	snakeCase() {
		this.#value = string.snakeCase(this.#value);
		return this;
	}
	/**
	* Applies pascal case transformation
	*/
	pascalCase() {
		this.#value = string.pascalCase(this.#value);
		return this;
	}
	/**
	* Applies camelcase case transformation
	*/
	camelCase() {
		this.#value = string.camelCase(this.#value);
		return this;
	}
	/**
	* Applies capital case transformation
	*/
	capitalCase() {
		this.#value = string.capitalCase(this.#value);
		return this;
	}
	/**
	* Applies title case transformation
	*/
	titleCase() {
		this.#value = string.titleCase(this.#value);
		return this;
	}
	/**
	* Applies sentence case transformation
	*/
	sentenceCase() {
		this.#value = string.sentenceCase(this.#value);
		return this;
	}
	/**
	* Removes all sorts of casing from the string
	*/
	noCase() {
		this.#value = string.noCase(this.#value);
		return this;
	}
	/**
	* Converts value to its plural form
	*/
	plural() {
		this.#value = string.pluralize(this.#value);
		return this;
	}
	/**
	* Converts value to its singular form
	*/
	singular() {
		this.#value = string.singular(this.#value);
		return this;
	}
	/**
	* Converts value to a URL friendly slug
	*/
	slugify() {
		this.#value = string.slug(this.#value);
		return this;
	}
	/**
	* Removes a given suffix from the string
	*/
	removeSuffix(suffix, options) {
		/**
		* Do not substitue when the value ends with one of the similar words
		*/
		if (options?.similarWords && options.similarWords.some((word) => new RegExp(`[-_]?${word}$`, "i").test(this.#value))) return this;
		this.#value = this.#value.replace(new RegExp(`[-_]?${suffix}$`, "i"), "");
		return this;
	}
	/**
	* Adds suffix to the string
	*/
	suffix(suffix, options) {
		this.removeSuffix(suffix, options);
		this.#value = `${this.#value}${suffix}`;
		return this;
	}
	/**
	* Removes a given prefix from the string
	*/
	removePrefix(prefix, options) {
		/**
		* Do not substitue when the value starts with one of the similar words
		*/
		if (options?.similarWords && options.similarWords.some((word) => new RegExp(`^${word}[-_]?`, "i").test(this.#value))) return this;
		this.#value = this.#value.replace(new RegExp(`^${prefix}[-_]?`, "i"), "");
		return this;
	}
	/**
	* Adds prefix to the string
	*/
	prefix(prefix) {
		this.removePrefix(prefix);
		this.#value = `${prefix}${this.#value}`;
		return this;
	}
	/**
	* Removes extension from the value
	*/
	removeExtension() {
		this.#value = this.#value.replace(new RegExp(`${extname(this.#value)}$`), "");
		return this;
	}
	/**
	* Adds extension to the value
	*/
	ext(extension) {
		this.removeExtension();
		this.#value = `${this.#value}.${extension.replace(/^\./, "")}`;
		return this;
	}
	/**
	* Convert slashes to unix slash
	*/
	toUnixSlash() {
		this.#value = string.toUnixSlash(this.#value);
		return this;
	}
	toString() {
		return this.#value;
	}
};
//#endregion
export { StringBuilder as default };
