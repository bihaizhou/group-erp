import { r as naturalSort, t as isScriptFile } from "../../is_script_file-DECAVJWd.js";
import { extname, join, relative, sep } from "node:path";
import string from "@poppinss/string";
import lodash from "@poppinss/utils/lodash";
import { readdir, stat } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
//#region modules/fs/fs_read_all.ts
/**
* Returns an array of file paths from the given location. You can
* optionally filter and sort files by passing relevant options
*
* ```ts
* await fsReadAll(new URL('./', import.meta.url))
*
* await fsReadAll(new URL('./', import.meta.url), {
*   filter: (filePath) => filePath.endsWith('.js')
* })

* await fsReadAll(new URL('./', import.meta.url), {
*   absolute: true,
*   unixPaths: true
* })
* ```
*/
async function fsReadAll(location, options) {
	const normalizedLocation = typeof location === "string" ? location : fileURLToPath(location);
	const normalizedOptions = Object.assign({
		absolute: false,
		sort: naturalSort
	}, options);
	const pathType = normalizedOptions.pathType || "relative";
	/**
	* Check to see if the root directory exists and ignore
	* error when "ignoreMissingRoot" is set to true
	*/
	try {
		await stat(normalizedLocation);
	} catch (error) {
		if (normalizedOptions.ignoreMissingRoot) return [];
		throw error;
	}
	const files = (await readdir(normalizedLocation, {
		recursive: true,
		withFileTypes: true
	})).filter((dirent) => {
		if (!dirent.isFile()) return false;
		if (dirent.name.startsWith(".")) return false;
		const relativePath = relative(normalizedLocation, dirent.parentPath);
		if (relativePath && relativePath.split(sep).some((segment) => segment.startsWith("."))) return false;
		return true;
	}).map((file) => {
		switch (pathType) {
			case "relative": return join(relative(normalizedLocation, file.parentPath), file.name);
			case "absolute": return join(file.parentPath, file.name);
			case "unixRelative": return string.toUnixSlash(join(relative(normalizedLocation, file.parentPath), file.name));
			case "unixAbsolute": return string.toUnixSlash(join(file.parentPath, file.name));
			case "url": return pathToFileURL(join(file.parentPath, file.name)).href;
		}
	});
	if (normalizedOptions.filter) return files.filter(normalizedOptions.filter).sort(normalizedOptions.sort);
	return files.sort(normalizedOptions.sort);
}
//#endregion
//#region modules/fs/fs_import_all.ts
/**
* Import the file and update the values collection with the default
* export.
*/
async function importFile(basePath, fileURL, values, options) {
	/**
	* Converting URL to file path
	*/
	const filePath = fileURLToPath(fileURL);
	/**
	* Grab file extension
	*/
	const fileExtension = extname(filePath);
	const collectionKey = relative(basePath, filePath).replace(new RegExp(`${fileExtension}$`), "").split(sep);
	/**
	* Import module
	*/
	const exportedValue = fileExtension === ".json" ? await import(fileURL, { with: { type: "json" } }) : await import(fileURL);
	lodash.set(values, options.transformKeys ? options.transformKeys(collectionKey) : collectionKey, exportedValue.default ? exportedValue.default : { ...exportedValue });
}
/**
* Returns an array of file paths from the given location. You can
* optionally filter and sort files by passing relevant options
*
* ```ts
* await fsReadAll(new URL('./', import.meta.url))
*
* await fsReadAll(new URL('./', import.meta.url), {
*   filter: (filePath) => filePath.endsWith('.js')
* })

* await fsReadAll(new URL('./', import.meta.url), {
*   absolute: true,
*   unixPaths: true
* })
* ```
*/
async function fsImportAll(location, options) {
	options = options || {};
	const collection = {};
	const normalizedLocation = typeof location === "string" ? location : fileURLToPath(location);
	const files = await fsReadAll(normalizedLocation, {
		filter: isScriptFile,
		...options,
		pathType: "url"
	});
	/**
	* Parallelly import all the files and mutate the values collection
	*/
	await Promise.all(files.map((file) => importFile(normalizedLocation, file, collection, options)));
	return collection;
}
//#endregion
export { fsImportAll, fsReadAll };
