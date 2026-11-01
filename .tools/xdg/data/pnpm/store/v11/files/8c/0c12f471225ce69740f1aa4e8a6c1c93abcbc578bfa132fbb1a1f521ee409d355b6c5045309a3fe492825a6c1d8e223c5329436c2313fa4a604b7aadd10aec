export type JSONReplacer = (this: any, key: string, value: any) => any;
/**
 * String Javascript values to a JSON string. Handles circular
 * references and bigints.
 *
 * Uses the native `JSON.stringify` first and falls back to
 * "safe-stable-stringify" only when it throws a TypeError, which
 * is what V8 raises for circular references and bigints. The fast
 * path covers most values and is several times faster.
 *
 * When a replacer is defined, bigints are converted inside the
 * native pass. Only circular references trigger the fallback, and
 * in that case the replacer runs a second time.
 *
 * On Node.js 25+, a V8 bug in the fast path of `JSON.stringify`
 * makes it take several milliseconds to reject a circular plain
 * object. Values with circular references are slower than before
 * on these versions until V8 fixes it.
 * See https://issues.chromium.org/issues/572287937
 */
export declare function safeStringify(value: any, replacer?: JSONReplacer, space?: string | number): string | undefined;
