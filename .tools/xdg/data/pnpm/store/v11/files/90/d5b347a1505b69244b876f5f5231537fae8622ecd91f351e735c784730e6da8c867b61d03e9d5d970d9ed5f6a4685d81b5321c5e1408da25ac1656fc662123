import { extname } from "node:path";
//#region src/natural_sort.ts
/**
* Create a natural sort comparator for a specific locale
*/
function createNaturalSort({ locale }) {
	let collator;
	return function naturalSort(current, next) {
		collator ??= new Intl.Collator(locale, {
			numeric: true,
			sensitivity: "base"
		});
		return collator.compare(current, next);
	};
}
/**
* Perform natural sorting with "Array.sort()" method
*/
const naturalSort = createNaturalSort({ locale: "en" });
//#endregion
//#region src/is_script_file.ts
const JS_MODULES = [
	".js",
	".json",
	".cjs",
	".mjs"
];
/**
* Returns `true` when file ends with `.js`, `.json` or
* `.ts` but not `.d.ts`.
*/
function isScriptFile(filePath) {
	const ext = extname(filePath);
	if (JS_MODULES.includes(ext)) return true;
	if (ext === ".ts" && !filePath.endsWith(".d.ts")) return true;
	return false;
}
//#endregion
export { createNaturalSort as n, naturalSort as r, isScriptFile as t };
