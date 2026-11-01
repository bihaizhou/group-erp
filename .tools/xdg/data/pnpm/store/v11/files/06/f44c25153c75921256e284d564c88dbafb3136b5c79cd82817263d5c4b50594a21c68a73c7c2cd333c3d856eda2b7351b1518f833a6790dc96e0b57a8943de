import { randomBytes, randomUUID } from "node:crypto";
import slugifyPkg from "slugify";
import pluralizePkg from "pluralize";
import * as changeCase from "case-anything";
//#region \0rolldown/runtime.js
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJSMin = (cb, mod) => () => (mod || (cb((mod = { exports: {} }).exports, mod), cb = null), mod.exports);
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));
//#endregion
//#region src/bytes.ts
var import_bytes = /* @__PURE__ */ __toESM((/* @__PURE__ */ __commonJSMin(((exports, module) => {
	/**
	* Module exports.
	* @public
	*/
	module.exports = bytes;
	module.exports.format = format;
	module.exports.parse = parse;
	/**
	* Module variables.
	* @private
	*/
	var formatThousandsRegExp = /\B(?=(\d{3})+(?!\d))/g;
	var formatDecimalsRegExp = /(?:\.0*|(\.[^0]+)0+)$/;
	var map = {
		b: 1,
		kb: 1024,
		mb: 1 << 20,
		gb: 1 << 30,
		tb: Math.pow(1024, 4),
		pb: Math.pow(1024, 5)
	};
	var parseRegExp = /^((-|\+)?(\d+(?:\.\d+)?)) *(kb|mb|gb|tb|pb)$/i;
	/**
	* Convert the given value in bytes into a string or parse to string to an integer in bytes.
	*
	* @param {string|number} value
	* @param {{
	*  case: [string],
	*  decimalPlaces: [number]
	*  fixedDecimals: [boolean]
	*  thousandsSeparator: [string]
	*  unitSeparator: [string]
	*  }} [options] bytes options.
	*
	* @returns {string|number|null}
	*/
	function bytes(value, options) {
		if (typeof value === "string") return parse(value);
		if (typeof value === "number") return format(value, options);
		return null;
	}
	/**
	* Format the given value in bytes into a string.
	*
	* If the value is negative, it is kept as such. If it is a float,
	* it is rounded.
	*
	* @param {number} value
	* @param {object} [options]
	* @param {number} [options.decimalPlaces=2]
	* @param {number} [options.fixedDecimals=false]
	* @param {string} [options.thousandsSeparator=]
	* @param {string} [options.unit=]
	* @param {string} [options.unitSeparator=]
	*
	* @returns {string|null}
	* @public
	*/
	function format(value, options) {
		if (!Number.isFinite(value)) return null;
		var mag = Math.abs(value);
		var thousandsSeparator = options && options.thousandsSeparator || "";
		var unitSeparator = options && options.unitSeparator || "";
		var decimalPlaces = options && options.decimalPlaces !== void 0 ? options.decimalPlaces : 2;
		var fixedDecimals = Boolean(options && options.fixedDecimals);
		var unit = options && options.unit || "";
		if (!unit || !map[unit.toLowerCase()]) if (mag >= map.pb) unit = "PB";
		else if (mag >= map.tb) unit = "TB";
		else if (mag >= map.gb) unit = "GB";
		else if (mag >= map.mb) unit = "MB";
		else if (mag >= map.kb) unit = "KB";
		else unit = "B";
		var str = (value / map[unit.toLowerCase()]).toFixed(decimalPlaces);
		if (!fixedDecimals) str = str.replace(formatDecimalsRegExp, "$1");
		if (thousandsSeparator) str = str.split(".").map(function(s, i) {
			return i === 0 ? s.replace(formatThousandsRegExp, thousandsSeparator) : s;
		}).join(".");
		return str + unitSeparator + unit;
	}
	/**
	* Parse the string value into an integer in bytes.
	*
	* If no unit is given, it is assumed the value is in bytes.
	*
	* @param {number|string} val
	*
	* @returns {number|null}
	* @public
	*/
	function parse(val) {
		if (typeof val === "number" && !isNaN(val)) return val;
		if (typeof val !== "string") return null;
		var results = parseRegExp.exec(val);
		var floatValue;
		var unit = "b";
		if (!results) {
			floatValue = parseInt(val, 10);
			unit = "b";
		} else {
			floatValue = parseFloat(results[1]);
			unit = results[4].toLowerCase();
		}
		if (isNaN(floatValue)) return null;
		return Math.floor(map[unit] * floatValue);
	}
})))(), 1);
var bytes_default = {
	format(valueInBytes, options) {
		return import_bytes.default.format(valueInBytes, options);
	},
	parse(unit) {
		if (typeof unit === "number") return unit;
		return import_bytes.default.parse(unit);
	}
};
//#endregion
//#region src/uuid.ts
let uuidGenerator = randomUUID;
/**
* Generate a UUID v4 string
*/
function uuid(options) {
	return uuidGenerator(options);
}
/**
* Specify a custom method for generating the UUID value
*/
uuid.use = function uuidUse(generator) {
	uuidGenerator = generator;
};
uuid.restore = function uuidRestore() {
	uuidGenerator = randomUUID;
};
//#endregion
//#region node_modules/@lukeed/ms/dist/index.mjs
var RGX = /^(-?(?:\d+)?\.?\d+) *(m(?:illiseconds?|s(?:ecs?)?))?(s(?:ec(?:onds?|s)?)?)?(m(?:in(?:utes?|s)?)?)?(h(?:ours?|rs?)?)?(d(?:ays?)?)?(w(?:eeks?|ks?)?)?(y(?:ears?|rs?)?)?$/, SEC = 1e3, MIN = SEC * 60, HOUR = MIN * 60, DAY = HOUR * 24, YEAR = DAY * 365.25;
function parse(val) {
	var num, arr = val.toLowerCase().match(RGX);
	if (arr != null && (num = parseFloat(arr[1]))) {
		if (arr[3] != null) return num * SEC;
		if (arr[4] != null) return num * MIN;
		if (arr[5] != null) return num * HOUR;
		if (arr[6] != null) return num * DAY;
		if (arr[7] != null) return num * DAY * 7;
		if (arr[8] != null) return num * YEAR;
		return num;
	}
}
function fmt(val, pfx, str, long) {
	var num = (val | 0) === val ? val : ~~(val + .5);
	return pfx + num + (long ? " " + str + (num != 1 ? "s" : "") : str[0]);
}
function format(num, long) {
	var pfx = num < 0 ? "-" : "", abs = num < 0 ? -num : num;
	if (abs < SEC) return num + (long ? " ms" : "ms");
	if (abs < MIN) return fmt(abs / SEC, pfx, "second", long);
	if (abs < HOUR) return fmt(abs / MIN, pfx, "minute", long);
	if (abs < DAY) return fmt(abs / HOUR, pfx, "hour", long);
	if (abs < YEAR) return fmt(abs / DAY, pfx, "day", long);
	return fmt(abs / YEAR, pfx, "year", long);
}
//#endregion
//#region src/seconds.ts
var seconds_default = {
	format(seconds, long) {
		return format(seconds * 1e3, long);
	},
	parse(duration) {
		if (typeof duration === "number") return duration;
		const milliseconds = parse(duration);
		if (milliseconds === void 0) throw new Error(`Invalid duration expression "${duration}"`);
		return Math.floor(milliseconds / 1e3);
	}
};
//#endregion
//#region src/slugify.ts
/**
* Typings of the slugify package are a bit off and therefore we have
* to do this manual dance of re-assigning types
*/
const slug = slugifyPkg;
//#endregion
//#region src/random.ts
/**
* Default implementation
*/
const defaultGenerator = (size) => {
	const bits = (size + 1) * 6;
	const buffer = randomBytes(Math.ceil(bits / 8));
	return Buffer.from(buffer).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/\=/g, "").slice(0, size);
};
let randomGenerator = defaultGenerator;
/**
* Generates a URL safe random string of a given size
*/
function random(size) {
	return randomGenerator(size);
}
/**
* Specify a custom method for generating the random value
*/
random.use = function randomUse(generator) {
	randomGenerator = generator;
};
random.restore = function randomRestore() {
	randomGenerator = defaultGenerator;
};
//#endregion
//#region src/excerpt.ts
var import_truncatise = /* @__PURE__ */ __toESM((/* @__PURE__ */ __commonJSMin(((exports, module) => {
	(function(exportTo) {
		"use strict";
		var selfClosingTags = [
			"area",
			"base",
			"br",
			"col",
			"embed",
			"hr",
			"img",
			"input",
			"keygen",
			"link",
			"menuitem",
			"meta",
			"param",
			"source",
			"track",
			"wbr"
		];
		/**
		* Truncates a given HTML string to the specified length.
		* @param {string} text This is the HTMl string to be truncated
		* @param {object} options An options object defining how to truncate
		*      Default values:
		*      {
		*          TruncateBy : 'words',   // Options are 'words', 'characters' or 'paragraphs'
		*          TruncateLength : 50,    // The count to be used with TruncatedBy
		*          StripHTML : false,      // Whether or not the truncated text should contain HTML tags
		*          Strict : true,          // When set to false the truncated text finish at the end of the word
		*          Suffix : '...'          // Text to be appended to the end of the truncated text
		*      }
		* @return {string} This returns the provided string truncated to the
		*      length provided by the options. HTML tags may be stripped based
		*      on the given options.
		*/
		var truncatise = function(text, options) {
			var options = options || {}, text = (text || "").trim(), truncatedText = "", currentState = 0, isEndOfWord = false, currentTag = "", tagStack = [], nextChar = "";
			var charCounter = 0, wordCounter = 0, paragraphCounter = 0;
			var NOT_TAG = 0, TAG_START = 1, TAG_ATTRIBUTES = 2;
			options.TruncateBy = options.TruncateBy === void 0 || typeof options.TruncateBy !== "string" || !options.TruncateBy.match(/(word(s)?|character(s)?|paragraph(s)?)/) ? "words" : options.TruncateBy.toLowerCase();
			options.TruncateLength = options.TruncateLength === void 0 || typeof options.TruncateLength !== "number" ? 50 : options.TruncateLength;
			options.StripHTML = options.StripHTML === void 0 || typeof options.StripHTML !== "boolean" ? false : options.StripHTML;
			options.Strict = options.Strict === void 0 || typeof options.Strict !== "boolean" ? true : options.Strict;
			options.Suffix = options.Suffix === void 0 || typeof options.Suffix !== "string" ? "..." : options.Suffix;
			if (text === "" || text.length <= options.TruncateLength && options.StripHTML === false) return text;
			if (options.StripHTML) text = String(text).replace(/<br( \/)?>/gi, " ");
			if (options.StripHTML && !options.TruncateBy.match(/(paragraph(s)?)/)) text = String(text).replace(/<!--(.*?)-->/gm, "").replace(/<\/?[^>]+>/gi, "");
			text = String(text).replace(/<\/p>(\r?\n)+<p>/gm, "</p><p>");
			if (options.StripHTML && String(text).match(/\r?\n\r?\n/)) text = String(text).replace(/((.+)(\r?\n\r?\n|$))/gi, "<p>$2</p>");
			for (var pointer = 0; pointer < text.length; pointer++) {
				var currentChar = text[pointer];
				switch (currentChar) {
					case "<":
						if (currentState === NOT_TAG) {
							currentState = TAG_START;
							currentTag = "";
						}
						if (!options.StripHTML) truncatedText += currentChar;
						break;
					case ">":
						if (currentState === TAG_START || currentState === TAG_ATTRIBUTES) {
							currentState = NOT_TAG;
							currentTag = currentTag.toLowerCase();
							if (currentTag === "/p") {
								paragraphCounter++;
								if (options.StripHTML) truncatedText += " ";
							}
							if (selfClosingTags.indexOf(currentTag) === -1 && selfClosingTags.indexOf(currentTag + "/") === -1) if (currentTag.indexOf("/") >= 0) tagStack.pop();
							else tagStack.push(currentTag);
						}
						if (!options.StripHTML) truncatedText += currentChar;
						break;
					case " ":
						if (currentState === TAG_START) currentState = TAG_ATTRIBUTES;
						if (currentState === NOT_TAG) {
							wordCounter++;
							charCounter++;
						}
						if (currentState === NOT_TAG || !options.StripHTML) truncatedText += currentChar;
						break;
					default:
						if (currentState === NOT_TAG) charCounter++;
						if (currentState === TAG_START) currentTag += currentChar;
						if (currentState === NOT_TAG || !options.StripHTML) truncatedText += currentChar;
						break;
				}
				nextChar = text[pointer + 1] || "";
				isEndOfWord = options.Strict ? true : !currentChar.match(/[a-zA-ZÇ-Ü']/i) || !nextChar.match(/[a-zA-ZÇ-Ü']/i);
				if (options.TruncateBy.match(/word(s)?/i) && options.TruncateLength <= wordCounter) {
					truncatedText = truncatedText.replace(/\s+$/, "");
					break;
				}
				if (options.TruncateBy.match(/character(s)?/i) && options.TruncateLength <= charCounter && isEndOfWord) break;
				if (options.TruncateBy.match(/paragraph(s)?/i) && options.TruncateLength === paragraphCounter) break;
			}
			if (!options.StripHTML && tagStack.length > 0) while (tagStack.length > 0) {
				var tag = tagStack.pop();
				if (tag !== "!--") truncatedText += "</" + tag + ">";
			}
			if (pointer < text.length - 1) if (truncatedText.match(/<\/p>$/gi)) truncatedText = truncatedText.replace(/(<\/p>)$/gi, options.Suffix + "$1");
			else truncatedText = truncatedText + options.Suffix;
			return truncatedText.trim();
		};
		if (typeof module !== "undefined" && module.exports) return module.exports = truncatise;
		exportTo.truncatise = truncatise;
	})(exports);
})))(), 1);
/**
* Truncate a sentence to be under the given characters limit and strip
* out HTML tags from it.
*
* Optionally, you can force the truncate logic to complete words, which
* may exceed the defined characters limit.
*/
function excerpt(sentence, charactersLimit, options) {
	return (0, import_truncatise.default)(sentence, {
		TruncateLength: charactersLimit,
		Strict: options && options.completeWords === true ? false : true,
		StripHTML: true,
		TruncateBy: "characters",
		Suffix: options && options.suffix
	});
}
//#endregion
//#region src/justify.ts
/**
* Applies padding to the left or the right of the string by repeating
* a given char.
*
* The method is not same as `padLeft` or `padRight` from JavaScript STD lib,
* since it repeats a char regardless of the max width.
*/
function applyPadding(value, options) {
	if (options.paddingLeft) value = `${options.paddingChar.repeat(options.paddingLeft)}${value}`;
	if (options.paddingRight) value = `${value}${options.paddingChar.repeat(options.paddingRight)}`;
	return value;
}
/**
* Justify the columns to have the same width by filling
* the empty slots with a padding char.
*
* Optionally, the column can be aligned left or right.
*/
function justify(columns, options) {
	const normalizedOptions = {
		align: "left",
		indent: " ",
		...options
	};
	return columns.map((column) => {
		const columnWidth = options.getLength?.(column) ?? column.length;
		/**
		* Column is already same or greater than the width
		*/
		if (columnWidth >= normalizedOptions.width) return column;
		/**
		* Fill empty space on the right
		*/
		if (normalizedOptions.align === "left") return applyPadding(column, {
			paddingChar: normalizedOptions.indent,
			paddingRight: normalizedOptions.width - columnWidth
		});
		/**
		* Fill empty space on the left
		*/
		return applyPadding(column, {
			paddingChar: normalizedOptions.indent,
			paddingLeft: normalizedOptions.width - columnWidth
		});
	});
}
//#endregion
//#region src/ordinal.ts
/**
* Ordinalize a give number or string (English only).
*/
function ordinal(value) {
	const transformedValue = Math.abs(typeof value === "string" ? Number.parseInt(value) : value);
	if (!Number.isFinite(transformedValue) || Number.isNaN(transformedValue)) throw new Error("Cannot ordinalize invalid or infinite numbers");
	const percent = transformedValue % 100;
	if (percent >= 10 && percent <= 20) return `${value}th`;
	switch (transformedValue % 10) {
		case 1: return `${value}st`;
		case 2: return `${value}nd`;
		case 3: return `${value}rd`;
		default: return `${value}th`;
	}
}
//#endregion
//#region src/truncate.ts
/**
* Truncate a sentence to be under the given characters limit.
*
* Optionally, you can force the truncate logic to complete words, which
* may exceed the defined characters limit.
*/
function truncate(sentence, charactersLimit, options) {
	return (0, import_truncatise.default)(sentence, {
		TruncateLength: charactersLimit,
		Strict: options && options.completeWords === true ? false : true,
		StripHTML: false,
		TruncateBy: "characters",
		Suffix: options && options.suffix
	});
}
//#endregion
//#region src/sentence.ts
/**
* Convert an array of values to a sentence.
*
* @example
*/
function sentence(values, options) {
	/**
	* Empty array
	*/
	if (values.length === 0) return "";
	/**
	* Just one item
	*/
	if (values.length === 1) return values[0];
	/**
	* Giving some love to two items, so that one can ditch comma with two items
	*/
	if (values.length === 2) return `${values[0]}${options?.pairSeparator || " and "}${values[1]}`;
	const normalized = Object.assign({
		separator: ", ",
		lastSeparator: ", and "
	}, options);
	/**
	* Make sentence
	*/
	return `${values.slice(0, -1).join(normalized.separator)}${normalized.lastSeparator}${values[values.length - 1]}`;
}
//#endregion
//#region src/word_wrap.ts
/**
* Wraps a string value to be on multiple lines after
* a certain characters limit has been hit.
*/
function wordWrap(value, options) {
	const width = options.width;
	const indent = options.indent ?? "";
	const newLine = `${options.newLine ?? "\n"}${indent}`;
	let regexString = ".{1," + width + "}";
	regexString += "([\\s​]+|$)|[^\\s​]+?([\\s​]+|$)";
	const re = new RegExp(regexString, "g");
	return (value.match(re) || []).map(function(line) {
		if (line.slice(-1) === "\n") line = line.slice(0, line.length - 1);
		return options.escape ? options.escape(line) : line;
	}).join(newLine);
}
//#endregion
//#region src/milliseconds.ts
var milliseconds_default = {
	format(milliseconds, long) {
		return format(milliseconds, long);
	},
	parse(duration) {
		if (typeof duration === "number") return duration;
		const milliseconds = parse(duration);
		if (milliseconds === void 0) throw new Error(`Invalid duration expression "${duration}"`);
		return milliseconds;
	}
};
//#endregion
//#region src/html_escape.ts
/**
* HTML escape string values so that they can be nested
* inside the pre-tags.
*/
function htmlEscape(value) {
	return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
//#endregion
//#region src/interpolate.ts
/**
* Parses prop
*/
function parseProp(data, key) {
	const tokens = key.split(".");
	while (tokens.length) {
		if (data === null || typeof data !== "object") return;
		const token = tokens.shift();
		data = Object.hasOwn(data, token) ? data[token] : void 0;
	}
	return data;
}
/**
* A simple function to interpolate values inside curly braces.
*
* ```
* interpolate('hello {{ username }}', { username: 'virk' })
* ```
*/
function interpolate(input, data) {
	return input.replace(/(\\)?{{(.*?)}}/g, (_, escapeChar, key) => {
		if (escapeChar) return `{{${key}}}`;
		return parseProp(data, key.trim());
	});
}
//#endregion
//#region src/to_unix_slash.ts
/**
* Copy-pasted from https://github.com/sindresorhus/slash/blob/main/index.d.ts
* @credit - https://github.com/sindresorhus/slash
*/
/**
* Convert Windows backslash paths to slash paths: `foo\\bar` ➔ `foo/bar`.
* [Forward-slash paths can be used in Windows](http://superuser.com/a/176395/6877) as long as
* they're not extended-length paths.
*
* @example
* ```
* import path from 'node:path';
* import string from '@poppinss/string';
*
* const string = path.join('foo', 'bar');
* // Unix    => foo/bar
* // Windows => foo\\bar
*
* string.toUnixSlash(string);
* // Unix    => foo/bar
* // Windows => foo/bar
* ```
*/
function toUnixSlash(path) {
	if (path.startsWith("\\\\?\\")) return path;
	return path.replace(/\\/g, "/");
}
//#endregion
//#region src/pluralize.ts
function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
[
	["bias", "biases"],
	["canvas", "canvases"],
	["cache", "caches"],
	["cliche", "cliches"],
	["fez", "fezzes"],
	["lens", "lenses"],
	["niche", "niches"],
	["quiche", "quiches"],
	["veto", "vetoes"]
].forEach(([singular, plural]) => {
	const suffix = plural.slice(singular.length);
	const escapedSingular = escapeRegExp(singular);
	const escapedSuffix = escapeRegExp(suffix);
	pluralizePkg.addPluralRule(new RegExp(`(${escapedSingular})$`, "i"), `$1${suffix}`);
	pluralizePkg.addSingularRule(new RegExp(`(${escapedSingular})${escapedSuffix}$`, "i"), "$1");
});
/**
* Pluralize a word based upon the count. The method returns the
* singular form when count is 1.
*/
function pluralize(word, count, inclusive) {
	return pluralizePkg(word, count, inclusive);
}
pluralize.addPluralRule = pluralizePkg.addPluralRule;
pluralize.addSingularRule = pluralizePkg.addSingularRule;
pluralize.addIrregularRule = pluralizePkg.addIrregularRule;
pluralize.addUncountableRule = pluralizePkg.addUncountableRule;
const plural = pluralizePkg.plural;
const singular = pluralizePkg.singular;
const isPlural = pluralizePkg.isPlural;
const isSingular = pluralizePkg.isSingular;
//#endregion
//#region src/change_case.ts
const NO_CASE_SPLIT_REGEXP = [/([a-z0-9])([A-Z])/g, /([A-Z])([A-Z][a-z])/g];
const NO_CASE_STRIP_REGEXP = /[^A-Z0-9]+/gi;
const SMALL_WORDS = /\b(?:an?d?|a[st]|because|but|by|en|for|i[fn]|neither|nor|o[fnr]|only|over|per|so|some|tha[tn]|the|to|up|upon|vs?\.?|versus|via|when|with|without|yet)\b/i;
const TOKENS = /[^\s:–—-]+|./g;
const WHITESPACE = /\s/;
const IS_MANUAL_CASE = /.(?=[A-Z]|\..)/;
const ALPHANUMERIC_PATTERN = /[A-Za-z0-9\u00C0-\u00FF]/;
/**
* The method is a copy/paste from the "title-case" package. They have
* a dependency on "tslib", which I don't want.
*/
function titleCase(input) {
	let output = "";
	let result;
	while ((result = TOKENS.exec(input)) !== null) {
		const { 0: token, index } = result;
		if (!IS_MANUAL_CASE.test(token) && (!SMALL_WORDS.test(token) || index === 0 || index + token.length === input.length) && (input.charAt(index + token.length) !== ":" || WHITESPACE.test(input.charAt(index + token.length + 1)))) {
			output += token.replace(ALPHANUMERIC_PATTERN, (char) => char.toUpperCase());
			continue;
		}
		output += token;
	}
	return output;
}
/**
* Convert string to camelcase
*/
function camelCase(value) {
	return changeCase.camelCase(value);
}
/**
* Convert string to snakecase
*/
function snakeCase(value) {
	return changeCase.snakeCase(value);
}
/**
* Convert string to dashcase
*/
function dashCase(value, options) {
	if (options && options.capitalize) return changeCase.trainCase(value);
	return changeCase.kebabCase(value);
}
/**
* Convert string to pascal case
*/
function pascalCase(value) {
	return changeCase.pascalCase(value);
}
/**
* Convert string to capital case
*/
function capitalCase(value) {
	return changeCase.capitalCase(value);
}
/**
* Convert string to sentence case
*/
function sentenceCase(value) {
	return noCase(value, (input, index) => {
		const result = input.toLowerCase();
		if (index === 0) return input.charAt(0).toUpperCase() + input.substring(1);
		return result;
	});
}
/**
* Convert string to dot case
*/
function dotCase(value, options) {
	const transformedValue = changeCase.dotNotation(value);
	if (options && options.lowerCase) return transformedValue.toLowerCase();
	return transformedValue;
}
/**
* Remove all sort of casing from the string. Copy-pasted from
* "no-case" package with slight modifications.
*/
function noCase(value, transform) {
	let result = NO_CASE_SPLIT_REGEXP.reduce((input, regex) => input.replace(regex, "$1\0$2"), value);
	result = result.replace(NO_CASE_STRIP_REGEXP, "\0");
	let start = 0;
	let end = result.length;
	while (result.charAt(start) === "\0") start++;
	while (result.charAt(end - 1) === "\0") end--;
	return result.slice(start, end).split("\0").map(transform || ((input) => input.toLowerCase())).join(" ");
}
//#endregion
//#region index.ts
/**
* Condense multiple whitespaces from a string
*/
function condenseWhitespace(value) {
	return value.trim().replace(/\s{2,}/g, " ");
}
const string = {
	excerpt,
	truncate,
	slug,
	interpolate,
	plural,
	pluralize,
	singular,
	isPlural,
	isSingular,
	camelCase,
	capitalCase,
	dashCase,
	dotCase,
	noCase,
	pascalCase,
	sentenceCase,
	snakeCase,
	titleCase,
	random,
	sentence,
	condenseWhitespace,
	wordWrap,
	seconds: seconds_default,
	milliseconds: milliseconds_default,
	bytes: bytes_default,
	ordinal,
	htmlEscape,
	justify,
	uuid,
	toUnixSlash
};
//#endregion
export { string as t };
