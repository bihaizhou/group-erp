import { inspect } from "node:util";
import { AssertionError } from "node:assert";
//#region modules/assert.ts
/**
* @alias "assertExists"
*/
function assert(value, message) {
	return assertExists(value, message);
}
/**
* Assert the value is turthy or raise an exception.
*
* Truthy value excludes, undefined, null, and false values.
*/
function assertExists(value, message) {
	if (!value) throw new AssertionError({ message: message ?? "value is falsy" });
}
/**
* Throws error when method is called
*/
function assertUnreachable(x) {
	throw new AssertionError({ message: `unreachable code executed: ${inspect(x)}` });
}
/**
* Assert the value is not null.
*/
function assertNotNull(value, message) {
	if (value === null) throw new AssertionError({ message: message ?? "unexpected null value" });
}
/**
* Assert the value is not undefined.
*/
function assertIsDefined(value, message) {
	if (value === void 0) throw new AssertionError({ message: message ?? "unexpected undefined value" });
}
//#endregion
export { assert, assertExists, assertIsDefined, assertNotNull, assertUnreachable };
