//#region modules/number.ts
/**
* Coerce an unknown value to a finite number without allowing numeric
* conversion errors to escape.
*/
function toFiniteNumber(value) {
	try {
		const numericValue = typeof value === "number" ? value : Number(value);
		return Number.isFinite(numericValue) ? numericValue : null;
	} catch {
		return null;
	}
}
/**
* Collection of number helpers to clamp and parse numeric values.
*
* @example
* number.clamp(15, 0, 10)  // 10
* number.between(5, 0, 10) // true
* number.parse('42')       // 42
* number.toFinite('abc', 0) // 0
*/
const number = {
	/**
	* Constrain a number to stay within the given bounds.
	*
	* @param value - The number to constrain
	* @param min - The lower bound
	* @param max - The upper bound
	*
	* @example
	* number.clamp(15, 0, 10) // 10
	* number.clamp(-2, 0, 10) // 0
	* number.clamp(5, 0, 10)  // 5
	*/
	clamp(value, min, max) {
		if (value < min) return min;
		else if (value > max) return max;
		else return value;
	},
	/**
	* Check if a number is inside an inclusive range. The bounds may be
	* passed in either order.
	*
	* @param value - The number to test
	* @param min - One end of the range
	* @param max - The other end of the range
	*
	* @example
	* number.between(5, 0, 10)  // true
	* number.between(0, 0, 10)  // true
	* number.between(11, 0, 10) // false
	* number.between(5, 10, 0)  // true
	*/
	between(value, min, max) {
		return value >= Math.min(min, max) && value <= Math.max(min, max);
	},
	/**
	* Convert a value to a finite number. Returns the fallback when the
	* result is `NaN` or `Infinity`.
	*
	* @param value - The value to convert
	* @param fallback - Value to return when conversion fails. Defaults to `0`
	*
	* @example
	* number.toFinite(5)                        // 5
	* number.toFinite('42')                     // 42
	* number.toFinite(Number.NaN)               // 0
	* number.toFinite(Number.POSITIVE_INFINITY) // 0
	* number.toFinite('abc', 10)                // 10
	*/
	toFinite(value, fallback = 0) {
		return toFiniteNumber(value) ?? fallback;
	},
	/**
	* Parse a value into a finite number. Returns `null` for empty input,
	* `NaN`, and `Infinity` instead of substituting a fallback.
	*
	* @param value - The value to parse
	*
	* @example
	* number.parse(5)                        // 5
	* number.parse('42')                     // 42
	* number.parse('')                       // null
	* number.parse(null)                    // null
	* number.parse(Number.NaN)              // null
	* number.parse(Number.POSITIVE_INFINITY) // null
	*/
	parse(value) {
		if (value === null || value === void 0 || value === "") return null;
		return toFiniteNumber(value);
	}
};
//#endregion
export { number as default };
